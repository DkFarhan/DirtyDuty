package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.AssigneeResponse;
import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.DashboardResponse;
import com.dirtyduty.app.dto.chore.HouseholdMemberStatsResponse;
import com.dirtyduty.app.entity.Chore;
import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.Household;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ChorePriority;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OccurrenceService {
  private static final Logger log = LoggerFactory.getLogger(OccurrenceService.class);
  private static final SecureRandom RANDOM = new SecureRandom();
  static final int MOVE_WINDOW_DAYS = 7;
  static final String OCCUPIED_DAY_MESSAGE = "This chore is already scheduled on that day.";
  static final String PAST_DUE_DATE_MESSAGE =
      "This chore's due date has passed. Choose a new due date.";
  private final JdbcTemplate jdbc;
  private final EntityManager entityManager;
  private final ChoreScheduleRepository scheduleRepository;
  private final HouseholdMembershipRepository membershipRepository;
  private final UserRepository userRepository;
  private final NotificationEventService notificationEventService;
  private final int horizonDays;

  public OccurrenceService(
      JdbcTemplate jdbc,
      EntityManager entityManager,
      ChoreScheduleRepository scheduleRepository,
      HouseholdMembershipRepository membershipRepository,
      UserRepository userRepository,
      NotificationEventService notificationEventService,
      @Value("${app.chores.occurrence-horizon-days:30}") int horizonDays) {
    if (horizonDays < 1 || horizonDays > 90) {
      throw new IllegalArgumentException("Occurrence horizon must be between 1 and 90 days.");
    }
    this.jdbc = jdbc;
    this.entityManager = entityManager;
    this.scheduleRepository = scheduleRepository;
    this.membershipRepository = membershipRepository;
    this.userRepository = userRepository;
    this.notificationEventService = notificationEventService;
    this.horizonDays = horizonDays;
  }

  @Transactional
  public void synchronizeSchedule(ChoreSchedule schedule) {
    synchronizeSchedule(schedule, false, false);
  }

  @Transactional
  public void synchronizeSchedule(ChoreSchedule schedule, boolean updatePendingAssignees) {
    synchronizeSchedule(schedule, updatePendingAssignees, true);
  }

  @Transactional
  public void synchronizeSchedule(
      ChoreSchedule schedule, boolean updatePendingAssignees, boolean userInitiatedEdit) {
    lockHousehold(schedule.getHousehold().getId());
    jdbc.queryForObject(
        "SELECT id FROM chore_schedules WHERE id=? FOR UPDATE", UUID.class, schedule.getId());
    Household household = schedule.getHousehold();
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    LocalDate today = LocalDate.now(zone);
    LocalDate limit = today.plusDays(horizonDays);
    if (schedule.getEndsOn() != null && schedule.getEndsOn().plusDays(1).isBefore(limit)) {
      limit = schedule.getEndsOn().plusDays(1);
    }

    boolean enabled =
        schedule.isActive()
            && schedule.getChore().isActive()
            && schedule.getChore().getArchivedAt() == null;
    List<LocalDate> dates = new ArrayList<>();
    if (enabled) {
      // Dates are evaluated in the schedule's local calendar; COUNT is counted from starts_on,
      // or from count_rebased_on after a rule edit (see scheduleDates).
      LocalDate from = schedule.getStartsOn().isAfter(today) ? schedule.getStartsOn() : today;
      dates.addAll(scheduleDates(schedule, from, limit));
    }

    if (enabled && "FREQ=ONCE".equals(schedule.getRecurrenceRule())) {
      // A one-time chore has a single occurrence, so it is not capped by the rolling horizon:
      // it is created (and announced) in the request that creates or activates the schedule,
      // never later by background generation when its date enters the horizon.
      LocalDate onceDate = schedule.getStartsOn();
      boolean onceDateEligible =
          !onceDate.isBefore(today)
              && (schedule.getEndsOn() == null || !onceDate.isAfter(schedule.getEndsOn()));
      synchronizeOneTimeSchedule(
          schedule, household, onceDateEligible, updatePendingAssignees, userInitiatedEdit);
      return;
    }
    if ("FREQ=ONCE".equals(schedule.getRecurrenceRule())) {
      // Paused, inactive or archived one-time chore: same cancellation the recurring branch
      // applies (pending occurrences from today on), plus their pending reminders right away.
      pauseOneTimeSchedule(schedule, household, today);
      return;
    }

    // Occurrences are reconciled by their planned date, so a moved occurrence is neither
    // cancelled as off-rule nor recreated on its original day. An occurrence whose planned date
    // has passed is already produced: edits leave it alone even if it was moved to a later day.
    List<FutureOccurrence> existingFuture =
        jdbc.query(
            "SELECT id, planned_for FROM chore_assignments "
                + "WHERE schedule_id = ? AND household_id = ? AND planned_for >= ? "
                + "AND status IN ('PENDING','SUBMITTED')",
            (rs, row) ->
                new FutureOccurrence(
                    rs.getObject("id", UUID.class), rs.getObject("planned_for", LocalDate.class)),
            schedule.getId(),
            household.getId(),
            today);
    for (FutureOccurrence occurrence : existingFuture) {
      if (!dates.contains(occurrence.plannedFor())) {
        int cancelled =
            jdbc.update(
                "UPDATE chore_assignments SET status='CANCELLED', updated_at=NOW() "
                    + "WHERE id=? AND status='PENDING'",
                occurrence.id());
        if (cancelled == 1) {
          // The date no longer belongs to the schedule (rule, end or pause change): its pending
          // reminders go now rather than on the notification scheduler's next pass.
          cancelPendingOccurrenceReminders(occurrence.id());
        }
      }
    }

    for (LocalDate date : dates) {
      List<UUID> assignees = selectedAssignees(schedule, date);
      OffsetDateTime dueAt =
          schedule.getDueTime() == null ? null : dueAt(date, schedule.getDueTime(), zone);
      UUID occurrenceId =
          jdbc.query(
              "SELECT id FROM chore_assignments WHERE schedule_id=? AND planned_for=?",
              rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
              schedule.getId(),
              date);
      Chore chore = schedule.getChore();
      if (occurrenceId == null) {
        occurrenceId = UUID.randomUUID();
        int inserted =
            jdbc.update(
                """
                        INSERT INTO chore_assignments
                            (id, household_id, chore_id, schedule_id, assigned_to_user_id,
                             scheduled_for, planned_for, due_at, status, title_snapshot,
                             priority_snapshot, difficulty_snapshot, estimated_minutes_snapshot)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
                        ON CONFLICT (schedule_id, planned_for) WHERE schedule_id IS NOT NULL DO NOTHING
                        """,
                occurrenceId,
                household.getId(),
                chore.getId(),
                schedule.getId(),
                assignees.isEmpty() ? null : assignees.getFirst(),
                date,
                date,
                dueAt,
                chore.getTitle(),
                chore.getDefaultPriority().name(),
                chore.getDifficulty(),
                chore.getEstimatedMinutes());
        if (inserted == 0) {
          continue;
        }
        for (UUID userId : assignees) {
          jdbc.update(
              """
                            INSERT INTO chore_assignment_assignees
                                (household_id, assignment_id, user_id)
                            VALUES (?, ?, ?) ON CONFLICT (assignment_id, user_id) DO NOTHING
                            """,
              household.getId(),
              occurrenceId,
              userId);
        }
        if ("FREQ=ONCE".equals(schedule.getRecurrenceRule())) {
          notificationEventService.publish(
              new NotificationEvent(
                  "CHORE_ASSIGNED",
                  null,
                  household.getId(),
                  "CHORE_ASSIGNMENT",
                  occurrenceId,
                  "CHORE_REMINDER",
                  java.util.Map.of("chore_name", chore.getTitle()),
                  assignees));
        }
      } else {
        String occurrenceStatus = status(occurrenceId);
        if (!"PENDING".equals(occurrenceStatus)
            && !"SUBMITTED".equals(occurrenceStatus)
            && !"CANCELLED".equals(occurrenceStatus)) {
          continue;
        }
        if ("SUBMITTED".equals(occurrenceStatus)) {
          continue;
        }
        OverrideState state =
            jdbc.queryForObject(
                """
                    SELECT cancelled_by_membership_exit, due_at, date_overridden,
                           assignees_overridden
                    FROM chore_assignments WHERE id=?
                    """,
                (rs, row) ->
                    new OverrideState(
                        rs.getBoolean("cancelled_by_membership_exit"),
                        rs.getObject("due_at", OffsetDateTime.class),
                        rs.getBoolean("date_overridden"),
                        rs.getBoolean("assignees_overridden")),
                occurrenceId);
        boolean exitCancelled = state.exitCancelled();
        if (exitCancelled && !userInitiatedEdit) {
          continue;
        }
        // A cancelled row coming back is a fresh occurrence: earlier per-date overrides go.
        boolean reviving = "CANCELLED".equals(occurrenceStatus);
        boolean keepDate = state.dateOverridden() && !reviving;
        boolean keepAssignees = state.assigneesOverridden() && !reviving;
        OffsetDateTime previousDueAt = state.dueAt();
        if (!keepDate
            && (previousDueAt == null
                ? dueAt != null
                : dueAt == null || !previousDueAt.isEqual(dueAt))) {
          // Same rule as one-time chores: reminders for the old deadline must not fire. The
          // notification scheduler plans replacements for the new deadline.
          cancelPendingOccurrenceReminders(occurrenceId);
        }
        jdbc.update(
            """
                        UPDATE chore_assignments
                        SET status='PENDING',
                            scheduled_for=CASE WHEN ? THEN scheduled_for ELSE planned_for END,
                            due_at=CASE WHEN ? THEN due_at ELSE ? END,
                            date_overridden=?, assignees_overridden=?,
                            title_snapshot=?, priority_snapshot=?,
                            difficulty_snapshot=?, estimated_minutes_snapshot=?, updated_at=NOW(),
                            cancelled_by_membership_exit=FALSE
                        WHERE id=? AND status IN ('PENDING','CANCELLED')
                        """,
            keepDate,
            keepDate,
            dueAt,
            keepDate,
            keepAssignees,
            chore.getTitle(),
            chore.getDefaultPriority().name(),
            chore.getDifficulty(),
            chore.getEstimatedMinutes(),
            occurrenceId);
        if (!keepAssignees
            && (updatePendingAssignees
                || exitCancelled
                || (reviving && state.assigneesOverridden()))) {
          jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
          jdbc.update(
              "UPDATE chore_assignments SET assigned_to_user_id=? WHERE id=?",
              assignees.isEmpty() ? null : assignees.getFirst(),
              occurrenceId);
          for (UUID userId : assignees) {
            jdbc.update(
                """
                                INSERT INTO chore_assignment_assignees
                                    (household_id, assignment_id, user_id)
                                VALUES (?, ?, ?) ON CONFLICT (assignment_id, user_id) DO NOTHING
                                """,
                household.getId(),
                occurrenceId,
                userId);
          }
        }
        ensureLegacyAssigneeRelation(occurrenceId, household.getId());
      }
    }
    if (!"FREQ=ONCE".equals(schedule.getRecurrenceRule())) {
      publishNewRecurringAssigneeAnnouncements(schedule, today);
    }
  }

  @Transactional
  public void validateScheduleFrequencyChange(
      ChoreSchedule schedule, String previousRule, String updatedRule) {
    if ("FREQ=ONCE".equals(updatedRule)
        && previousRule != null
        && !"FREQ=ONCE".equals(previousRule)) {
      boolean hasAssignmentHistory =
          jdbc.queryForObject(
              "SELECT EXISTS(SELECT 1 FROM chore_assignments WHERE schedule_id=?)",
              Boolean.class,
              schedule.getId());
      boolean hasRecurringAnnouncement =
          jdbc.queryForObject(
              "SELECT EXISTS(SELECT 1 FROM recurring_chore_assignment_announcements WHERE schedule_id=?)",
              Boolean.class,
              schedule.getId());
      if (hasAssignmentHistory || hasRecurringAnnouncement) {
        throw new InvalidHouseholdException(
            "A recurring chore with existing assignment history cannot be converted to one-time. Create a separate one-time chore to preserve its history.");
      }
    }
  }

  private void synchronizeOneTimeSchedule(
      ChoreSchedule schedule,
      Household household,
      boolean createOccurrence,
      boolean updatePendingAssignees,
      boolean userInitiatedEdit) {
    List<OneTimeOccurrence> existing =
        jdbc.query(
            """
                SELECT id, scheduled_for, due_at, status
                FROM chore_assignments
                WHERE schedule_id=? AND household_id=?
                ORDER BY scheduled_for, created_at, id
                """,
            (rs, row) ->
                new OneTimeOccurrence(
                    rs.getObject("id", UUID.class),
                    rs.getObject("scheduled_for", LocalDate.class),
                    rs.getObject("due_at", OffsetDateTime.class),
                    rs.getString("status")),
            schedule.getId(),
            household.getId());

    List<OneTimeOccurrence> submitted =
        existing.stream().filter(occurrence -> "SUBMITTED".equals(occurrence.status())).toList();
    if (submitted.size() > 1) {
      if (userInitiatedEdit) {
        throw new InvalidHouseholdException(
            "This schedule has multiple submitted assignments. Resolve them before changing its due date.");
      }
      return;
    }
    if (!submitted.isEmpty()) {
      if (userInitiatedEdit
          && existing.stream().anyMatch(occurrence -> "PENDING".equals(occurrence.status()))) {
        throw new InvalidHouseholdException(
            "This schedule has submitted and pending assignments that require review before changing its due date.");
      }
      return;
    }

    // Reactivation: the schedule has no live or finished occurrence, and its own occurrence on its
    // due date was cancelled (by a pause, or by a member exit). That row is the chore's single
    // occurrence, not unrelated history, so a user-initiated activation or edit resumes it in
    // place. The #35 guard below still protects a cancelled row on the target date whenever a
    // live occurrence exists elsewhere. Background generation never revives anything.
    OneTimeOccurrence cancelledOnDueDate =
        existing.stream()
            .filter(
                occurrence ->
                    occurrence.scheduledFor().equals(schedule.getStartsOn())
                        && "CANCELLED".equals(occurrence.status()))
            .findFirst()
            .orElse(null);
    boolean liveOrFinished =
        existing.stream()
            .anyMatch(
                occurrence ->
                    "PENDING".equals(occurrence.status())
                        || "COMPLETED".equals(occurrence.status())
                        || "SKIPPED".equals(occurrence.status()));
    if (cancelledOnDueDate != null && !liveOrFinished && userInitiatedEdit) {
      if (!createOccurrence) {
        throw new InvalidHouseholdException(PAST_DUE_DATE_MESSAGE);
      }
      reviveOneTimeOccurrence(schedule, household, cancelledOnDueDate.id(), updatePendingAssignees);
      return;
    }

    if (existing.stream()
            .anyMatch(
                occurrence ->
                    "COMPLETED".equals(occurrence.status())
                        || "SKIPPED".equals(occurrence.status()))
        || existing.stream()
            .anyMatch(
                occurrence ->
                    occurrence.scheduledFor().equals(schedule.getStartsOn())
                        && "CANCELLED".equals(occurrence.status()))) {
      if (existing.stream()
          .anyMatch(
              occurrence ->
                  occurrence.scheduledFor().equals(schedule.getStartsOn())
                      && "CANCELLED".equals(occurrence.status()))) {
        if (userInitiatedEdit) {
          throw new InvalidHouseholdException(
              "The selected due date has a cancelled assignment. Choose another due date.");
        }
        return;
      }
      if (userInitiatedEdit
          && existing.stream().anyMatch(occurrence -> "PENDING".equals(occurrence.status()))) {
        throw new InvalidHouseholdException(
            "This schedule has completed work and pending assignments that require review before changing its due date.");
      }
      return;
    }

    OneTimeOccurrence target =
        existing.stream()
            .filter(occurrence -> occurrence.scheduledFor().equals(schedule.getStartsOn()))
            .findFirst()
            .orElse(null);
    if (target != null && !"PENDING".equals(target.status())) {
      if (userInitiatedEdit) {
        throw new InvalidHouseholdException(
            "The selected due date has a non-pending assignment. Choose another due date.");
      }
      return;
    }

    List<OneTimeOccurrence> pending =
        existing.stream().filter(occurrence -> "PENDING".equals(occurrence.status())).toList();
    if (pending.isEmpty()) {
      if (createOccurrence && target == null) {
        createOneTimeOccurrence(schedule, household, schedule.getStartsOn());
      }
      return;
    }

    OneTimeOccurrence occurrence = target != null ? target : pending.getFirst();
    cancelDuplicatePendingOccurrences(existing, occurrence.id());

    LocalDate scheduledFor = schedule.getStartsOn();
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    OffsetDateTime dueAt =
        schedule.getDueTime() == null ? null : dueAt(scheduledFor, schedule.getDueTime(), zone);
    boolean deadlineChanged =
        !occurrence.scheduledFor().equals(scheduledFor)
            || (occurrence.dueAt() == null
                ? dueAt != null
                : dueAt == null || !occurrence.dueAt().isEqual(dueAt));
    if (deadlineChanged) {
      cancelPendingOccurrenceReminders(occurrence.id());
    }
    Chore chore = schedule.getChore();
    // A one-time chore's single occurrence follows its schedule's due date, which a move also
    // updates; planned_for always equals scheduled_for here. An edit that changes the deadline
    // replaces an earlier move, so the "moved" marker goes with it.
    jdbc.update(
        """
            UPDATE chore_assignments
            SET scheduled_for=?, planned_for=?, due_at=?, title_snapshot=?, priority_snapshot=?,
                difficulty_snapshot=?, estimated_minutes_snapshot=?, updated_at=NOW(),
                date_overridden=CASE WHEN ? THEN FALSE ELSE date_overridden END,
                metadata=CASE WHEN ? THEN metadata - 'movedFrom' ELSE metadata END
            WHERE id=? AND status='PENDING'
            """,
        scheduledFor,
        scheduledFor,
        dueAt,
        chore.getTitle(),
        chore.getDefaultPriority().name(),
        chore.getDifficulty(),
        chore.getEstimatedMinutes(),
        deadlineChanged,
        deadlineChanged,
        occurrence.id());
    if (updatePendingAssignees) {
      updateOneTimeAssignees(schedule, household, occurrence.id(), scheduledFor);
    }
    ensureLegacyAssigneeRelation(occurrence.id(), household.getId());
  }

  private void createOneTimeOccurrence(
      ChoreSchedule schedule, Household household, LocalDate scheduledFor) {
    Chore chore = schedule.getChore();
    List<UUID> assignees = selectedAssignees(schedule, scheduledFor);
    Set<UUID> alreadyAssigned = previouslyAssignedUsers(schedule.getId());
    OffsetDateTime dueAt =
        schedule.getDueTime() == null
            ? null
            : dueAt(scheduledFor, schedule.getDueTime(), ZoneId.of(schedule.getTimezone()));
    UUID occurrenceId = UUID.randomUUID();
    int inserted =
        jdbc.update(
            """
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, schedule_id, assigned_to_user_id,
                     scheduled_for, planned_for, due_at, status, title_snapshot,
                     priority_snapshot, difficulty_snapshot, estimated_minutes_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
                ON CONFLICT (schedule_id, planned_for) WHERE schedule_id IS NOT NULL DO NOTHING
                """,
            occurrenceId,
            household.getId(),
            chore.getId(),
            schedule.getId(),
            assignees.isEmpty() ? null : assignees.getFirst(),
            scheduledFor,
            scheduledFor,
            dueAt,
            chore.getTitle(),
            chore.getDefaultPriority().name(),
            chore.getDifficulty(),
            chore.getEstimatedMinutes());
    if (inserted == 0) {
      return;
    }
    insertAssignees(occurrenceId, household.getId(), assignees);
    // A schedule that already had an occurrence (for example one cancelled by a pause and then
    // moved to a new date) announced its assignees then. Only people new to it are told now.
    announceOneTimeAssignment(
        household,
        chore,
        occurrenceId,
        assignees.stream().filter(userId -> !alreadyAssigned.contains(userId)).toList());
  }

  private void announceOneTimeAssignment(
      Household household, Chore chore, UUID occurrenceId, List<UUID> recipients) {
    if (recipients.isEmpty()) {
      return;
    }
    notificationEventService.publish(
        new NotificationEvent(
            "CHORE_ASSIGNED",
            null,
            household.getId(),
            "CHORE_ASSIGNMENT",
            occurrenceId,
            "CHORE_REMINDER",
            java.util.Map.of("chore_name", chore.getTitle()),
            recipients));
  }

  /**
   * Resumes a one-time chore's own cancelled occurrence in place (same row, same date). Assignees
   * are recomputed from the current schedule when requested or when a member exit removed them, and
   * only active members are ever assigned. Earlier reminders stay cancelled as history; the
   * notification scheduler plans fresh ones for the current deadline.
   */
  private void reviveOneTimeOccurrence(
      ChoreSchedule schedule,
      Household household,
      UUID occurrenceId,
      boolean updatePendingAssignees) {
    boolean exitCancelled =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "SELECT cancelled_by_membership_exit FROM chore_assignments WHERE id=?",
                Boolean.class,
                occurrenceId));
    Set<UUID> alreadyAssigned = previouslyAssignedUsers(schedule.getId());
    List<UUID> currentAssignees =
        jdbc.queryForList(
            "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
            UUID.class,
            occurrenceId);
    List<UUID> assignees =
        activeMembersOnly(
            household.getId(),
            updatePendingAssignees || exitCancelled || currentAssignees.isEmpty()
                ? selectedAssignees(schedule, schedule.getStartsOn())
                : currentAssignees);
    if (assignees.isEmpty()) {
      throw new InvalidHouseholdException(
          "Assign this chore to a current household member before activating it.");
    }

    Chore chore = schedule.getChore();
    OffsetDateTime dueAt =
        schedule.getDueTime() == null
            ? null
            : dueAt(
                schedule.getStartsOn(), schedule.getDueTime(), ZoneId.of(schedule.getTimezone()));
    jdbc.update(
        """
            UPDATE chore_assignments
            SET status='PENDING', cancelled_by_membership_exit=FALSE, due_at=?, title_snapshot=?,
                priority_snapshot=?, difficulty_snapshot=?, estimated_minutes_snapshot=?,
                date_overridden=FALSE, assignees_overridden=FALSE,
                metadata=metadata - 'movedFrom', updated_at=NOW()
            WHERE id=? AND status='CANCELLED'
            """,
        dueAt,
        chore.getTitle(),
        chore.getDefaultPriority().name(),
        chore.getDifficulty(),
        chore.getEstimatedMinutes(),
        occurrenceId);
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
    jdbc.update(
        "UPDATE chore_assignments SET assigned_to_user_id=? WHERE id=?",
        assignees.getFirst(),
        occurrenceId);
    insertAssignees(occurrenceId, household.getId(), assignees);
    announceOneTimeAssignment(
        household,
        chore,
        occurrenceId,
        assignees.stream().filter(userId -> !alreadyAssigned.contains(userId)).toList());
  }

  private void pauseOneTimeSchedule(ChoreSchedule schedule, Household household, LocalDate today) {
    List<UUID> pending =
        jdbc.queryForList(
            """
                SELECT id FROM chore_assignments
                WHERE schedule_id=? AND household_id=? AND scheduled_for>=? AND status='PENDING'
                """,
            UUID.class,
            schedule.getId(),
            household.getId(),
            today);
    for (UUID occurrenceId : pending) {
      jdbc.update(
          "UPDATE chore_assignments SET status='CANCELLED', updated_at=NOW() "
              + "WHERE id=? AND status='PENDING'",
          occurrenceId);
      cancelPendingOccurrenceReminders(occurrenceId);
    }
  }

  /**
   * Rejects activating a one-time chore whose single occurrence would land in the past. Applies
   * only when the chore has no live or finished occurrence; otherwise activation keeps its existing
   * behaviour.
   */
  @Transactional(readOnly = true)
  public void validateOneTimeActivation(ChoreSchedule schedule) {
    if (!"FREQ=ONCE".equals(schedule.getRecurrenceRule())) {
      return;
    }
    LocalDate today = LocalDate.now(ZoneId.of(schedule.getTimezone()));
    if (!schedule.getStartsOn().isBefore(today)) {
      return;
    }
    Boolean liveOrFinished =
        jdbc.queryForObject(
            """
                SELECT EXISTS (
                    SELECT 1 FROM chore_assignments
                    WHERE schedule_id=? AND status IN ('PENDING','SUBMITTED','COMPLETED','SKIPPED')
                )
                """,
            Boolean.class,
            schedule.getId());
    if (!Boolean.TRUE.equals(liveOrFinished)) {
      throw new InvalidHouseholdException(PAST_DUE_DATE_MESSAGE);
    }
  }

  /** Everyone who was assigned to, or announced for, any occurrence of this schedule. */
  private Set<UUID> previouslyAssignedUsers(UUID scheduleId) {
    if (scheduleId == null) {
      return Set.of();
    }
    return Set.copyOf(
        jdbc.queryForList(
            """
                SELECT aa.user_id FROM chore_assignment_assignees aa
                JOIN chore_assignments a ON a.id=aa.assignment_id
                WHERE a.schedule_id=?
                UNION
                SELECT a.assigned_to_user_id FROM chore_assignments a
                WHERE a.schedule_id=? AND a.assigned_to_user_id IS NOT NULL
                UNION
                SELECT n.recipient_user_id FROM notifications n
                JOIN chore_assignments a
                  ON n.reference_type='CHORE_ASSIGNMENT' AND n.reference_id=a.id
                WHERE a.schedule_id=? AND n.type='CHORE_ASSIGNED'
                """,
            UUID.class,
            scheduleId,
            scheduleId,
            scheduleId));
  }

  private List<UUID> activeMembersOnly(UUID householdId, List<UUID> userIds) {
    if (userIds.isEmpty()) {
      return List.of();
    }
    Set<UUID> active =
        Set.copyOf(
            jdbc.queryForList(
                """
                    SELECT user_id FROM household_memberships
                    WHERE household_id=? AND status='ACTIVE'
                    """,
                UUID.class,
                householdId));
    return userIds.stream().filter(active::contains).distinct().toList();
  }

  /**
   * Applies an edited assignment configuration to a one-time chore's pending occurrence. The edit
   * replaces any earlier reassign, and people who were not on the occurrence before are told they
   * now have it.
   */
  private void updateOneTimeAssignees(
      ChoreSchedule schedule, Household household, UUID occurrenceId, LocalDate scheduledFor) {
    List<UUID> assignees = selectedAssignees(schedule, scheduledFor);
    Set<UUID> previous = Set.copyOf(currentAssignees(occurrenceId));
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
    jdbc.update(
        "UPDATE chore_assignments SET assigned_to_user_id=?, assignees_overridden=FALSE WHERE id=?",
        assignees.isEmpty() ? null : assignees.getFirst(),
        occurrenceId);
    insertAssignees(occurrenceId, household.getId(), assignees);
    List<UUID> removed = previous.stream().filter(userId -> !assignees.contains(userId)).toList();
    cancelPendingRemindersFor(occurrenceId, removed);
    List<UUID> added = assignees.stream().filter(userId -> !previous.contains(userId)).toList();
    announceOccurrenceAssignment(
        household.getId(), occurrenceId, schedule.getChore().getTitle(), scheduledFor, null, added);
  }

  private void insertAssignees(UUID occurrenceId, UUID householdId, List<UUID> assignees) {
    for (UUID userId : assignees) {
      jdbc.update(
          """
              INSERT INTO chore_assignment_assignees
                  (household_id, assignment_id, user_id)
              VALUES (?, ?, ?) ON CONFLICT (assignment_id, user_id) DO NOTHING
              """,
          householdId,
          occurrenceId,
          userId);
    }
  }

  private void cancelDuplicatePendingOccurrences(
      List<OneTimeOccurrence> existing, UUID preservedOccurrenceId) {
    for (OneTimeOccurrence occurrence : existing) {
      if ("PENDING".equals(occurrence.status())
          && !java.util.Objects.equals(occurrence.id(), preservedOccurrenceId)) {
        jdbc.update(
            "UPDATE chore_assignments SET status='CANCELLED', updated_at=NOW() "
                + "WHERE id=? AND status='PENDING'",
            occurrence.id());
        cancelObsoleteOccurrenceNotifications(occurrence.id());
      }
    }
  }

  private void cancelObsoleteOccurrenceNotifications(UUID occurrenceId) {
    jdbc.update(
        """
            UPDATE notifications SET status='CANCELLED'
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
            """,
        occurrenceId);
    jdbc.update(
        """
            UPDATE notification_deliveries d SET status='CANCELLED'
            FROM notifications n
            WHERE d.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
              AND n.reference_id=? AND d.status IN ('PENDING','FAILED')
            """,
        occurrenceId);
    jdbc.update(
        """
            UPDATE notification_push_delivery_targets t
            SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
            FROM notifications n
            WHERE t.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
              AND n.reference_id=? AND t.status IN ('PENDING','FAILED')
            """,
        occurrenceId);
  }

  private void cancelPendingOccurrenceReminders(UUID occurrenceId) {
    jdbc.update(
        """
            UPDATE notifications SET status='CANCELLED'
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
              AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        occurrenceId);
    jdbc.update(
        """
            UPDATE notification_deliveries d SET status='CANCELLED'
            FROM notifications n
            WHERE d.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
              AND n.reference_id=?
              AND n.type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
              AND d.status IN ('PENDING','FAILED')
            """,
        occurrenceId);
    jdbc.update(
        """
            UPDATE notification_push_delivery_targets t
            SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
            FROM notifications n
            WHERE t.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
              AND n.reference_id=?
              AND n.type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
              AND t.status IN ('PENDING','FAILED')
            """,
        occurrenceId);
  }

  private void publishNewRecurringAssigneeAnnouncements(ChoreSchedule schedule, LocalDate today) {
    if (!schedule.isActive()
        || !schedule.getChore().isActive()
        || schedule.getChore().getArchivedAt() != null
        || (schedule.getEndsOn() != null && schedule.getEndsOn().isBefore(today))) {
      return;
    }

    Set<UUID> activeMembers =
        Set.copyOf(
            jdbc.query(
                """
                    SELECT user_id FROM household_memberships
                    WHERE household_id=? AND status='ACTIVE'
                    """,
                (rs, row) -> rs.getObject("user_id", UUID.class),
                schedule.getHousehold().getId()));
    List<UUID> recipients =
        participantIds(schedule).stream().filter(activeMembers::contains).distinct().toList();
    boolean rotating =
        schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN
            || schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM;

    for (UUID userId : recipients) {
      int inserted =
          jdbc.update(
              """
                      INSERT INTO recurring_chore_assignment_announcements (schedule_id, user_id)
                      VALUES (?, ?) ON CONFLICT (schedule_id, user_id) DO NOTHING
                      """,
              schedule.getId(),
              userId);
      if (inserted == 1) {
        Map<String, String> variables = new LinkedHashMap<>();
        variables.put("chore_name", schedule.getChore().getTitle());
        if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
          variables.put("notification_title", fixedRecurringAnnouncementTitle(schedule));
          variables.put(
              "notification_message",
              schedule.getChore().getTitle()
                  + " has been added to your recurring chores. You'll receive reminders before each due date.");
        } else if (rotating) {
          variables.put("notification_title", "New rotating chore assigned");
          variables.put(
              "notification_message",
              schedule.getChore().getTitle()
                  + " has been added to your rotating chores. We'll remind you when it's your turn.");
        }
        notificationEventService.publish(
            new NotificationEvent(
                "CHORE_ASSIGNED",
                null,
                schedule.getHousehold().getId(),
                "CHORE_SCHEDULE",
                schedule.getId(),
                "CHORE_REMINDER",
                Map.copyOf(variables),
                List.of(userId)));
      }
    }
  }

  private String fixedRecurringAnnouncementTitle(ChoreSchedule schedule) {
    RecurrenceRule rule = RecurrenceRule.parse(schedule.getRecurrenceRule());
    if (rule.interval() == 1 && rule.frequency() == RecurrenceRule.Frequency.DAILY) {
      return "New daily chore assigned";
    }
    if (rule.interval() == 1 && rule.frequency() == RecurrenceRule.Frequency.WEEKLY) {
      return "New weekly chore assigned";
    }
    return "New recurring chore assigned";
  }

  @Transactional
  public List<AssignmentResponse> myChores(
      UUID householdId, String status, Authentication authentication) {
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    generateHousehold(householdId);
    String predicate =
        switch (status == null ? "UPCOMING" : status) {
          case "UPCOMING" -> "a.status IN ('PENDING','SUBMITTED')";
          case "COMPLETED" -> "a.status='COMPLETED'";
          default -> throw new InvalidHouseholdException("Status must be UPCOMING or COMPLETED.");
        };
    return jdbc.query(
        """
                SELECT a.id FROM chore_assignments a
                JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id
                WHERE a.household_id=? AND aa.user_id=? AND a.status <> 'CANCELLED'
                  AND %s
                ORDER BY a.scheduled_for, a.due_at NULLS LAST, a.id
                """
            .formatted(predicate),
        (rs, row) -> assignmentResponse(rs.getObject("id", UUID.class), actor.getUser().getId()),
        householdId,
        actor.getUser().getId());
  }

  @Transactional
  public DashboardResponse dashboard(UUID householdId, Authentication authentication) {
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    generateHousehold(householdId);
    ZoneId zone = ZoneId.of(actor.getHousehold().getTimezone());
    LocalDate today = LocalDate.now(zone);
    LocalDate monday = today.with(DayOfWeek.MONDAY);
    LocalDate nextMonday = monday.plusDays(7);
    List<AssignmentResponse> todayAssignments =
        assignmentList(householdId, actor.getUser().getId(), today, today.plusDays(1));
    List<AssignmentResponse> weekAssignments =
        assignmentList(householdId, actor.getUser().getId(), monday, nextMonday);
    List<AssignmentResponse> overdueAssignments =
        overdueAssignmentList(householdId, actor.getUser().getId());
    long total =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM chore_assignments
                WHERE household_id=? AND scheduled_for>=? AND scheduled_for<?
                  AND status NOT IN ('CANCELLED','SKIPPED')
                """,
            Long.class,
            householdId,
            monday,
            nextMonday);
    long completed =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM chore_assignments
                WHERE household_id=? AND scheduled_for>=? AND scheduled_for<? AND status='COMPLETED'
                """,
            Long.class,
            householdId,
            monday,
            nextMonday);
    double percentage = total == 0 ? 0 : Math.round(completed * 1000.0 / total) / 10.0;
    return new DashboardResponse(
        new DashboardResponse.WeekSummary(completed, total, percentage),
        todayAssignments,
        weekAssignments,
        overdueAssignments);
  }

  @Transactional(readOnly = true)
  public List<HouseholdMemberStatsResponse> members(
      UUID householdId, Authentication authentication) {
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    ZoneId zone = ZoneId.of(actor.getHousehold().getTimezone());
    LocalDate today = LocalDate.now(zone);
    LocalDate monday = today.with(DayOfWeek.MONDAY);
    LocalDate nextMonday = monday.plusDays(7);
    return jdbc.query(
        """
                SELECT m.user_id, u.display_name, m.role, m.joined_at,
                    (SELECT COUNT(*) FROM chore_assignment_assignees aa
                     JOIN chore_assignments a ON a.id=aa.assignment_id
                     WHERE aa.household_id=m.household_id AND aa.user_id=m.user_id
                       AND a.scheduled_for>=? AND a.scheduled_for<? AND a.status<>'CANCELLED') assigned_count,
                    (SELECT COUNT(DISTINCT a.id) FROM chore_assignment_assignees aa
                     JOIN chore_assignments a ON a.id=aa.assignment_id
                     JOIN chore_completions cc ON cc.assignment_id=a.id
                     WHERE aa.household_id=m.household_id AND aa.user_id=m.user_id
                        AND a.scheduled_for>=? AND a.scheduled_for<? AND a.status='COMPLETED') completed_count
                FROM household_memberships m JOIN users u ON u.id=m.user_id
                WHERE m.household_id=? AND m.status='ACTIVE'
                ORDER BY m.joined_at, u.display_name
                """,
        (rs, row) ->
            new HouseholdMemberStatsResponse(
                rs.getObject("user_id", UUID.class),
                rs.getString("display_name"),
                HouseholdRole.valueOf(rs.getString("role")),
                rs.getObject("joined_at", OffsetDateTime.class),
                rs.getLong("assigned_count"),
                rs.getLong("completed_count")),
        monday,
        nextMonday,
        monday,
        nextMonday,
        householdId);
  }

  @Transactional
  public AssignmentResponse complete(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    lockHousehold(householdId);
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    List<String> rows =
        jdbc.query(
            "SELECT status FROM chore_assignments WHERE id=? AND household_id=? FOR UPDATE",
            (rs, row) -> rs.getString("status"),
            assignmentId,
            householdId);
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException("Assignment was not found in this household.");
    }
    String status = rows.getFirst();
    Boolean assigned =
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM chore_assignment_assignees
                              WHERE assignment_id=? AND household_id=? AND user_id=?)
                """,
            Boolean.class,
            assignmentId,
            householdId,
            actor.getUser().getId());
    if (!Boolean.TRUE.equals(assigned)) {
      throw new HouseholdAccessDeniedException(
          "Only an assigned household member may complete this chore.");
    }
    if (!"COMPLETED".equals(status)) {
      if (!"PENDING".equals(status) && !"SUBMITTED".equals(status)) {
        throw new InvalidHouseholdException("This assignment cannot be completed.");
      }
      OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
      Integer attempt =
          jdbc.queryForObject(
              "SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM chore_completions WHERE assignment_id=?",
              Integer.class,
              assignmentId);
      jdbc.update(
          """
                    INSERT INTO chore_completions
                        (household_id, assignment_id, attempt_number, completed_by_user_id, completed_at)
                    VALUES (?, ?, ?, ?, ?) ON CONFLICT (assignment_id, attempt_number) DO NOTHING
                    """,
          householdId,
          assignmentId,
          attempt,
          actor.getUser().getId(),
          now);
      jdbc.update(
          "UPDATE chore_assignments SET status='COMPLETED', updated_at=NOW() "
              + "WHERE id=? AND household_id=? AND status IN ('PENDING','SUBMITTED')",
          assignmentId,
          householdId);
      cancelPendingNotifications(assignmentId);
      String title =
          jdbc.queryForObject(
              "SELECT title_snapshot FROM chore_assignments WHERE id=? AND household_id=?",
              String.class,
              assignmentId,
              householdId);
      List<UUID> recipients =
          jdbc.query(
              """
                    SELECT user_id FROM household_memberships
                    WHERE household_id=? AND status='ACTIVE' AND user_id<>?
                    """,
              (rs, row) -> rs.getObject("user_id", UUID.class),
              householdId,
              actor.getUser().getId());
      notificationEventService.publish(
          new NotificationEvent(
              "CHORE_COMPLETED",
              actor.getUser().getId(),
              householdId,
              "CHORE_ASSIGNMENT",
              assignmentId,
              "CHORE_COMPLETION",
              java.util.Map.of("chore_name", title),
              recipients));
    }
    return assignmentResponse(assignmentId, actor.getUser().getId());
  }

  // ---- Single-occurrence actions -------------------------------------------------------------
  //
  // Every action takes the household lock, then the schedule row, then the occurrence row, the
  // same order generation and series edits use, so it cannot interleave with completion, a
  // member exit or background generation. Updates are guarded by status, so a cancelled or
  // completed occurrence is never revived by a racing action.

  /** One occurrence as the given member sees it, including the actions they may take. */
  @Transactional(readOnly = true)
  public AssignmentResponse occurrence(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    HouseholdMembership viewer = requireActiveMember(householdId, authentication);
    Boolean exists =
        jdbc.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM chore_assignments WHERE id=? AND household_id=?)",
            Boolean.class,
            assignmentId,
            householdId);
    if (!Boolean.TRUE.equals(exists)) {
      throw new ResourceNotFoundException("Assignment was not found in this household.");
    }
    return assignmentResponse(assignmentId, viewer.getUser().getId());
  }

  /** Moves one pending occurrence to another day, optionally with a new due time. */
  @Transactional
  public AssignmentResponse move(
      UUID householdId,
      UUID assignmentId,
      LocalDate date,
      java.time.LocalTime time,
      Authentication authentication) {
    ActionContext context = lockForAction(householdId, assignmentId, authentication);
    LockedOccurrence occurrence = context.occurrence();
    if (!context.admin() && !context.assigned()) {
      throw new InvalidHouseholdException("You can only move chores that are assigned to you.");
    }
    requirePending(occurrence, "moved");
    if (date == null) {
      throw new InvalidHouseholdException("Choose a day to move this chore to.");
    }
    if (date.isBefore(context.today())) {
      throw new InvalidHouseholdException("Choose today or a later day.");
    }
    boolean oneTime = context.oneTime();
    LocalDate firstDay =
        oneTime
            ? (occurrence.movedFrom() == null ? occurrence.scheduledFor() : occurrence.movedFrom())
            : occurrence.plannedFor();
    if (!context.admin()
        && Math.abs(java.time.temporal.ChronoUnit.DAYS.between(firstDay, date))
            > MOVE_WINDOW_DAYS) {
      throw new InvalidHouseholdException(
          "You can move your chore up to 7 days before or after its original day.");
    }
    if (dayTaken(context, date)) {
      throw new InvalidHouseholdException(OCCUPIED_DAY_MESSAGE);
    }

    ZoneId zone = context.zone();
    java.time.LocalTime effectiveTime =
        time != null
            ? time
            : occurrence.dueAt() == null
                ? null
                : occurrence.dueAt().atZoneSameInstant(zone).toLocalTime();
    OffsetDateTime newDueAt = effectiveTime == null ? null : dueAt(date, effectiveTime, zone);
    boolean dateChanged = !date.equals(occurrence.scheduledFor());
    boolean dueChanged =
        occurrence.dueAt() == null
            ? newDueAt != null
            : newDueAt == null || !occurrence.dueAt().isEqual(newDueAt);
    if (!dateChanged && !dueChanged) {
      return assignmentResponse(occurrence.id(), context.actorId());
    }

    if (oneTime) {
      // A one-time chore's single occurrence follows its schedule: moving it is a due-date edit
      // (same row, reminders re-planned). The first day is remembered for the "moved" hint and
      // the assignee's move window.
      ChoreSchedule schedule = context.schedule();
      Boolean cancelledThere =
          jdbc.queryForObject(
              """
                  SELECT EXISTS(SELECT 1 FROM chore_assignments
                                WHERE schedule_id=? AND id<>? AND planned_for=?)
                  """,
              Boolean.class,
              schedule.getId(),
              occurrence.id(),
              date);
      if (Boolean.TRUE.equals(cancelledThere)) {
        throw new InvalidHouseholdException(
            "The selected due date has a cancelled assignment. Choose another due date.");
      }
      schedule.setStartsOn(date);
      if (time != null) {
        schedule.setDueTime(time);
      }
      if (schedule.getEndsOn() != null && schedule.getEndsOn().isBefore(date)) {
        schedule.setEndsOn(date);
      }
      scheduleRepository.saveAndFlush(schedule);
      boolean backToFirstDay = date.equals(firstDay);
      jdbc.update(
          """
              UPDATE chore_assignments
              SET scheduled_for=?, planned_for=?, due_at=?, date_overridden=?,
                  metadata=CASE WHEN ? THEN metadata - 'movedFrom'
                                ELSE metadata || jsonb_build_object('movedFrom', ?::text) END,
                  updated_at=NOW()
              WHERE id=? AND status='PENDING'
              """,
          date,
          date,
          newDueAt,
          !backToFirstDay,
          backToFirstDay,
          firstDay.toString(),
          occurrence.id());
    } else {
      boolean overridden =
          !date.equals(occurrence.plannedFor())
              || !java.util.Objects.equals(effectiveTime, context.schedule().getDueTime());
      jdbc.update(
          """
              UPDATE chore_assignments
              SET scheduled_for=?, due_at=?, date_overridden=?, updated_at=NOW()
              WHERE id=? AND status='PENDING'
              """,
          date,
          newDueAt,
          overridden,
          occurrence.id());
    }
    recordAction(occurrence.id(), "MOVE", context.actorId());
    if (dueChanged) {
      // Reminders follow the new deadline: pending ones go now and the notification scheduler
      // plans replacements. Delivered reminders are never sent again.
      cancelPendingOccurrenceReminders(occurrence.id());
    }
    String newDate = DAY_FORMAT.format(date);
    if (time != null && newDueAt != null) {
      newDate = newDate + " at " + TIME_FORMAT.format(newDueAt.atZoneSameInstant(zone));
    }
    notifyAssignees(
        context,
        "CHORE_OCCURRENCE_MOVED",
        Map.of(
            "chore_name",
            occurrence.title(),
            "new_date",
            newDate,
            "notification_title",
            occurrence.title() + " moved",
            "notification_message",
            occurrence.title() + " moved to " + newDate));
    return assignmentResponse(occurrence.id(), context.actorId());
  }

  /** Skips one pending occurrence. It still counts as that person's turn in a rotation. */
  @Transactional
  public AssignmentResponse skip(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    ActionContext context = lockForAction(householdId, assignmentId, authentication);
    requireAdmin(context, "skip");
    LockedOccurrence occurrence = context.occurrence();
    requirePending(occurrence, "skipped");
    jdbc.update(
        "UPDATE chore_assignments SET status='SKIPPED', updated_at=NOW() "
            + "WHERE id=? AND status='PENDING'",
        occurrence.id());
    recordAction(occurrence.id(), "SKIP", context.actorId());
    cancelPendingOccurrenceReminders(occurrence.id());
    String day = DAY_FORMAT.format(occurrence.scheduledFor());
    notifyAssignees(
        context,
        "CHORE_OCCURRENCE_SKIPPED",
        Map.of(
            "chore_name",
            occurrence.title(),
            "original_day",
            day,
            "notification_title",
            occurrence.title() + " skipped",
            "notification_message",
            occurrence.title() + " on " + day + " was skipped"));
    return assignmentResponse(occurrence.id(), context.actorId());
  }

  /** Brings back a skipped occurrence while its day is today or later. */
  @Transactional
  public AssignmentResponse unskip(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    ActionContext context = lockForAction(householdId, assignmentId, authentication);
    requireAdmin(context, "restore");
    LockedOccurrence occurrence = context.occurrence();
    if (!"SKIPPED".equals(occurrence.status())) {
      throw new InvalidHouseholdException("Only a skipped chore can be restored.");
    }
    if (occurrence.scheduledFor().isBefore(context.today())) {
      throw new InvalidHouseholdException("This day has passed, so the skip can't be undone.");
    }
    ChoreSchedule schedule = context.schedule();
    if (schedule != null
        && (!schedule.isActive()
            || !schedule.getChore().isActive()
            || schedule.getChore().getArchivedAt() != null)) {
      throw new InvalidHouseholdException(
          "Turn this chore back on before restoring a skipped day.");
    }
    if (schedule != null
        && !context.oneTime()
        && !occurrence.plannedFor().isBefore(context.today())
        && !producesOn(schedule, occurrence.plannedFor())) {
      throw new InvalidHouseholdException("This day is no longer part of the chore's schedule.");
    }
    if (dayTaken(context, occurrence.scheduledFor())) {
      throw new InvalidHouseholdException(OCCUPIED_DAY_MESSAGE);
    }
    jdbc.update(
        "UPDATE chore_assignments SET status='PENDING', updated_at=NOW() "
            + "WHERE id=? AND status='SKIPPED'",
        occurrence.id());
    recordAction(occurrence.id(), "UNSKIP", context.actorId());
    return assignmentResponse(occurrence.id(), context.actorId());
  }

  /** Gives one pending occurrence to 1 to N current members, N being the chore's people needed. */
  @Transactional
  public AssignmentResponse reassign(
      UUID householdId, UUID assignmentId, List<UUID> userIds, Authentication authentication) {
    ActionContext context = lockForAction(householdId, assignmentId, authentication);
    requireAdmin(context, "reassign");
    LockedOccurrence occurrence = context.occurrence();
    requirePending(occurrence, "reassigned");
    int maxPeople = context.schedule() == null ? 1 : peopleNeeded(context.schedule());
    List<UUID> chosen = userIds == null ? List.of() : userIds.stream().distinct().toList();
    if (chosen.isEmpty() || chosen.size() > maxPeople || chosen.contains(null)) {
      throw new InvalidHouseholdException(
          maxPeople == 1
              ? "Choose one person for this chore."
              : "Choose between 1 and " + maxPeople + " people for this chore.");
    }
    if (activeMembersOnly(householdId, chosen).size() != chosen.size()) {
      throw new InvalidHouseholdException(
          "Everyone you choose must be a current household member.");
    }
    List<UUID> previous = context.assignees();
    if (Set.copyOf(previous).equals(Set.copyOf(chosen))) {
      return assignmentResponse(occurrence.id(), context.actorId());
    }
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrence.id());
    jdbc.update(
        """
            UPDATE chore_assignments
            SET assigned_to_user_id=?, assigned_by_user_id=?, assignees_overridden=TRUE,
                updated_at=NOW()
            WHERE id=? AND status='PENDING'
            """,
        chosen.getFirst(),
        context.actorId(),
        occurrence.id());
    insertAssignees(occurrence.id(), householdId, chosen);
    recordAction(occurrence.id(), "REASSIGN", context.actorId());
    // Removed people stop getting reminders now; the scheduler plans the new people's reminders.
    cancelPendingRemindersFor(
        occurrence.id(), previous.stream().filter(userId -> !chosen.contains(userId)).toList());
    announceOccurrenceAssignment(
        householdId,
        occurrence.id(),
        occurrence.title(),
        occurrence.scheduledFor(),
        context.actorId(),
        chosen.stream().filter(userId -> !previous.contains(userId)).toList());
    return assignmentResponse(occurrence.id(), context.actorId());
  }

  /**
   * Re-anchors a COUNT series when a series edit changes its rule or start date, so the series
   * still ends after COUNT occurrences in total. Occurrences already produced are counted: every
   * non-cancelled occurrence planned before today, plus finished ones (completed, submitted or
   * skipped) planned from today on a day the new rule no longer produces. The remainder is then
   * produced from today, anchored on the original start date so intervals keep their weeks. Without
   * COUNT the anchor is cleared.
   */
  @Transactional
  public void anchorCountRemainder(ChoreSchedule schedule) {
    RecurrenceRule rule = RecurrenceRule.parse(schedule.getRecurrenceRule());
    if (rule.count().isEmpty() || rule.isOneTime() || schedule.getId() == null) {
      schedule.setCountRebasedOn(null);
      schedule.setCountProducedBefore(null);
      return;
    }
    LocalDate today = LocalDate.now(ZoneId.of(schedule.getTimezone()));
    Integer before =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM chore_assignments
                WHERE schedule_id=? AND planned_for<? AND status<>'CANCELLED'
                """,
            Integer.class,
            schedule.getId(),
            today);
    List<LocalDate> finishedLater =
        jdbc.queryForList(
            """
                SELECT planned_for FROM chore_assignments
                WHERE schedule_id=? AND planned_for>=?
                  AND status IN ('COMPLETED','SUBMITTED','SKIPPED')
                """,
            LocalDate.class,
            schedule.getId(),
            today);
    RecurrenceRule uncapped = rule.withoutCount();
    long offRule =
        finishedLater.stream()
            .filter(day -> !uncapped.occursOn(schedule.getStartsOn(), day))
            .count();
    schedule.setCountRebasedOn(today);
    schedule.setCountProducedBefore((before == null ? 0 : before) + (int) offRule);
  }

  /** Dates the schedule produces in [from, untilExclusive), honouring COUNT and its re-anchor. */
  private List<LocalDate> scheduleDates(
      ChoreSchedule schedule, LocalDate from, LocalDate untilExclusive) {
    RecurrenceRule rule = RecurrenceRule.parse(schedule.getRecurrenceRule());
    if (rule.count().isPresent()
        && schedule.getCountRebasedOn() != null
        && schedule.getCountProducedBefore() != null) {
      int remaining = Math.max(0, rule.count().get() - schedule.getCountProducedBefore());
      if (remaining == 0) {
        return List.of();
      }
      LocalDate anchor =
          schedule.getCountRebasedOn().isAfter(schedule.getStartsOn())
              ? schedule.getCountRebasedOn()
              : schedule.getStartsOn();
      return rule
          .withoutCount()
          .datesBetween(schedule.getStartsOn(), anchor, untilExclusive)
          .stream()
          .limit(remaining)
          .filter(day -> !day.isBefore(from))
          .toList();
    }
    return rule.datesBetween(schedule.getStartsOn(), from, untilExclusive);
  }

  /** Whether an active schedule's rule produces {@code date} (within its end date). */
  private boolean producesOn(ChoreSchedule schedule, LocalDate date) {
    if (!schedule.isActive()
        || !schedule.getChore().isActive()
        || schedule.getChore().getArchivedAt() != null
        || date.isBefore(schedule.getStartsOn())
        || (schedule.getEndsOn() != null && date.isAfter(schedule.getEndsOn()))) {
      return false;
    }
    return scheduleDates(schedule, date, date.plusDays(1)).contains(date);
  }

  /**
   * Whether another occurrence of the same chore already holds {@code date}: a live one (to do,
   * submitted or done) on that day, or a rule date that has not been generated yet.
   */
  private boolean dayTaken(ActionContext context, LocalDate date) {
    ChoreSchedule schedule = context.schedule();
    if (schedule == null) {
      return false;
    }
    LockedOccurrence occurrence = context.occurrence();
    Boolean live =
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM chore_assignments
                              WHERE schedule_id=? AND id<>? AND scheduled_for=?
                                AND status IN ('PENDING','SUBMITTED','COMPLETED'))
                """,
            Boolean.class,
            schedule.getId(),
            occurrence.id(),
            date);
    if (Boolean.TRUE.equals(live)) {
      return true;
    }
    if (context.oneTime() || date.equals(occurrence.plannedFor())) {
      return false;
    }
    Boolean planned =
        jdbc.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM chore_assignments WHERE schedule_id=? AND planned_for=?)",
            Boolean.class,
            schedule.getId(),
            date);
    return !Boolean.TRUE.equals(planned) && producesOn(schedule, date);
  }

  private ActionContext lockForAction(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    lockHousehold(householdId);
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    List<UUID> scheduleIds =
        jdbc.query(
            "SELECT schedule_id FROM chore_assignments WHERE id=? AND household_id=?",
            (rs, row) -> rs.getObject("schedule_id", UUID.class),
            assignmentId,
            householdId);
    if (scheduleIds.isEmpty()) {
      throw new ResourceNotFoundException("Assignment was not found in this household.");
    }
    ChoreSchedule schedule = null;
    if (scheduleIds.getFirst() != null) {
      schedule = scheduleRepository.findByIdForUpdate(scheduleIds.getFirst()).orElse(null);
      if (schedule != null) {
        entityManager.refresh(schedule, LockModeType.PESSIMISTIC_WRITE);
      }
    }
    LockedOccurrence occurrence =
        jdbc.queryForObject(
            """
                SELECT id, status, scheduled_for, planned_for, due_at, title_snapshot,
                       metadata->>'movedFrom' moved_from
                FROM chore_assignments WHERE id=? AND household_id=? FOR UPDATE
                """,
            (rs, row) ->
                new LockedOccurrence(
                    rs.getObject("id", UUID.class),
                    rs.getString("status"),
                    rs.getObject("scheduled_for", LocalDate.class),
                    rs.getObject("planned_for", LocalDate.class),
                    rs.getObject("due_at", OffsetDateTime.class),
                    rs.getString("title_snapshot"),
                    rs.getString("moved_from") == null
                        ? null
                        : LocalDate.parse(rs.getString("moved_from"))),
            assignmentId,
            householdId);
    UUID actorId = actor.getUser().getId();
    List<UUID> assignees = currentAssignees(assignmentId);
    ZoneId zone =
        ZoneId.of(schedule != null ? schedule.getTimezone() : actor.getHousehold().getTimezone());
    return new ActionContext(
        actorId,
        actor.getRole() == HouseholdRole.OWNER || actor.getRole() == HouseholdRole.ADMIN,
        assignees.contains(actorId),
        assignees,
        schedule,
        schedule != null && "FREQ=ONCE".equals(schedule.getRecurrenceRule()),
        occurrence,
        zone,
        LocalDate.now(zone),
        householdId);
  }

  private static void requireAdmin(ActionContext context, String verb) {
    if (!context.admin()) {
      throw new InvalidHouseholdException(
          "Only household owners and admins can " + verb + " a chore.");
    }
  }

  private static void requirePending(LockedOccurrence occurrence, String participle) {
    if (!"PENDING".equals(occurrence.status())) {
      throw new InvalidHouseholdException(
          "Only a chore that is still to do can be " + participle + ".");
    }
  }

  /** Records who acted last, by id only, for audit. Nothing is logged. */
  private void recordAction(UUID occurrenceId, String action, UUID actorId) {
    jdbc.update(
        """
            UPDATE chore_assignments
            SET metadata = metadata || jsonb_build_object('lastAction', jsonb_build_object(
                    'type', ?::text, 'byUserId', ?::text, 'at', NOW()))
            WHERE id=?
            """,
        action,
        actorId.toString(),
        occurrenceId);
  }

  private List<UUID> currentAssignees(UUID occurrenceId) {
    return jdbc.queryForList(
        """
            SELECT user_id FROM chore_assignment_assignees
            WHERE assignment_id=? ORDER BY created_at, user_id
            """,
        UUID.class,
        occurrenceId);
  }

  /** Tells the occurrence's assignees about a change someone else made. */
  private void notifyAssignees(ActionContext context, String type, Map<String, String> variables) {
    List<UUID> recipients =
        context.assignees().stream().filter(userId -> !userId.equals(context.actorId())).toList();
    publishPerRecipient(
        type,
        context.actorId(),
        context.householdId(),
        context.occurrence().id(),
        variables,
        recipients);
  }

  /** CHORE_ASSIGNED for people newly given one occurrence (never the person who acted). */
  private void announceOccurrenceAssignment(
      UUID householdId,
      UUID occurrenceId,
      String title,
      LocalDate day,
      UUID actorId,
      List<UUID> recipients) {
    List<UUID> others =
        recipients.stream().filter(userId -> !userId.equals(actorId)).distinct().toList();
    publishPerRecipient(
        "CHORE_ASSIGNED",
        actorId,
        householdId,
        occurrenceId,
        Map.of(
            "chore_name",
            title,
            "notification_title",
            "Chore assigned",
            "notification_message",
            "You're assigned " + title + " on " + DAY_FORMAT.format(day) + "."),
        others);
  }

  /**
   * Publishes one event per recipient. A repeat of the same type for the same occurrence and person
   * (a second move, or being reassigned back) gets a versioned deduplication key so it is delivered
   * instead of being dropped as a duplicate of the first.
   */
  private void publishPerRecipient(
      String type,
      UUID actorId,
      UUID householdId,
      UUID occurrenceId,
      Map<String, String> variables,
      List<UUID> recipients) {
    for (UUID recipient : recipients.stream().distinct().toList()) {
      Integer earlier =
          jdbc.queryForObject(
              """
                  SELECT COUNT(*) FROM notifications
                  WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=?
                    AND recipient_user_id=? AND type=?
                  """,
              Integer.class,
              occurrenceId,
              recipient,
              type);
      Map<String, String> eventVariables = new java.util.HashMap<>(variables);
      if (earlier != null && earlier > 0) {
        eventVariables.put(
            com.dirtyduty.app.notification.DefaultNotificationGenerator.DEDUPLICATION_REVISION,
            "r" + (earlier + 1));
      }
      notificationEventService.publish(
          new NotificationEvent(
              type,
              actorId,
              householdId,
              "CHORE_ASSIGNMENT",
              occurrenceId,
              "CHORE_REMINDER",
              Map.copyOf(eventVariables),
              List.of(recipient)));
    }
  }

  /** Cancels pending reminders of one occurrence for the given people only. */
  private void cancelPendingRemindersFor(UUID occurrenceId, List<UUID> userIds) {
    for (UUID userId : userIds) {
      jdbc.update(
          """
              UPDATE notifications SET status='CANCELLED'
              WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND recipient_user_id=?
                AND status='PENDING' AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
              """,
          occurrenceId,
          userId);
      jdbc.update(
          """
              UPDATE notification_deliveries d SET status='CANCELLED'
              FROM notifications n
              WHERE d.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
                AND n.reference_id=? AND n.recipient_user_id=?
                AND n.type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
                AND d.status IN ('PENDING','FAILED')
              """,
          occurrenceId,
          userId);
      jdbc.update(
          """
              UPDATE notification_push_delivery_targets t
              SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
              FROM notifications n
              WHERE t.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
                AND n.reference_id=? AND n.recipient_user_id=?
                AND n.type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
                AND t.status IN ('PENDING','FAILED')
              """,
          occurrenceId,
          userId);
    }
  }

  private static final java.time.format.DateTimeFormatter DAY_FORMAT =
      java.time.format.DateTimeFormatter.ofPattern("EEE, MMM d", java.util.Locale.ENGLISH);
  private static final java.time.format.DateTimeFormatter TIME_FORMAT =
      java.time.format.DateTimeFormatter.ofPattern("h:mm a", java.util.Locale.ENGLISH);

  private record LockedOccurrence(
      UUID id,
      String status,
      LocalDate scheduledFor,
      LocalDate plannedFor,
      OffsetDateTime dueAt,
      String title,
      LocalDate movedFrom) {}

  private record ActionContext(
      UUID actorId,
      boolean admin,
      boolean assigned,
      List<UUID> assignees,
      ChoreSchedule schedule,
      boolean oneTime,
      LockedOccurrence occurrence,
      ZoneId zone,
      LocalDate today,
      UUID householdId) {}

  @Transactional
  public void generateHousehold(UUID householdId) {
    lockHousehold(householdId);
    List<UUID> scheduleIds =
        jdbc.query(
            "SELECT id FROM chore_schedules WHERE household_id=? AND is_active=TRUE ORDER BY id",
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId);
    for (UUID scheduleId : scheduleIds) {
      ChoreSchedule schedule =
          scheduleRepository
              .findByIdForUpdate(scheduleId)
              .orElseThrow(() -> new IllegalStateException("A locked chore schedule disappeared."));
      entityManager.refresh(schedule, LockModeType.PESSIMISTIC_WRITE);
      entityManager.refresh(schedule.getChore());
      entityManager.refresh(schedule.getHousehold());
      if (!schedule.isActive()) {
        continue;
      }
      if (!hasSupportedRule(schedule)) {
        // A stored rule the parser rejects (e.g. legacy data) must not fail generation for the
        // rest of the household. Skip it: nothing new is generated and its existing occurrences
        // are left untouched. Saving still rejects such rules. Only the id is logged.
        log.warn(
            "Skipping occurrence generation for schedule {}: unsupported recurrence rule",
            scheduleId);
        continue;
      }
      synchronizeLockedSchedule(schedule, false, false);
    }
  }

  private static boolean hasSupportedRule(ChoreSchedule schedule) {
    try {
      RecurrenceRule.parse(schedule.getRecurrenceRule());
      return true;
    } catch (InvalidHouseholdException exception) {
      return false;
    }
  }

  private void lockHousehold(UUID householdId) {
    if (jdbc.query(
            "SELECT id FROM households WHERE id=? FOR UPDATE",
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId)
        .isEmpty()) {
      throw new HouseholdAccessDeniedException("You are not an ACTIVE household member.");
    }
  }

  private void synchronizeLockedSchedule(
      ChoreSchedule schedule, boolean updatePendingAssignees, boolean userInitiatedEdit) {
    synchronizeSchedule(schedule, updatePendingAssignees, userInitiatedEdit);
  }

  private List<AssignmentResponse> assignmentList(
      UUID householdId, UUID userId, LocalDate from, LocalDate until) {
    List<UUID> ids =
        jdbc.query(
            """
                SELECT a.id FROM chore_assignments a
                WHERE a.household_id=? AND a.scheduled_for>=? AND a.scheduled_for<?
                  AND a.status<>'CANCELLED'
                ORDER BY a.scheduled_for, a.due_at NULLS LAST, a.id
                """,
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId,
            from,
            until);
    return ids.stream().map(id -> assignmentResponse(id, userId)).toList();
  }

  private List<AssignmentResponse> overdueAssignmentList(UUID householdId, UUID userId) {
    List<UUID> ids =
        jdbc.query(
            """
                SELECT a.id FROM chore_assignments a
                JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id
                WHERE a.household_id=? AND aa.user_id=?
                  AND a.status IN ('PENDING','SUBMITTED')
                  AND a.due_at IS NOT NULL AND a.due_at<?
                ORDER BY a.due_at, a.scheduled_for, a.id
                """,
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId,
            userId,
            OffsetDateTime.now(ZoneOffset.UTC));
    return ids.stream().map(id -> assignmentResponse(id, userId)).toList();
  }

  private void cancelPendingNotifications(UUID assignmentId) {
    jdbc.update(
        """
                UPDATE notifications SET status='CANCELLED'
                WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
                """,
        assignmentId);
    jdbc.update(
        """
                UPDATE notification_deliveries d SET status='CANCELLED'
                FROM notifications n
                WHERE d.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
                  AND n.reference_id=? AND d.status='PENDING'
                """,
        assignmentId);
    jdbc.update(
        """
                UPDATE notification_push_delivery_targets t
                SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
                FROM notifications n
                WHERE t.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
                  AND n.reference_id=? AND t.status IN ('PENDING','FAILED')
                """,
        assignmentId);
  }

  private AssignmentResponse assignmentResponse(UUID id, UUID viewerId) {
    return jdbc.queryForObject(
        """
                SELECT a.id, a.household_id, a.chore_id, a.scheduled_for, a.due_at, a.status,
                       a.title_snapshot, a.priority_snapshot, a.difficulty_snapshot,
                       a.estimated_minutes_snapshot, c.name category_name, c.icon_key category_icon,
                       cc.completed_at, cu.display_name completed_by,
                       a.planned_for, a.date_overridden, a.assignees_overridden,
                       a.metadata->>'movedFrom' moved_from,
                       s.recurrence_rule='FREQ=ONCE' one_time, s.strategy_config->'peopleNeeded'
                           people_needed,
                       (NOW() AT TIME ZONE h.timezone)::date household_today,
                       vm.role viewer_role
                FROM chore_assignments a
                JOIN chores ch ON ch.id=a.chore_id
                JOIN households h ON h.id=a.household_id
                LEFT JOIN chore_schedules s ON s.id=a.schedule_id
                LEFT JOIN household_memberships vm
                    ON vm.household_id=a.household_id AND vm.user_id=? AND vm.status='ACTIVE'
                LEFT JOIN chore_categories c ON c.id=ch.category_id
                LEFT JOIN LATERAL (SELECT completed_at, completed_by_user_id
                                   FROM chore_completions WHERE assignment_id=a.id
                                   ORDER BY completed_at DESC LIMIT 1) cc ON TRUE
                LEFT JOIN users cu ON cu.id=cc.completed_by_user_id
                WHERE a.id=?
                """,
        (rs, row) -> mapAssignment(rs, viewerId),
        viewerId,
        id);
  }

  private AssignmentResponse mapAssignment(ResultSet rs, UUID viewerId) throws SQLException {
    UUID id = rs.getObject("id", UUID.class);
    UUID householdId = rs.getObject("household_id", UUID.class);
    List<AssigneeResponse> assignees =
        jdbc.query(
            """
                SELECT aa.user_id, u.display_name FROM chore_assignment_assignees aa
                JOIN users u ON u.id=aa.user_id
                WHERE aa.assignment_id=? AND aa.household_id=?
                ORDER BY aa.created_at, aa.user_id
                """,
            (assigneeRs, row) ->
                new AssigneeResponse(
                    assigneeRs.getObject("user_id", UUID.class),
                    assigneeRs.getString("display_name")),
            id,
            householdId);
    OffsetDateTime dueAt = rs.getObject("due_at", OffsetDateTime.class);
    String dbStatus = rs.getString("status");
    boolean pending = "PENDING".equals(dbStatus) || "SUBMITTED".equals(dbStatus);
    boolean canComplete = pending && assignees.stream().anyMatch(a -> a.userId().equals(viewerId));
    boolean overdue = pending && dueAt != null && dueAt.isBefore(OffsetDateTime.now());
    LocalDate scheduledFor = rs.getObject("scheduled_for", LocalDate.class);
    LocalDate original = originalDate(rs, scheduledFor);
    boolean viewerAssigned = assignees.stream().anyMatch(a -> a.userId().equals(viewerId));
    AssignmentResponse.Actions actions =
        actionsFor(
            dbStatus,
            "OWNER".equals(rs.getString("viewer_role"))
                || "ADMIN".equals(rs.getString("viewer_role")),
            viewerAssigned,
            rs.getObject("household_today", LocalDate.class),
            scheduledFor,
            original == null ? rs.getObject("planned_for", LocalDate.class) : original,
            peopleNeeded(rs.getString("people_needed")));
    return new AssignmentResponse(
        id,
        householdId,
        rs.getObject("chore_id", UUID.class),
        rs.getString("category_name"),
        rs.getString("category_icon"),
        rs.getString("title_snapshot"),
        scheduledFor,
        dueAt,
        switch (dbStatus) {
          case "COMPLETED", "CANCELLED", "SKIPPED" -> dbStatus;
          default -> "PENDING";
        },
        ChorePriority.valueOf(rs.getString("priority_snapshot")),
        rs.getShort("difficulty_snapshot"),
        (Integer) rs.getObject("estimated_minutes_snapshot"),
        assignees,
        canComplete,
        overdue,
        rs.getObject("completed_at", OffsetDateTime.class),
        rs.getString("completed_by"),
        original,
        rs.getBoolean("date_overridden"),
        rs.getBoolean("assignees_overridden"),
        actions);
  }

  /**
   * The day an occurrence was originally due when it has been moved to another day, else null. A
   * recurring occurrence keeps its planned date; a one-time chore's single occurrence follows its
   * due date, so the day before its first move is kept in metadata.
   */
  private static LocalDate originalDate(ResultSet rs, LocalDate scheduledFor) throws SQLException {
    LocalDate original =
        rs.getBoolean("one_time")
            ? (rs.getString("moved_from") == null
                ? null
                : LocalDate.parse(rs.getString("moved_from")))
            : rs.getObject("planned_for", LocalDate.class);
    return original == null || original.equals(scheduledFor) ? null : original;
  }

  /**
   * What the viewer may do with one occurrence. Only PENDING occurrences (overdue included) can be
   * moved, skipped or reassigned. The assignee may move their own within {@link #MOVE_WINDOW_DAYS}
   * of the original date and never before today; OWNER and ADMIN may move to any day from today.
   */
  static AssignmentResponse.Actions actionsFor(
      String status,
      boolean admin,
      boolean assigned,
      LocalDate today,
      LocalDate scheduledFor,
      LocalDate anchor,
      int peopleNeeded) {
    boolean pending = "PENDING".equals(status);
    LocalDate earliest = null;
    LocalDate latest = null;
    boolean canMove = false;
    if (pending && admin) {
      canMove = true;
      earliest = today;
    } else if (pending && assigned) {
      LocalDate windowStart = anchor.minusDays(MOVE_WINDOW_DAYS);
      earliest = windowStart.isBefore(today) ? today : windowStart;
      latest = anchor.plusDays(MOVE_WINDOW_DAYS);
      canMove = !latest.isBefore(earliest);
      if (!canMove) {
        earliest = null;
        latest = null;
      }
    }
    return new AssignmentResponse.Actions(
        canMove,
        pending && admin,
        admin && "SKIPPED".equals(status) && !scheduledFor.isBefore(today),
        pending && admin,
        earliest,
        latest,
        peopleNeeded);
  }

  private static int peopleNeeded(String value) {
    try {
      return value == null ? 1 : Math.max(1, Integer.parseInt(value.trim()));
    } catch (NumberFormatException exception) {
      return 1;
    }
  }

  private void ensureLegacyAssigneeRelation(UUID assignmentId, UUID householdId) {
    jdbc.update(
        """
                INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
                SELECT household_id, id, assigned_to_user_id FROM chore_assignments
                WHERE id=? AND household_id=? AND assigned_to_user_id IS NOT NULL
                ON CONFLICT (assignment_id, user_id) DO NOTHING
                """,
        assignmentId,
        householdId);
  }

  private String status(UUID occurrenceId) {
    return jdbc.queryForObject(
        "SELECT status FROM chore_assignments WHERE id=?", String.class, occurrenceId);
  }

  private List<UUID> selectedAssignees(ChoreSchedule schedule, LocalDate date) {
    int needed = peopleNeeded(schedule);
    List<UUID> pool = new ArrayList<>(participantIds(schedule));
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
      if (pool.isEmpty() && schedule.getFixedAssignee() != null) {
        pool = List.of(schedule.getFixedAssignee().getId());
      }
      return pool.subList(0, Math.min(needed, pool.size()));
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM) {
      Collections.shuffle(pool, RANDOM);
      return List.copyOf(pool.subList(0, needed));
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN) {
      List<UUID> rotationPool = pool;
      List<Integer> counts =
          jdbc.query(
              """
                    SELECT aa.user_id, COUNT(*) AS n
                    FROM chore_assignment_assignees aa
                    JOIN chore_assignments a ON a.id=aa.assignment_id
                    WHERE a.schedule_id=? AND a.planned_for<? AND a.status<>'CANCELLED'
                    GROUP BY aa.user_id
                    """,
              rs -> {
                Map<UUID, Integer> values = new java.util.HashMap<>();
                while (rs.next()) {
                  values.put(rs.getObject("user_id", UUID.class), rs.getInt("n"));
                }
                return rotationPool.stream().map(userId -> values.getOrDefault(userId, 0)).toList();
              },
              schedule.getId(),
              date);
      Map<String, Integer> pairCounts =
          jdbc.query(
              """
                    SELECT aa.user_id AS left_id, bb.user_id AS right_id, COUNT(*) AS n
                    FROM chore_assignment_assignees aa
                    JOIN chore_assignment_assignees bb
                      ON bb.assignment_id=aa.assignment_id AND aa.user_id<bb.user_id
                    JOIN chore_assignments a ON a.id=aa.assignment_id
                    WHERE a.schedule_id=? AND a.planned_for<? AND a.status<>'CANCELLED'
                    GROUP BY aa.user_id, bb.user_id
                    """,
              rs -> {
                Map<String, Integer> values = new java.util.HashMap<>();
                while (rs.next()) {
                  values.put(
                      pairKey(
                          rs.getObject("left_id", UUID.class),
                          rs.getObject("right_id", UUID.class)),
                      rs.getInt("n"));
                }
                return values;
              },
              schedule.getId(),
              date);
      return rotate(pool, needed, occurrenceIndex(schedule, date), counts, pairCounts);
    }
    return List.of();
  }

  static List<UUID> rotate(List<UUID> pool, int peopleNeeded, int occurrenceIndex) {
    return rotate(
        pool, peopleNeeded, occurrenceIndex, Collections.nCopies(pool.size(), 0), Map.of());
  }

  static List<UUID> rotate(
      List<UUID> pool,
      int peopleNeeded,
      int occurrenceIndex,
      List<Integer> priorCounts,
      Map<String, Integer> priorPairCounts) {
    List<UUID> selected = new ArrayList<>(peopleNeeded);
    for (int i = 0; i < peopleNeeded; i++) {
      UUID best = null;
      int bestCount = Integer.MAX_VALUE;
      int bestPairCount = Integer.MAX_VALUE;
      int bestRank = Integer.MAX_VALUE;
      for (int offset = 0; offset < pool.size(); offset++) {
        UUID candidate = pool.get(Math.floorMod(occurrenceIndex + offset, pool.size()));
        if (selected.contains(candidate)) {
          continue;
        }
        int count = priorCounts.get(pool.indexOf(candidate));
        int pairCount =
            selected.stream()
                .mapToInt(
                    selectedUser ->
                        priorPairCounts.getOrDefault(pairKey(candidate, selectedUser), 0))
                .sum();
        if (count < bestCount || (count == bestCount && pairCount < bestPairCount)) {
          best = candidate;
          bestCount = count;
          bestPairCount = pairCount;
          bestRank = offset;
        } else if (count == bestCount && pairCount == bestPairCount && offset < bestRank) {
          best = candidate;
          bestRank = offset;
        }
      }
      selected.add(best);
    }
    return List.copyOf(selected);
  }

  static String pairKey(UUID first, UUID second) {
    return first.compareTo(second) < 0 ? first + ":" + second : second + ":" + first;
  }

  static OffsetDateTime dueAt(LocalDate date, java.time.LocalTime time, ZoneId zone) {
    return date.atTime(time).atZone(zone).toOffsetDateTime();
  }

  /** Number of dates the schedule produced before {@code target}, for ROUND_ROBIN turns. */
  private int occurrenceIndex(ChoreSchedule schedule, LocalDate target) {
    // Uncapped, so a COUNT series re-anchored by an edit keeps rotating past its first COUNT days.
    return RecurrenceRule.parse(schedule.getRecurrenceRule())
        .withoutCount()
        .countBefore(schedule.getStartsOn(), target);
  }

  static boolean occurs(String rule, LocalDate startsOn, LocalDate date) {
    return RecurrenceRule.parse(rule).occursOn(startsOn, date);
  }

  private List<UUID> participantIds(ChoreSchedule schedule) {
    Object value =
        schedule.getStrategyConfig() == null
            ? null
            : schedule.getStrategyConfig().get("participantUserIds");
    if (value instanceof List<?> ids) {
      return ids.stream().map(Object::toString).map(UUID::fromString).toList();
    }
    return schedule.getFixedAssignee() == null
        ? new ArrayList<>()
        : new ArrayList<>(List.of(schedule.getFixedAssignee().getId()));
  }

  private int peopleNeeded(ChoreSchedule schedule) {
    Object value =
        schedule.getStrategyConfig() == null
            ? null
            : schedule.getStrategyConfig().get("peopleNeeded");
    if (value instanceof Number number) {
      return Math.max(1, number.intValue());
    }
    return 1;
  }

  private HouseholdMembership requireActiveMember(UUID householdId, Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new HouseholdAccessDeniedException("You are not authorized to view household chores.");
    }
    User user =
        userRepository
            .findByEmailIgnoreCase(authentication.getName())
            .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
            .orElseThrow(
                () ->
                    new HouseholdAccessDeniedException(
                        "You are not authorized to view household chores."));
    return membershipRepository
        .findByHousehold_IdAndUser_Id(householdId, user.getId())
        .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
        .orElseThrow(
            () -> new HouseholdAccessDeniedException("You are not an ACTIVE household member."));
  }

  private record FutureOccurrence(UUID id, LocalDate plannedFor) {}

  private record OverrideState(
      boolean exitCancelled,
      OffsetDateTime dueAt,
      boolean dateOverridden,
      boolean assigneesOverridden) {}

  private record OneTimeOccurrence(
      UUID id, LocalDate scheduledFor, OffsetDateTime dueAt, String status) {}
}
