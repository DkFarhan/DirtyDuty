package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.AssigneeResponse;
import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreStatusResponse;
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
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.DuplicateResourceException;
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
  private final AwayPeriods awayPeriods;
  private final EffortLedger effortLedger;
  private final ChoreRequestService choreRequests;
  private final ChoreStepService choreSteps;
  private final int horizonDays;

  /**
   * Balanced workloads per household for the current generation run (or single schedule sync), so
   * they are read once and updated as Balanced assigns. Null outside a run.
   */
  private final ThreadLocal<Map<UUID, EffortLedger.Workloads>> balancedRun = new ThreadLocal<>();

  /** The completion instant comes from this clock; tests pin it. */
  private java.time.Clock clock = java.time.Clock.systemUTC();

  public OccurrenceService(
      JdbcTemplate jdbc,
      EntityManager entityManager,
      ChoreScheduleRepository scheduleRepository,
      HouseholdMembershipRepository membershipRepository,
      UserRepository userRepository,
      NotificationEventService notificationEventService,
      AwayPeriods awayPeriods,
      EffortLedger effortLedger,
      ChoreRequestService choreRequests,
      ChoreStepService choreSteps,
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
    this.awayPeriods = awayPeriods;
    this.effortLedger = effortLedger;
    this.choreRequests = choreRequests;
    this.choreSteps = choreSteps;
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
    synchronizeSchedule(schedule, updatePendingAssignees, userInitiatedEdit, null);
  }

  /**
   * As above; {@code repickFrom}, when set, limits {@code updatePendingAssignees} to occurrences
   * planned on or after that day (Week by week: whoever has it keeps the current period).
   */
  @Transactional
  public void synchronizeSchedule(
      ChoreSchedule schedule,
      boolean updatePendingAssignees,
      boolean userInitiatedEdit,
      LocalDate repickFrom) {
    boolean ownsRun = beginBalancedRun();
    try {
      synchronizeInRun(schedule, updatePendingAssignees, userInitiatedEdit, repickFrom);
      if (ownsRun) {
        // An edit, pause, archive or re-plan may have changed a chore someone asked about (E11).
        choreRequests.closeChanged(schedule.getHousehold().getId(), null);
      }
    } finally {
      endBalancedRun(ownsRun);
    }
  }

  /** Starts a Balanced run unless one is already open; returns whether this call opened it. */
  private boolean beginBalancedRun() {
    if (balancedRun.get() != null) {
      return false;
    }
    balancedRun.set(new java.util.HashMap<>());
    return true;
  }

  private void endBalancedRun(boolean ownsRun) {
    if (ownsRun) {
      balancedRun.remove();
    }
  }

  private void synchronizeInRun(
      ChoreSchedule schedule,
      boolean updatePendingAssignees,
      boolean userInitiatedEdit,
      LocalDate repickFrom) {
    lockHousehold(schedule.getHousehold().getId());
    jdbc.queryForObject(
        "SELECT id FROM chore_schedules WHERE id=? FOR UPDATE", UUID.class, schedule.getId());
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    LocalDate today = LocalDate.now(clock.withZone(zone));
    boolean everyone = RotationConfig.everyone(schedule.getStrategyConfig());
    if (everyone && syncEveryone(schedule, today)) {
      // Someone joined or left: the plan is re-picked with them in or out (Week by week from the
      // next period, so whoever has it keeps this one).
      updatePendingAssignees = true;
      LocalDate boundary = weekByWeekBoundary(schedule, today);
      repickFrom =
          repickFrom == null ? boundary : boundary == null ? repickFrom : min(repickFrom, boundary);
    }
    if (schedule.getKind() != ScheduleKind.CALENDAR) {
      synchronizeOpenCopySchedule(schedule, updatePendingAssignees, userInitiatedEdit);
      return;
    }
    Household household = schedule.getHousehold();
    // An open copy left from an "After it's done" or "When needed" kind ends with the kind change.
    cancelOtherKindOpenOccurrences(schedule, today);
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
      if (userInitiatedEdit) {
        // An edit sees a chore paused for away mode as pending; it is re-checked just below.
        unpauseOneTimeForEdit(schedule, household);
      }
      synchronizeOneTimeSchedule(
          schedule, household, onceDateEligible, updatePendingAssignees, userInitiatedEdit);
      applyAwayToOneTime(schedule, household, today);
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
                + "AND (status IN ('PENDING','SUBMITTED') OR (status='SKIPPED' AND away_paused))",
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
                "UPDATE chore_assignments SET status='CANCELLED', away_paused=FALSE, "
                    + "updated_at=NOW() "
                    + "WHERE id=? AND (status='PENDING' OR (status='SKIPPED' AND away_paused))",
                occurrence.id());
        if (cancelled == 1) {
          // The date no longer belongs to the schedule (rule, end or pause change): its pending
          // reminders go now rather than on the notification scheduler's next pass.
          cancelPendingOccurrenceReminders(occurrence.id());
        }
      }
    }

    for (LocalDate date : dates) {
      OffsetDateTime dueAt =
          schedule.getDueTime() == null ? null : dueAt(date, schedule.getDueTime(), zone);
      UUID occurrenceId =
          jdbc.query(
              "SELECT id FROM chore_assignments WHERE schedule_id=? AND planned_for=? "
                  + "AND kind_snapshot='CALENDAR'",
              rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
              schedule.getId(),
              date);
      Chore chore = schedule.getChore();
      if (occurrenceId == null) {
        Selection selection = selection(schedule, date, null);
        List<UUID> assignees = selection.assignees();
        occurrenceId = UUID.randomUUID();
        int inserted =
            jdbc.update(
                """
                        INSERT INTO chore_assignments
                            (id, household_id, chore_id, schedule_id, assigned_to_user_id,
                             scheduled_for, planned_for, due_at, status, title_snapshot,
                             priority_snapshot, difficulty_snapshot, estimated_minutes_snapshot,
                             away_paused, away_from_user_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (schedule_id, planned_for)
                    WHERE schedule_id IS NOT NULL AND kind_snapshot='CALENDAR' DO NOTHING
                        """,
                occurrenceId,
                household.getId(),
                chore.getId(),
                schedule.getId(),
                assignees.isEmpty() ? null : assignees.getFirst(),
                date,
                date,
                dueAt,
                selection.paused() ? "SKIPPED" : "PENDING",
                chore.getTitle(),
                chore.getDefaultPriority().name(),
                chore.getDifficulty(),
                chore.getEstimatedMinutes(),
                selection.paused(),
                selection.awayFrom());
        if (inserted == 0 || selection.paused()) {
          continue;
        }
        noteAssigned(schedule, occurrenceId, date, assignees);
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
        // Picked only when needed: Balanced reads workloads, and the occurrence's own effort is
        // left out when it is re-picked.
        UUID existingId = occurrenceId;
        Selection[] picked = new Selection[1];
        java.util.function.Supplier<Selection> pick =
            () -> {
              if (picked[0] == null) {
                picked[0] = selection(schedule, date, existingId);
              }
              return picked[0];
            };
        String occurrenceStatus = status(occurrenceId);
        if ("SKIPPED".equals(occurrenceStatus)) {
          // Paused because everyone was away: it comes back once someone can do it.
          if (isAwayPaused(occurrenceId) && !pick.get().paused()) {
            resumeAwayPaused(household.getId(), occurrenceId, pick.get());
            noteAssigned(schedule, occurrenceId, date, pick.get().assignees());
          }
          continue;
        }
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
        // A fixed list waits for an edit after someone leaves; "everyone" carries on without them.
        if (exitCancelled && !userInitiatedEdit && !everyone) {
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
        // Away mode re-picks an occurrence whose people include someone away that day, or that
        // was covered for someone; a manual override (date or people) is never changed.
        boolean awayRelevant = !keepAssignees && !keepDate && awayRelevant(occurrenceId, date);
        boolean repick =
            updatePendingAssignees && (repickFrom == null || !date.isBefore(repickFrom));
        if (!keepAssignees
            && (repick
                || exitCancelled
                || awayRelevant
                || (reviving && state.assigneesOverridden()))) {
          Selection selection = pick.get();
          List<UUID> assignees = selection.assignees();
          List<UUID> before = currentAssignees(occurrenceId);
          jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
          jdbc.update(
              "UPDATE chore_assignments SET assigned_to_user_id=?, away_from_user_id=? WHERE id=?",
              assignees.isEmpty() ? null : assignees.getFirst(),
              selection.awayFrom(),
              occurrenceId);
          cancelPendingRemindersFor(
              occurrenceId, before.stream().filter(userId -> !assignees.contains(userId)).toList());
          if (selection.paused() && !keepDate) {
            pauseForAway(occurrenceId);
            noteAssigned(schedule, occurrenceId, date, List.of());
            continue;
          }
          noteAssigned(schedule, occurrenceId, date, assignees);
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
    validateScheduleFrequencyChange(schedule, ScheduleKind.CALENDAR, previousRule, updatedRule);
  }

  /** Rejects turning a chore with history into a one-time chore, whatever kind it was. */
  @Transactional
  public void validateScheduleFrequencyChange(
      ChoreSchedule schedule, ScheduleKind previousKind, String previousRule, String updatedRule) {
    boolean wasRepeating =
        previousKind != ScheduleKind.CALENDAR
            || (previousRule != null && !"FREQ=ONCE".equals(previousRule));
    if ("FREQ=ONCE".equals(updatedRule) && schedule.getId() != null && wasRepeating) {
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
                WHERE schedule_id=? AND household_id=? AND kind_snapshot='CALENDAR'
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

  /** Before a user edit of a one-time chore, its away pause is lifted (with its usual people). */
  private void unpauseOneTimeForEdit(ChoreSchedule schedule, Household household) {
    List<Map<String, Object>> paused =
        jdbc.queryForList(
            """
                SELECT id, scheduled_for FROM chore_assignments
                WHERE schedule_id=? AND kind_snapshot='CALENDAR' AND status='SKIPPED' AND away_paused
                """,
            schedule.getId());
    for (Map<String, Object> row : paused) {
      UUID id = (UUID) row.get("id");
      LocalDate day = toLocalDate(row.get("scheduled_for"));
      resumeAwayPaused(
          household.getId(),
          id,
          new Selection(selectedAssignees(schedule, day, Set.of()), null, false));
    }
  }

  /**
   * Away mode for a one-time chore's single occurrence (from today on, not manually changed): it
   * goes to someone who isn't away, or waits while everyone who would do it is away, and comes back
   * when they aren't. People newly given it are told, as for any one-time assignment.
   */
  private void applyAwayToOneTime(ChoreSchedule schedule, Household household, LocalDate today) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            """
                SELECT id, status, scheduled_for FROM chore_assignments
                WHERE schedule_id=? AND kind_snapshot='CALENDAR' AND scheduled_for>=?
                  AND NOT date_overridden AND NOT assignees_overridden
                  AND (status='PENDING' OR (status='SKIPPED' AND away_paused))
                FOR UPDATE
                """,
            schedule.getId(),
            today);
    for (Map<String, Object> row : rows) {
      UUID id = (UUID) row.get("id");
      LocalDate day = toLocalDate(row.get("scheduled_for"));
      Selection selection = selection(schedule, day);
      List<UUID> before = currentAssignees(id);
      if ("SKIPPED".equals(row.get("status"))) {
        if (!selection.paused()) {
          resumeAwayPaused(household.getId(), id, selection);
          announceOccurrenceAssignment(
              household.getId(),
              id,
              schedule.getChore().getTitle(),
              day,
              null,
              selection.assignees());
        }
        continue;
      }
      if (!awayRelevant(id, day)) {
        continue;
      }
      if (selection.paused()) {
        pauseForAway(id);
        continue;
      }
      if (Set.copyOf(before).equals(Set.copyOf(selection.assignees()))) {
        jdbc.update(
            "UPDATE chore_assignments SET away_from_user_id=? WHERE id=?",
            selection.awayFrom(),
            id);
        continue;
      }
      jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", id);
      jdbc.update(
          "UPDATE chore_assignments SET assigned_to_user_id=?, away_from_user_id=?, "
              + "updated_at=NOW() WHERE id=? AND status='PENDING'",
          selection.assignees().getFirst(),
          selection.awayFrom(),
          id);
      insertAssignees(id, household.getId(), selection.assignees());
      cancelPendingRemindersFor(
          id, before.stream().filter(userId -> !selection.assignees().contains(userId)).toList());
      announceOccurrenceAssignment(
          household.getId(),
          id,
          schedule.getChore().getTitle(),
          day,
          null,
          selection.assignees().stream().filter(userId -> !before.contains(userId)).toList());
    }
  }

  private void createOneTimeOccurrence(
      ChoreSchedule schedule, Household household, LocalDate scheduledFor) {
    Chore chore = schedule.getChore();
    Selection selection = selection(schedule, scheduledFor);
    List<UUID> assignees = selection.assignees();
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
                     priority_snapshot, difficulty_snapshot, estimated_minutes_snapshot,
                     away_paused, away_from_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (schedule_id, planned_for)
                    WHERE schedule_id IS NOT NULL AND kind_snapshot='CALENDAR' DO NOTHING
                """,
            occurrenceId,
            household.getId(),
            chore.getId(),
            schedule.getId(),
            assignees.isEmpty() ? null : assignees.getFirst(),
            scheduledFor,
            scheduledFor,
            dueAt,
            selection.paused() ? "SKIPPED" : "PENDING",
            chore.getTitle(),
            chore.getDefaultPriority().name(),
            chore.getDifficulty(),
            chore.getEstimatedMinutes(),
            selection.paused(),
            selection.awayFrom());
    if (inserted == 0 || selection.paused()) {
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
            || schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM
            || schedule.getAssignmentStrategy() == AssignmentStrategy.BALANCED;

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
        if (schedule.getKind() == ScheduleKind.AS_NEEDED) {
          variables.put("notification_title", "New shared job");
          variables.put(
              "notification_message",
              schedule.getChore().getTitle()
                  + " is now a shared household job. We'll let you know when it's your turn and it needs doing.");
        } else if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
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
    if (schedule.getKind() != ScheduleKind.CALENDAR) {
      return "New repeating chore assigned";
    }
    RecurrenceRule rule = RecurrenceRule.parse(schedule.getRecurrenceRule());
    if (rule.interval() == 1 && rule.frequency() == RecurrenceRule.Frequency.DAILY) {
      return "New daily chore assigned";
    }
    if (rule.interval() == 1 && rule.frequency() == RecurrenceRule.Frequency.WEEKLY) {
      return "New weekly chore assigned";
    }
    return "New recurring chore assigned";
  }

  // ---- "After it's done" and "When needed": one open copy ------------------------------------
  //
  // An AFTER_COMPLETION or AS_NEEDED schedule has exactly one open occurrence (PENDING or
  // SUBMITTED) while it is active, enforced by ux_schedule_single_open_occurrence. Nothing is
  // generated ahead: completing (or, for AFTER_COMPLETION, skipping) the open one creates the next
  // in the same transaction. Its planned day is the day it was done, in the schedule's time zone,
  // plus the interval (or the backstop days); its deadline is that day at the due time, or 23:59
  // local when no due time is set. A "When needed" chore with the backstop off has no deadline and
  // so no reminders. Generation (on read, hourly, and on edits) only repairs a missing open copy
  // and keeps the open one in step with the settings. The day the plan was counted from is kept in
  // the row's metadata ("basedOn") so a settings edit can re-plan from the last completion.
  //
  // "When needed" rolls instead after a completion: the next deadline is the exact completion
  // instant plus the backstop days, added in the schedule's time zone (the wall-clock time is kept
  // across DST), and the due time is not used. Such a copy also stores the instant ("basedOnAt")
  // and the settings it was planned with ("plannedBackstop", "plannedDueTime"), so an edit can
  // tell a backstop change (re-plan from the instant) from a due-time change (the new time on the
  // copy's planned day). The first copy, and copies created before this rule (no "basedOnAt"),
  // keep the date-and-due-time plan until their next completion.

  /** Deadline used when an open-copy chore has no due time: the end of its day. */
  static final java.time.LocalTime END_OF_DAY = java.time.LocalTime.of(23, 59);

  static final String ALREADY_DONE_MESSAGE_PREFIX = "Already done by ";
  static final java.time.Duration FLAG_REPEAT_WINDOW = java.time.Duration.ofHours(2);

  /** Deadline of an open-copy occurrence planned for {@code day}. */
  static OffsetDateTime openCopyDeadline(LocalDate day, java.time.LocalTime dueTime, ZoneId zone) {
    return dueAt(day, dueTime == null ? END_OF_DAY : dueTime, zone);
  }

  private record OpenCopy(
      UUID id,
      String status,
      LocalDate plannedFor,
      OffsetDateTime dueAt,
      boolean dateOverridden,
      boolean assigneesOverridden,
      OffsetDateTime flaggedAt,
      LocalDate basedOn,
      /** A rolling "When needed" copy: the completion it counts from and the settings it used. */
      OffsetDateTime basedOnAt,
      Integer plannedBackstop,
      java.time.LocalTime plannedDueTime) {}

  /** {@code basedOnAt} is set only for a rolling "When needed" plan. */
  private record Plan(
      LocalDate day, OffsetDateTime dueAt, LocalDate basedOn, OffsetDateTime basedOnAt) {
    Plan(LocalDate day, OffsetDateTime dueAt, LocalDate basedOn) {
      this(day, dueAt, basedOn, null);
    }
  }

  /** Tests pin the completion clock; {@code null} restores the system clock. */
  void useClock(java.time.Clock testClock) {
    this.clock = testClock == null ? java.time.Clock.systemUTC() : testClock;
  }

  /** The clock generation plans with (pinned in tests). */
  java.time.Clock clock() {
    return clock;
  }

  private boolean scheduleEnabled(ChoreSchedule schedule) {
    return schedule.isActive()
        && schedule.getChore().isActive()
        && schedule.getChore().getArchivedAt() == null;
  }

  private void synchronizeOpenCopySchedule(
      ChoreSchedule schedule, boolean updatePendingAssignees, boolean userInitiatedEdit) {
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    LocalDate today = LocalDate.now(zone);
    cancelOtherKindOpenOccurrences(schedule, today);
    OpenCopy open = lockOpenCopy(schedule);
    if (!scheduleEnabled(schedule)) {
      // Pause or archive: the open copy goes with its pending reminders and any flag.
      if (open != null && "PENDING".equals(open.status())) {
        jdbc.update(
            """
                UPDATE chore_assignments
                SET status='CANCELLED', flagged_at=NULL, flagged_by_user_id=NULL, updated_at=NOW()
                WHERE id=? AND status='PENDING'
                """,
            open.id());
        cancelPendingOccurrenceReminders(open.id());
      }
      return;
    }
    if (open == null) {
      // A user action (create, edit, activate) starts fresh; background generation repairs a
      // copy lost to a member exit from where the series was.
      Plan plan = userInitiatedEdit ? freshPlan(schedule, today) : repairPlan(schedule, today);
      createOpenCopy(schedule, plan, null, null);
      publishNewRecurringAssigneeAnnouncements(schedule, today);
      return;
    }
    if (!"PENDING".equals(open.status())) {
      return;
    }
    if (userInitiatedEdit) {
      replanOpenCopy(schedule, open, today);
    }
    List<UUID> current = currentAssignees(open.id());
    List<UUID> participants = activeParticipants(schedule);
    boolean holderGone =
        current.isEmpty()
            || activeMembersOnly(schedule.getHousehold().getId(), current).size() != current.size();
    boolean keepOverride = open.assigneesOverridden() && participants.containsAll(current);
    if (holderGone || (updatePendingAssignees && !keepOverride)) {
      LocalDate turnDay = turnDay(schedule, open.plannedFor(), today);
      List<UUID> turn =
          nextTurn(
              schedule,
              awayPeriods.awayOn(schedule.getHousehold().getId(), turnDay),
              turnDay,
              open.id());
      if (!turn.isEmpty() && !Set.copyOf(turn).equals(Set.copyOf(current))) {
        setOpenCopyAssignees(schedule, open.id(), current, turn, null);
      }
    }
    applyAwayToOpenCopy(schedule, today);
    publishNewRecurringAssigneeAnnouncements(schedule, today);
  }

  /** The open copy of the schedule's current kind, locked. */
  private OpenCopy lockOpenCopy(ChoreSchedule schedule) {
    List<OpenCopy> rows =
        jdbc.query(
            """
                SELECT id, status, planned_for, due_at, date_overridden, assignees_overridden,
                       flagged_at, metadata->>'basedOn' based_on,
                       metadata->>'basedOnAt' based_on_at,
                       metadata->>'plannedBackstop' planned_backstop,
                       metadata->>'plannedDueTime' planned_due_time
                FROM chore_assignments
                WHERE schedule_id=? AND kind_snapshot=? AND status IN ('PENDING','SUBMITTED')
                ORDER BY created_at DESC, id
                FOR UPDATE
                """,
            (rs, row) ->
                new OpenCopy(
                    rs.getObject("id", UUID.class),
                    rs.getString("status"),
                    rs.getObject("planned_for", LocalDate.class),
                    rs.getObject("due_at", OffsetDateTime.class),
                    rs.getBoolean("date_overridden"),
                    rs.getBoolean("assignees_overridden"),
                    rs.getObject("flagged_at", OffsetDateTime.class),
                    rs.getString("based_on") == null
                        ? null
                        : LocalDate.parse(rs.getString("based_on")),
                    rs.getString("based_on_at") == null
                        ? null
                        : OffsetDateTime.parse(rs.getString("based_on_at")),
                    rs.getString("planned_backstop") == null
                        ? null
                        : Integer.valueOf(rs.getString("planned_backstop")),
                    rs.getString("planned_due_time") == null
                        ? null
                        : java.time.LocalTime.parse(rs.getString("planned_due_time"))),
            schedule.getId(),
            schedule.getKind().name());
    return rows.isEmpty() ? null : rows.getFirst();
  }

  /**
   * A kind change keeps history and ends what was still to do under the old kind: occurrences of
   * another kind planned from today on (the usual series-edit rule), and any open copy of an
   * open-copy kind whatever its date, since that copy was the whole series.
   */
  private void cancelOtherKindOpenOccurrences(ChoreSchedule schedule, LocalDate today) {
    List<UUID> stale =
        jdbc.queryForList(
            """
                SELECT id FROM chore_assignments
                WHERE schedule_id=? AND kind_snapshot<>? AND status='PENDING'
                  AND (planned_for>=? OR kind_snapshot<>'CALENDAR')
                """,
            UUID.class,
            schedule.getId(),
            schedule.getKind().name(),
            today);
    for (UUID id : stale) {
      jdbc.update(
          """
              UPDATE chore_assignments
              SET status='CANCELLED', flagged_at=NULL, flagged_by_user_id=NULL, updated_at=NOW()
              WHERE id=? AND status='PENDING'
              """,
          id);
      cancelPendingOccurrenceReminders(id);
    }
  }

  /**
   * Plan for an open copy counted from {@code basedOn}, the day the previous one was done or
   * skipped. Without one: the first due date for AFTER_COMPLETION, and today for AS_NEEDED.
   */
  private Plan planFrom(ChoreSchedule schedule, LocalDate basedOn, LocalDate today) {
    return planFrom(schedule, basedOn, null, today);
  }

  /**
   * As above; for "When needed", a {@code basedOnAt} completion instant gives the rolling plan:
   * that instant plus the backstop days in the schedule's zone, planned on the deadline's local
   * day.
   */
  private Plan planFrom(
      ChoreSchedule schedule, LocalDate basedOn, OffsetDateTime basedOnAt, LocalDate today) {
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    if (schedule.getKind() == ScheduleKind.AS_NEEDED && basedOnAt != null) {
      LocalDate doneOn = basedOnAt.atZoneSameInstant(zone).toLocalDate();
      if (schedule.getBackstopDays() == null) {
        return new Plan(doneOn, null, doneOn, basedOnAt);
      }
      OffsetDateTime due =
          basedOnAt
              .atZoneSameInstant(zone)
              .plusDays(schedule.getBackstopDays())
              .toOffsetDateTime()
              .withOffsetSameInstant(ZoneOffset.UTC);
      return new Plan(due.atZoneSameInstant(zone).toLocalDate(), due, doneOn, basedOnAt);
    }
    if (schedule.getKind() == ScheduleKind.AFTER_COMPLETION) {
      int count = schedule.getIntervalCount() == null ? 1 : schedule.getIntervalCount();
      LocalDate day =
          basedOn == null
              ? schedule.getStartsOn()
              : schedule.getIntervalUnit() == IntervalUnit.WEEK
                  ? basedOn.plusWeeks(count)
                  : basedOn.plusDays(count);
      return new Plan(day, openCopyDeadline(day, schedule.getDueTime(), zone), basedOn);
    }
    LocalDate from = basedOn == null ? today : basedOn;
    if (schedule.getBackstopDays() == null) {
      return new Plan(from, null, from);
    }
    LocalDate day = from.plusDays(schedule.getBackstopDays());
    return new Plan(day, openCopyDeadline(day, schedule.getDueTime(), zone), from);
  }

  /** A fresh start (create, kind change, activation): never due before today. */
  private Plan freshPlan(ChoreSchedule schedule, LocalDate today) {
    if (schedule.getKind() == ScheduleKind.AFTER_COMPLETION
        && schedule.getStartsOn().isBefore(today)) {
      ZoneId zone = ZoneId.of(schedule.getTimezone());
      return new Plan(today, openCopyDeadline(today, schedule.getDueTime(), zone), null);
    }
    return planFrom(schedule, null, today);
  }

  /** Background repair: continue from the latest occurrence of the current kind. */
  private Plan repairPlan(ChoreSchedule schedule, LocalDate today) {
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    List<Map<String, Object>> latest =
        jdbc.queryForList(
            """
                SELECT a.status, a.metadata->>'basedOn' based_on,
                       a.metadata->>'basedOnAt' based_on_at,
                       (a.updated_at AT TIME ZONE ?)::date updated_on,
                       (SELECT (MAX(c.completed_at) AT TIME ZONE ?)::date
                        FROM chore_completions c WHERE c.assignment_id=a.id) done_on,
                       (SELECT MAX(c.completed_at)
                        FROM chore_completions c WHERE c.assignment_id=a.id) done_at
                FROM chore_assignments a
                WHERE a.schedule_id=? AND a.kind_snapshot=?
                  AND a.status IN ('COMPLETED','SKIPPED','CANCELLED')
                ORDER BY a.created_at DESC, a.id
                LIMIT 1
                """,
            zone.getId(),
            zone.getId(),
            schedule.getId(),
            schedule.getKind().name());
    if (latest.isEmpty()) {
      return freshPlan(schedule, today);
    }
    Map<String, Object> row = latest.getFirst();
    String status = (String) row.get("status");
    LocalDate basedOn =
        switch (status) {
          case "COMPLETED" ->
              row.get("done_on") == null
                  ? toLocalDate(row.get("updated_on"))
                  : toLocalDate(row.get("done_on"));
          case "SKIPPED" -> toLocalDate(row.get("updated_on"));
          default ->
              row.get("based_on") == null ? null : LocalDate.parse((String) row.get("based_on"));
        };
    // "When needed" rolls from the completion instant (or the cancelled copy's own).
    OffsetDateTime basedOnAt =
        switch (status) {
          case "COMPLETED" -> toOffsetDateTime(row.get("done_at"));
          case "CANCELLED" ->
              row.get("based_on_at") == null
                  ? null
                  : OffsetDateTime.parse((String) row.get("based_on_at"));
          default -> null;
        };
    return planFrom(schedule, basedOn, basedOnAt, today);
  }

  private static OffsetDateTime toOffsetDateTime(Object value) {
    if (value instanceof OffsetDateTime instant) {
      return instant;
    }
    if (value instanceof java.sql.Timestamp timestamp) {
      return timestamp.toInstant().atOffset(ZoneOffset.UTC);
    }
    return value instanceof java.time.Instant instant ? instant.atOffset(ZoneOffset.UTC) : null;
  }

  private static LocalDate toLocalDate(Object value) {
    if (value instanceof java.sql.Date date) {
      return date.toLocalDate();
    }
    return value instanceof LocalDate date ? date : null;
  }

  /**
   * Keeps the open copy's deadline in step with the settings (interval, backstop, due time),
   * counted from the same last completion. A move and a "Needs doing" flag are kept: the flag keeps
   * whichever deadline is earlier.
   */
  private void replanOpenCopy(ChoreSchedule schedule, OpenCopy open, LocalDate today) {
    if (open.dateOverridden() && open.flaggedAt() == null) {
      return;
    }
    Plan plan =
        schedule.getKind() == ScheduleKind.AS_NEEDED && open.basedOnAt() != null
            ? rollingReplan(schedule, open)
            : planFrom(schedule, open.basedOn(), today);
    OffsetDateTime dueAt = plan.dueAt();
    LocalDate day = plan.day();
    if (open.flaggedAt() != null && (dueAt == null || open.flaggedAt().isBefore(dueAt))) {
      dueAt = open.flaggedAt();
      day = open.flaggedAt().atZoneSameInstant(ZoneId.of(schedule.getTimezone())).toLocalDate();
    }
    boolean dueChanged =
        open.dueAt() == null ? dueAt != null : dueAt == null || !open.dueAt().isEqual(dueAt);
    Chore chore = schedule.getChore();
    jdbc.update(
        """
            UPDATE chore_assignments
            SET planned_for=?, scheduled_for=?, due_at=?, title_snapshot=?, priority_snapshot=?,
                difficulty_snapshot=?, estimated_minutes_snapshot=?, updated_at=NOW(),
                metadata=metadata - 'awayShiftedDue'
            WHERE id=? AND status='PENDING'
            """,
        plan.day(),
        day,
        dueAt,
        chore.getTitle(),
        chore.getDefaultPriority().name(),
        chore.getDifficulty(),
        chore.getEstimatedMinutes(),
        open.id());
    if (plan.basedOnAt() != null) {
      // The settings this copy is now planned with, so the next edit compares against them.
      jdbc.update(
          "UPDATE chore_assignments SET metadata=metadata || ?::jsonb WHERE id=?",
          openCopyMetadata(plan, schedule),
          open.id());
    }
    if (dueChanged) {
      // The scheduler plans reminders for the new deadline; delivered ones are never re-sent.
      cancelPendingOccurrenceReminders(open.id());
    }
  }

  /**
   * A rolling "When needed" copy after an edit. A backstop change re-plans from the completion
   * instant; a due-time change puts the deadline at the new time on the (re-)planned day, the
   * user's explicit choice for this one; anything else keeps the deadline. Turning the backstop off
   * removes it. A flagged copy's own deadline is counted again from the completion (the caller
   * keeps the earlier of that and the flag).
   */
  private Plan rollingReplan(ChoreSchedule schedule, OpenCopy open) {
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    Integer backstop = schedule.getBackstopDays();
    if (backstop == null) {
      return planFrom(schedule, open.basedOn(), open.basedOnAt(), null);
    }
    boolean backstopChanged = !backstop.equals(open.plannedBackstop());
    boolean timeChanged = !java.util.Objects.equals(schedule.getDueTime(), open.plannedDueTime());
    LocalDate doneOn = open.basedOnAt().atZoneSameInstant(zone).toLocalDate();
    Plan plan;
    if (backstopChanged || open.dueAt() == null || open.flaggedAt() != null) {
      plan = planFrom(schedule, open.basedOn(), open.basedOnAt(), null);
    } else {
      plan = new Plan(open.plannedFor(), open.dueAt(), doneOn, open.basedOnAt());
    }
    if (timeChanged) {
      plan =
          new Plan(
              plan.day(),
              openCopyDeadline(plan.day(), schedule.getDueTime(), zone),
              doneOn,
              open.basedOnAt());
    }
    return plan;
  }

  /** The metadata of an open copy planned by {@code plan}. */
  private static String openCopyMetadata(Plan plan, ChoreSchedule schedule) {
    if (plan.basedOn() == null) {
      return "{}";
    }
    StringBuilder json = new StringBuilder("{\"basedOn\":\"").append(plan.basedOn()).append('"');
    if (plan.basedOnAt() != null) {
      json.append(",\"basedOnAt\":\"")
          .append(plan.basedOnAt().withOffsetSameInstant(ZoneOffset.UTC))
          .append('"')
          .append(",\"plannedBackstop\":")
          .append(schedule.getBackstopDays() == null ? "null" : schedule.getBackstopDays())
          .append(",\"plannedDueTime\":")
          .append(schedule.getDueTime() == null ? "null" : "\"" + schedule.getDueTime() + "\"");
    }
    return json.append('}').toString();
  }

  /**
   * Creates the open copy for {@code plan} with the turn from {@link #nextTurn}. A concurrent
   * creator loses on the single-open index and nothing is inserted. {@code previousTurn} gets an
   * in-app "your turn" line to whoever now has it, when it changed hands (never the actor).
   */
  private UUID createOpenCopy(
      ChoreSchedule schedule, Plan plan, List<UUID> previousTurn, UUID actorId) {
    LocalDate today = LocalDate.now(clock.withZone(ZoneId.of(schedule.getTimezone())));
    LocalDate turnDay = turnDay(schedule, plan.day(), today);
    Set<UUID> away = awayPeriods.awayOn(schedule.getHousehold().getId(), turnDay);
    List<UUID> turn = nextTurn(schedule, away, turnDay, null);
    UUID awayFrom = null;
    if (!away.isEmpty() && schedule.getAssignmentStrategy() != AssignmentStrategy.RANDOM) {
      List<UUID> usual = nextTurn(schedule, Set.of(), turnDay, null);
      if (!usual.isEmpty() && away.contains(usual.getFirst()) && !turn.equals(usual)) {
        awayFrom = usual.getFirst();
      }
    }
    if (turn.isEmpty()) {
      log.warn(
          "Schedule {} has no active participants; no open occurrence created", schedule.getId());
      return null;
    }
    Chore chore = schedule.getChore();
    Household household = schedule.getHousehold();
    UUID occurrenceId = UUID.randomUUID();
    int inserted =
        jdbc.update(
            """
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, schedule_id, assigned_to_user_id,
                     scheduled_for, planned_for, due_at, status, title_snapshot,
                     priority_snapshot, difficulty_snapshot, estimated_minutes_snapshot,
                     kind_snapshot, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?::jsonb)
                ON CONFLICT (schedule_id)
                    WHERE schedule_id IS NOT NULL AND kind_snapshot <> 'CALENDAR'
                      AND status IN ('PENDING', 'SUBMITTED')
                DO NOTHING
                """,
            occurrenceId,
            household.getId(),
            chore.getId(),
            schedule.getId(),
            turn.getFirst(),
            plan.day(),
            plan.day(),
            plan.dueAt(),
            chore.getTitle(),
            chore.getDefaultPriority().name(),
            chore.getDifficulty(),
            chore.getEstimatedMinutes(),
            schedule.getKind().name(),
            openCopyMetadata(plan, schedule));
    if (inserted == 0) {
      return null;
    }
    insertAssignees(occurrenceId, household.getId(), turn);
    noteAssigned(schedule, occurrenceId, plan.day(), turn);
    if (awayFrom != null) {
      jdbc.update(
          "UPDATE chore_assignments SET away_from_user_id=? WHERE id=?", awayFrom, occurrenceId);
    }
    if (previousTurn != null && !Set.copyOf(previousTurn).equals(Set.copyOf(turn))) {
      announceTurn(household.getId(), occurrenceId, chore.getTitle(), actorId, turn);
    }
    applyAwayToOpenCopy(schedule, today);
    return occurrenceId;
  }

  /** Gives the open copy to {@code turn}; removed people stop getting its reminders. */
  private void setOpenCopyAssignees(
      ChoreSchedule schedule,
      UUID occurrenceId,
      List<UUID> previous,
      List<UUID> turn,
      UUID actorId) {
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
    jdbc.update(
        "UPDATE chore_assignments SET assigned_to_user_id=?, assignees_overridden=FALSE, "
            + "updated_at=NOW() WHERE id=? AND status='PENDING'",
        turn.getFirst(),
        occurrenceId);
    insertAssignees(occurrenceId, schedule.getHousehold().getId(), turn);
    Map<UUID, EffortLedger.Workloads> run = balancedRun.get();
    if (run != null && run.containsKey(schedule.getHousehold().getId())) {
      noteAssigned(
          schedule,
          occurrenceId,
          jdbc.queryForObject(
              "SELECT scheduled_for FROM chore_assignments WHERE id=?",
              LocalDate.class,
              occurrenceId),
          turn);
    }
    cancelPendingRemindersFor(
        occurrenceId, previous.stream().filter(userId -> !turn.contains(userId)).toList());
    announceTurn(
        schedule.getHousehold().getId(),
        occurrenceId,
        schedule.getChore().getTitle(),
        actorId,
        turn.stream().filter(userId -> !previous.contains(userId)).toList());
  }

  /**
   * An in-app line telling people it is now their turn. Turn changes on these kinds never send a
   * CHORE_ASSIGNED push; CHORE_TURN is in-app only (see WebPushNotificationProvider).
   */
  private void announceTurn(
      UUID householdId, UUID occurrenceId, String title, UUID actorId, List<UUID> recipients) {
    publishPerRecipient(
        "CHORE_TURN",
        actorId,
        householdId,
        occurrenceId,
        Map.of(
            "chore_name",
            title,
            "notification_title",
            "Your turn",
            "notification_message",
            "It's your turn for " + title + "."),
        recipients.stream().filter(userId -> !userId.equals(actorId)).toList());
  }

  /** Configured participants who are still active members, in rotation order. */
  private List<UUID> activeParticipants(ChoreSchedule schedule) {
    return activeMembersOnly(schedule.getHousehold().getId(), participantIds(schedule));
  }

  /**
   * Whose turn the next open copy is. FIXED: the fixed person. RANDOM: anyone in the pool. Rotate:
   * the participant with the fewest completions of this chore (plus their baseline offset), ties
   * going to whoever completed it longest ago (never counts as longest ago), then rotation order.
   * Credit goes to whoever completed, so covering for someone leaves the turn with them.
   */
  List<UUID> nextTurn(ChoreSchedule schedule) {
    return nextTurn(schedule, Set.of());
  }

  /**
   * As above, leaving out the {@code away} members (E10). A fixed person keeps it while away (the
   * deadline waits for them instead), and so does a rotation whose people are all away.
   */
  List<UUID> nextTurn(ChoreSchedule schedule, Set<UUID> away) {
    return nextTurn(schedule, away, null, null);
  }

  /**
   * As above for a copy whose turn day is {@code day} (Balanced weighs work up to then); {@code
   * exclude} is the copy being re-picked, whose own effort doesn't count against its holder.
   */
  private List<UUID> nextTurn(ChoreSchedule schedule, Set<UUID> away, LocalDate day, UUID exclude) {
    List<UUID> participants = activeParticipants(schedule);
    if (participants.isEmpty()) {
      return List.of();
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
      UUID fixed = schedule.getFixedAssignee() == null ? null : schedule.getFixedAssignee().getId();
      return List.of(participants.contains(fixed) ? fixed : participants.getFirst());
    }
    List<UUID> eligible = participants.stream().filter(userId -> !away.contains(userId)).toList();
    if (eligible.isEmpty()) {
      eligible = participants;
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM) {
      return List.of(eligible.get(RANDOM.nextInt(eligible.size())));
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.BALANCED) {
      return balancedPick(schedule, eligible, day, 1, exclude);
    }
    Map<UUID, Integer> counts = completionCounts(schedule.getId());
    Map<UUID, Integer> offsets = turnOffsets(schedule.getStrategyConfig());
    return List.of(pickTurn(eligible, counts, offsets, lastCompletions(schedule.getId())));
  }

  /**
   * The day whose away status decides an open copy's turn: today for "When needed" (it can be
   * needed any day), the due day for "After it's done" (never before today).
   */
  private static LocalDate turnDay(ChoreSchedule schedule, LocalDate plannedDay, LocalDate today) {
    return schedule.getKind() == ScheduleKind.AS_NEEDED
            || plannedDay == null
            || plannedDay.isBefore(today)
        ? today
        : plannedDay;
  }

  /**
   * Away mode for the open copy (not moved or reassigned by hand). If its holder is away on its
   * turn day, it passes to the next eligible person (an in-app line, no push, as for any turn
   * change). If nobody else can take it (a fixed person, or everyone away), its deadline waits for
   * the return day at the usual due time, with no reminders before then; that wait is undone when
   * the dates change. An "After it's done" copy covered for someone goes back when the dates change
   * so that its due day is no longer an away day.
   */
  private void applyAwayToOpenCopy(ChoreSchedule schedule, LocalDate today) {
    OpenCopy open = lockOpenCopy(schedule);
    if (open == null
        || !"PENDING".equals(open.status())
        || open.dateOverridden()
        || open.assigneesOverridden()) {
      return;
    }
    UUID householdId = schedule.getHousehold().getId();
    Map<String, Object> state =
        jdbc.queryForMap(
            "SELECT away_from_user_id, metadata->>'awayShiftedDue' shifted_due "
                + "FROM chore_assignments WHERE id=?",
            open.id());
    UUID awayFrom = (UUID) state.get("away_from_user_id");
    OffsetDateTime shiftedDue =
        state.get("shifted_due") == null
            ? null
            : OffsetDateTime.parse((String) state.get("shifted_due"));
    OffsetDateTime planDue = shiftedDue != null ? shiftedDue : open.dueAt();
    LocalDate day = turnDay(schedule, open.plannedFor(), today);
    Set<UUID> away = awayPeriods.awayOn(householdId, day);
    List<UUID> current = currentAssignees(open.id());
    UUID awayHolder = current.stream().filter(away::contains).findFirst().orElse(null);
    if (awayHolder != null) {
      List<UUID> turn = nextTurn(schedule, away, day, open.id());
      if (!turn.isEmpty() && !Set.copyOf(turn).equals(Set.copyOf(current))) {
        setOpenCopyAssignees(schedule, open.id(), current, turn, null);
        jdbc.update(
            "UPDATE chore_assignments SET away_from_user_id=? WHERE id=?", awayHolder, open.id());
        current = turn;
      }
    } else if (awayFrom != null && !away.contains(awayFrom)) {
      // The person it was covered for isn't away any more: the note goes. "After it's done" goes
      // back to them when the dates changed so its due day is no longer an away day; a "When
      // needed" turn that passed stays with whoever has it.
      if (schedule.getKind() == ScheduleKind.AFTER_COMPLETION
          && schedule.getAssignmentStrategy() != AssignmentStrategy.RANDOM
          && !open.plannedFor().isBefore(today)) {
        List<UUID> turn = nextTurn(schedule, Set.of(), day, open.id());
        if (!turn.isEmpty() && !Set.copyOf(turn).equals(Set.copyOf(current))) {
          setOpenCopyAssignees(schedule, open.id(), current, turn, null);
          current = turn;
        }
      }
      jdbc.update("UPDATE chore_assignments SET away_from_user_id=NULL WHERE id=?", open.id());
    }

    // Only them (or everyone away): the deadline waits for the return day.
    LocalDate returnsOn = null;
    if (!current.isEmpty() && current.stream().allMatch(away::contains)) {
      for (UUID holder : current) {
        AwayPeriods.Period period = awayPeriods.covering(householdId, holder, day);
        if (period != null && (returnsOn == null || period.returnsOn().isAfter(returnsOn))) {
          returnsOn = period.returnsOn();
        }
      }
    }
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    boolean wait =
        returnsOn != null
            && planDue != null
            && open.flaggedAt() == null
            && planDue.atZoneSameInstant(zone).toLocalDate().isBefore(returnsOn);
    if (wait) {
      OffsetDateTime waitDue = openCopyDeadline(returnsOn, schedule.getDueTime(), zone);
      if (open.dueAt() == null || !open.dueAt().isEqual(waitDue)) {
        jdbc.update(
            """
                UPDATE chore_assignments
                SET scheduled_for=?, due_at=?,
                    metadata=metadata || jsonb_build_object('awayShiftedDue', ?::text),
                    updated_at=NOW()
                WHERE id=? AND status='PENDING'
                """,
            returnsOn,
            waitDue,
            planDue.withOffsetSameInstant(ZoneOffset.UTC).toString(),
            open.id());
        cancelPendingOccurrenceReminders(open.id());
      }
    } else if (shiftedDue != null && open.flaggedAt() != null) {
      // "Needs doing" set its own deadline; the wait is simply forgotten.
      jdbc.update(
          "UPDATE chore_assignments SET metadata=metadata - 'awayShiftedDue' WHERE id=?",
          open.id());
    } else if (shiftedDue != null) {
      jdbc.update(
          """
              UPDATE chore_assignments
              SET scheduled_for=?, due_at=?, metadata=metadata - 'awayShiftedDue',
                  updated_at=NOW()
              WHERE id=? AND status='PENDING'
              """,
          shiftedDue.atZoneSameInstant(zone).toLocalDate(),
          shiftedDue,
          open.id());
      cancelPendingOccurrenceReminders(open.id());
    }
  }

  /**
   * "Coming back level": on a member's return from {@code period}, raises their standing in this
   * rotation (calendar turns or open-copy completions, plus offsets) to the lowest standing among
   * the others, never lowering it, by adding to their stored {@code turnOffsets}. Missed turns are
   * written off. Returns whether the schedule's config changed (the caller saves it).
   */
  boolean levelOnReturn(
      ChoreSchedule schedule, AwayPeriods.Period period, List<AwayPeriods.Period> periods) {
    if (schedule.getAssignmentStrategy() != AssignmentStrategy.ROUND_ROBIN) {
      return false;
    }
    List<UUID> participants = participantIds(schedule);
    if (!participants.contains(period.userId())) {
      return false;
    }
    Map<UUID, Integer> offsets = turnOffsets(schedule.getStrategyConfig());
    int credit;
    if (schedule.getKind() == ScheduleKind.CALENDAR) {
      // Exactly the credit generation has been planning with (see calendarStanding).
      int planned = calendarStanding(schedule, period.returnsOn()).getOrDefault(period.userId(), 0);
      int stored =
          turnCounts(schedule, period.returnsOn()).getOrDefault(period.userId(), 0)
              + offsets.getOrDefault(period.userId(), 0);
      credit = Math.max(0, planned - stored);
    } else {
      credit =
          levelCredit(
              period, periods, participants, plus(completionCounts(schedule.getId()), offsets));
    }
    if (credit == 0) {
      return false;
    }
    Map<String, Integer> stored = new LinkedHashMap<>();
    offsets.forEach((userId, offset) -> stored.put(userId.toString(), offset));
    stored.merge(period.userId().toString(), credit, Integer::sum);
    Map<String, Object> config =
        schedule.getStrategyConfig() == null
            ? new LinkedHashMap<>()
            : new LinkedHashMap<>(schedule.getStrategyConfig());
    config.put(TURN_OFFSETS, stored);
    schedule.setStrategyConfig(config);
    return true;
  }

  /**
   * Fewest completions plus offset. A tie goes to whoever completed it longest ago (never completed
   * counts as longest ago), so whoever just covered a turn doesn't get the next one too; if that's
   * equal as well, the earlier participant in rotation order.
   */
  static UUID pickTurn(
      List<UUID> participants,
      Map<UUID, Integer> counts,
      Map<UUID, Integer> offsets,
      Map<UUID, OffsetDateTime> lastCompleted) {
    UUID best = null;
    int bestScore = Integer.MAX_VALUE;
    OffsetDateTime bestLast = null;
    for (UUID participant : participants) {
      int score = counts.getOrDefault(participant, 0) + offsets.getOrDefault(participant, 0);
      OffsetDateTime last = lastCompleted.get(participant);
      if (score < bestScore || (score == bestScore && completedLongerAgo(last, bestLast))) {
        best = participant;
        bestScore = score;
        bestLast = last;
      }
    }
    return best;
  }

  /** Whether {@code last} is strictly longer ago than {@code other}; null is never completed. */
  private static boolean completedLongerAgo(OffsetDateTime last, OffsetDateTime other) {
    if (other == null) {
      return false;
    }
    return last == null || last.isBefore(other);
  }

  /** Each person's latest completion of this schedule, credited as in {@link #completionCounts}. */
  private Map<UUID, OffsetDateTime> lastCompletions(UUID scheduleId) {
    Map<UUID, OffsetDateTime> last = new java.util.HashMap<>();
    if (scheduleId == null) {
      return last;
    }
    jdbc.query(
        """
            SELECT last.completed_by_user_id, MAX(last.completed_at)
            FROM chore_assignments a
            JOIN LATERAL (SELECT completed_by_user_id, completed_at FROM chore_completions c
                          WHERE c.assignment_id=a.id
                          ORDER BY c.completed_at DESC, c.attempt_number DESC LIMIT 1) last ON TRUE
            WHERE a.schedule_id=? AND a.status='COMPLETED'
            GROUP BY last.completed_by_user_id
            """,
        rs -> {
          last.put(rs.getObject(1, UUID.class), rs.getObject(2, OffsetDateTime.class));
        },
        scheduleId);
    return last;
  }

  /** Completions of this schedule's occurrences, credited to whoever completed each one. */
  private Map<UUID, Integer> completionCounts(UUID scheduleId) {
    Map<UUID, Integer> counts = new java.util.HashMap<>();
    if (scheduleId == null) {
      return counts;
    }
    jdbc.query(
        """
            SELECT last.completed_by_user_id, COUNT(*) n
            FROM chore_assignments a
            JOIN LATERAL (SELECT completed_by_user_id FROM chore_completions c
                          WHERE c.assignment_id=a.id
                          ORDER BY c.completed_at DESC, c.attempt_number DESC LIMIT 1) last ON TRUE
            WHERE a.schedule_id=? AND a.status='COMPLETED'
            GROUP BY last.completed_by_user_id
            """,
        rs -> {
          counts.put(rs.getObject(1, UUID.class), rs.getInt(2));
        },
        scheduleId);
    return counts;
  }

  static final String TURN_OFFSETS = "turnOffsets";

  static Map<UUID, Integer> turnOffsets(Map<String, Object> config) {
    Map<UUID, Integer> offsets = new java.util.HashMap<>();
    Object value = config == null ? null : config.get(TURN_OFFSETS);
    if (value instanceof Map<?, ?> map) {
      map.forEach(
          (key, offset) -> {
            if (offset instanceof Number number) {
              try {
                offsets.put(UUID.fromString(String.valueOf(key)), number.intValue());
              } catch (IllegalArgumentException ignored) {
                // A malformed key is ignored; the person simply has no offset.
              }
            }
          });
    }
    return offsets;
  }

  /**
   * Baseline offsets for the rotation after an edit, stored in strategy_config as {@value
   * #TURN_OFFSETS}: {"userId": offset}. Someone who joins the rotation later starts level with the
   * current lowest (completions plus offset) of the people already in it, so they do not get a
   * burst of turns. On a fresh start (new chore or kind change) everyone starts level at zero.
   * People who leave are dropped. Existing people keep their offsets.
   */
  @Transactional(readOnly = true)
  public Map<String, Integer> rebaseTurnOffsets(
      ChoreSchedule schedule, List<UUID> participants, boolean freshStart) {
    Map<UUID, Integer> counts = completionCounts(schedule.getId());
    Map<UUID, Integer> previous = freshStart ? Map.of() : turnOffsets(schedule.getStrategyConfig());
    List<UUID> previousParticipants = freshStart ? List.of() : participantIds(schedule);
    List<UUID> staying = participants.stream().filter(previousParticipants::contains).toList();
    int floor =
        staying.stream()
            .mapToInt(userId -> counts.getOrDefault(userId, 0) + previous.getOrDefault(userId, 0))
            .min()
            .orElse(0);
    Map<String, Integer> result = new LinkedHashMap<>();
    for (UUID userId : participants) {
      int offset =
          staying.contains(userId)
              ? previous.getOrDefault(userId, 0)
              : floor - counts.getOrDefault(userId, 0);
      result.put(userId.toString(), offset);
    }
    return result;
  }

  /**
   * Creates the next open copy after the current one was completed or skipped on {@code day};
   * {@code doneAt} is the completion instant (null for a skip), which "When needed" rolls from.
   */
  private void continueOpenCopySeries(
      ChoreSchedule schedule,
      LocalDate day,
      OffsetDateTime doneAt,
      List<UUID> previousTurn,
      UUID actorId) {
    if (schedule == null || !scheduleEnabled(schedule)) {
      return;
    }
    LocalDate today = LocalDate.now(ZoneId.of(schedule.getTimezone()));
    createOpenCopy(schedule, planFrom(schedule, day, doneAt, today), previousTurn, actorId);
  }

  /**
   * "Needs doing" on a When-needed chore's open occurrence: any active member may press it. The
   * person whose turn it is gets an immediate notification (in-app and push, by their preferences),
   * and the deadline is pulled to now when that is earlier, so the usual overdue reminders follow.
   * Pressing again within two hours changes nothing.
   */
  @Transactional
  public AssignmentResponse flag(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    ActionContext context = lockForAction(householdId, assignmentId, authentication);
    LockedOccurrence occurrence = context.occurrence();
    if (!"AS_NEEDED".equals(occurrence.kind())) {
      throw new InvalidHouseholdException("Only a When needed chore can be flagged.");
    }
    if (!"PENDING".equals(occurrence.status()) && !"SUBMITTED".equals(occurrence.status())) {
      throw new InvalidHouseholdException("This chore is already done.");
    }
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    if (occurrence.flaggedAt() != null
        && occurrence.flaggedAt().isAfter(now.minus(FLAG_REPEAT_WINDOW))) {
      throw new DuplicateResourceException(
          "Already flagged at "
              + TIME_FORMAT.format(occurrence.flaggedAt().atZoneSameInstant(context.zone()))
              + ".");
    }
    boolean pullForward = occurrence.dueAt() == null || now.isBefore(occurrence.dueAt());
    jdbc.update(
        """
            UPDATE chore_assignments
            SET flagged_at=?, flagged_by_user_id=?,
                due_at=CASE WHEN ? THEN ? ELSE due_at END,
                scheduled_for=CASE WHEN ? THEN ? ELSE scheduled_for END,
                updated_at=NOW()
            WHERE id=? AND status IN ('PENDING','SUBMITTED')
            """,
        now,
        context.actorId(),
        pullForward,
        now,
        pullForward,
        context.today(),
        occurrence.id());
    recordAction(occurrence.id(), "FLAG", context.actorId());
    if (pullForward) {
      // Pending reminders for the old deadline go; the scheduler plans the overdue ones for the
      // new deadline. Reminders already delivered are never sent again.
      cancelPendingOccurrenceReminders(occurrence.id());
    }
    publishPerRecipient(
        "CHORE_NEEDS_DOING",
        context.actorId(),
        householdId,
        occurrence.id(),
        Map.of(
            "chore_name",
            occurrence.title(),
            "notification_title",
            occurrence.title() + " needs doing",
            "notification_message",
            occurrence.title() + " needs doing. It's your turn."),
        context.assignees().stream().filter(userId -> !userId.equals(context.actorId())).toList());
    return assignmentResponse(occurrence.id(), context.actorId());
  }

  @Transactional
  public List<AssignmentResponse> myChores(
      UUID householdId, String status, Authentication authentication) {
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    generateHousehold(householdId);
    // Besides their own occurrences, everyone in a "When needed" rotation sees its open copy (so
    // they can do it when it is someone else's turn). Completed lists what the viewer actually
    // did, whatever the kind: credit goes to whoever completed it, not to the assignees.
    String predicate =
        switch (status == null ? "UPCOMING" : status) {
          case "UPCOMING" ->
              """
              a.status IN ('PENDING','SUBMITTED')
              AND (EXISTS (SELECT 1 FROM chore_assignment_assignees aa
                           WHERE aa.assignment_id=a.id AND aa.user_id=?)
                   OR (a.kind_snapshot='AS_NEEDED' AND EXISTS (
                           SELECT 1 FROM chore_schedules s
                           WHERE s.id=a.schedule_id AND s.is_active
                             AND jsonb_exists(s.strategy_config->'participantUserIds', ?::text))))
              """;
          case "COMPLETED" ->
              """
              a.status='COMPLETED'
              AND EXISTS (SELECT 1 FROM chore_completions c
                          WHERE c.assignment_id=a.id AND c.completed_by_user_id=?::uuid)
              """;
          default -> throw new InvalidHouseholdException("Status must be UPCOMING or COMPLETED.");
        };
    UUID viewerId = actor.getUser().getId();
    return jdbc.query(
        """
                SELECT a.id FROM chore_assignments a
                WHERE a.household_id=? AND %s
                ORDER BY a.scheduled_for, a.due_at NULLS LAST, a.id
                """
            .formatted(predicate),
        (rs, row) -> assignmentResponse(rs.getObject("id", UUID.class), viewerId),
        "COMPLETED".equals(status)
            ? new Object[] {householdId, viewerId.toString()}
            : new Object[] {householdId, viewerId, viewerId.toString()});
  }

  @Transactional
  public DashboardResponse dashboard(UUID householdId, Authentication authentication) {
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    generateHousehold(householdId);
    ZoneId zone = ZoneId.of(actor.getHousehold().getTimezone());
    LocalDate today = LocalDate.now(clock.withZone(zone));
    LocalDate monday = today.with(DayOfWeek.MONDAY);
    LocalDate nextMonday = monday.plusDays(7);
    List<AssignmentResponse> todayAssignments =
        assignmentList(householdId, actor.getUser().getId(), today, today.plusDays(1));
    List<AssignmentResponse> weekAssignments =
        assignmentList(householdId, actor.getUser().getId(), monday, nextMonday);
    List<AssignmentResponse> overdueAssignments =
        overdueAssignmentList(householdId, actor.getUser().getId());
    List<AssignmentResponse> householdJobs = householdJobs(householdId, actor.getUser().getId());
    WeekWindow week = new WeekWindow(monday, zone);
    Map<String, Object> household =
        jdbc.queryForMap(
            WEEK_CREDIT
                + """
                SELECT (SELECT COUNT(*) FROM done_this_week) completed,
                       (SELECT COUNT(*) FROM (SELECT id FROM planned
                                              UNION SELECT assignment_id FROM done_this_week) w) total
                """,
            week.parameters(householdId));
    long completed = ((Number) household.get("completed")).longValue();
    long total = ((Number) household.get("total")).longValue();
    double percentage = total == 0 ? 0 : Math.round(completed * 1000.0 / total) / 10.0;
    UUID viewerId = actor.getUser().getId();
    Map<String, Object> personal =
        jdbc.queryForMap(
            WEEK_CREDIT
                + """
                SELECT (SELECT COUNT(*) FROM done_this_week WHERE completed_by_user_id=?) completed,
                       (SELECT COUNT(*) FROM (
                          SELECT p.id FROM planned p
                          JOIN chore_assignment_assignees aa ON aa.assignment_id=p.id AND aa.user_id=?
                            AND NOT EXISTS (SELECT 1 FROM member_away_periods w
                                            WHERE w.household_id=aa.household_id
                                              AND w.user_id=aa.user_id
                                              AND p.scheduled_for BETWEEN w.starts_on AND w.ends_on)
                          UNION
                          SELECT assignment_id FROM done_this_week WHERE completed_by_user_id=?) w) assigned
                """,
            week.parameters(householdId, viewerId, viewerId, viewerId));
    return new DashboardResponse(
        new DashboardResponse.WeekSummary(completed, total, percentage),
        new DashboardResponse.PersonalWeek(
            ((Number) personal.get("assigned")).longValue(),
            ((Number) personal.get("completed")).longValue()),
        todayAssignments,
        weekAssignments,
        overdueAssignments,
        householdJobs,
        myWeeks(householdId, viewerId, today),
        hasChores(householdId));
  }

  /** Whether the household has any chore, for every member. */
  @Transactional(readOnly = true)
  public ChoreStatusResponse choreStatus(UUID householdId, Authentication authentication) {
    requireActiveMember(householdId, authentication);
    return new ChoreStatusResponse(hasChores(householdId));
  }

  private boolean hasChores(UUID householdId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM chores WHERE household_id=? AND archived_at IS NULL)",
            Boolean.class,
            householdId));
  }

  /**
   * The active Week by week chores the viewer has this period, with when it ends and who has it
   * next, in the order their periods end, then by name.
   */
  private List<DashboardResponse.MyWeek> myWeeks(UUID householdId, UUID viewerId, LocalDate today) {
    List<UUID> scheduleIds =
        jdbc.queryForList(
            """
                SELECT s.id FROM chore_schedules s JOIN chores c ON c.id=s.chore_id
                WHERE s.household_id=? AND s.is_active AND c.is_active AND c.archived_at IS NULL
                  AND s.kind='CALENDAR' AND s.assignment_strategy='ROUND_ROBIN'
                  AND jsonb_exists(s.strategy_config, 'rotationWeeks')
                ORDER BY LOWER(c.title), s.id
                """,
            UUID.class,
            householdId);
    List<DashboardResponse.MyWeek> result = new ArrayList<>();
    for (UUID scheduleId : scheduleIds) {
      ChoreSchedule schedule = scheduleRepository.findById(scheduleId).orElse(null);
      if (schedule == null || !isWeekByWeek(schedule)) {
        continue;
      }
      int weeks = RotationConfig.weeks(schedule.getStrategyConfig());
      LocalDate anchor = RotationConfig.startsOn(schedule.getStrategyConfig());
      if (today.isBefore(anchor)) {
        // Its first period hasn't started yet (switched this week): nobody has it yet.
        continue;
      }
      LocalDate start = RotationConfig.periodStart(anchor, weeks, today);
      LocalDate next = start.plusWeeks(weeks);
      List<UUID> pool = participantIds(schedule);
      if (pool.isEmpty() || !viewerId.equals(periodOwner(schedule, start, next, pool))) {
        continue;
      }
      UUID nextOwner = periodOwner(schedule, next, next.plusWeeks(weeks), pool);
      Map<String, Object> chore =
          jdbc.queryForMap(
              """
                  SELECT c.title, cat.name category_name FROM chores c
                  LEFT JOIN chore_categories cat ON cat.id=c.category_id WHERE c.id=?
                  """,
              schedule.getChore().getId());
      result.add(
          new DashboardResponse.MyWeek(
              schedule.getChore().getId(),
              (String) chore.get("title"),
              (String) chore.get("category_name"),
              next.minusDays(1),
              nextOwner == null || nextOwner.equals(viewerId)
                  ? null
                  : new AssignmentResponse.Person(
                      nextOwner,
                      jdbc.queryForObject(
                          "SELECT display_name FROM users WHERE id=?", String.class, nextOwner))));
    }
    result.sort(java.util.Comparator.comparing(DashboardResponse.MyWeek::until));
    return result;
  }

  /**
   * Who has the Week by week period {@code [start, end)}: the person on its first planned day that
   * wasn't given away by hand, else who the rotation would pick for it.
   */
  private UUID periodOwner(
      ChoreSchedule schedule, LocalDate start, LocalDate end, List<UUID> pool) {
    List<UUID> planned =
        jdbc.queryForList(
            """
                SELECT COALESCE(a.away_from_user_id, a.assigned_to_user_id)
                FROM chore_assignments a
                WHERE a.schedule_id=? AND a.kind_snapshot='CALENDAR'
                  AND a.planned_for>=? AND a.planned_for<?
                  AND a.status<>'CANCELLED' AND NOT a.assignees_overridden
                  AND COALESCE(a.away_from_user_id, a.assigned_to_user_id) IS NOT NULL
                ORDER BY a.planned_for LIMIT 1
                """,
            UUID.class,
            schedule.getId(),
            start,
            end);
    if (!planned.isEmpty()) {
      return planned.getFirst();
    }
    return weekOwner(schedule, start, pool);
  }

  /** Open copies of the household's active "When needed" chores, for every member. */
  private List<AssignmentResponse> householdJobs(UUID householdId, UUID viewerId) {
    List<UUID> ids =
        jdbc.queryForList(
            """
                SELECT a.id FROM chore_assignments a
                JOIN chore_schedules s ON s.id=a.schedule_id AND s.kind='AS_NEEDED' AND s.is_active
                WHERE a.household_id=? AND a.kind_snapshot='AS_NEEDED'
                  AND a.status IN ('PENDING','SUBMITTED')
                ORDER BY a.flagged_at IS NULL, a.due_at NULLS LAST, LOWER(a.title_snapshot), a.id
                """,
            UUID.class,
            householdId);
    return ids.stream().map(id -> assignmentResponse(id, viewerId)).toList();
  }

  @Transactional(readOnly = true)
  public List<HouseholdMemberStatsResponse> members(
      UUID householdId, Authentication authentication) {
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    ZoneId zone = ZoneId.of(actor.getHousehold().getTimezone());
    LocalDate monday = LocalDate.now(clock.withZone(zone)).with(DayOfWeek.MONDAY);
    WeekWindow week = new WeekWindow(monday, zone);
    return jdbc.query(
        WEEK_CREDIT
            + """
                SELECT m.user_id, u.display_name, m.role, m.joined_at,
                    (SELECT COUNT(*) FROM (
                       SELECT p.id FROM planned p
                       JOIN chore_assignment_assignees aa
                         ON aa.assignment_id=p.id AND aa.user_id=m.user_id
                            AND NOT EXISTS (SELECT 1 FROM member_away_periods w
                                            WHERE w.household_id=aa.household_id
                                              AND w.user_id=aa.user_id
                                              AND p.scheduled_for BETWEEN w.starts_on AND w.ends_on)
                       UNION
                       SELECT d.assignment_id FROM done_this_week d
                       WHERE d.completed_by_user_id=m.user_id) w) assigned_count,
                    (SELECT COUNT(*) FROM done_this_week d
                     WHERE d.completed_by_user_id=m.user_id) completed_count,
                    aw.starts_on away_starts_on, aw.ends_on away_ends_on
                FROM household_memberships m JOIN users u ON u.id=m.user_id
                LEFT JOIN LATERAL (
                    SELECT w.starts_on, w.ends_on FROM member_away_periods w
                    WHERE w.household_id=m.household_id AND w.user_id=m.user_id AND w.ends_on>=?
                    ORDER BY w.starts_on LIMIT 1) aw ON TRUE
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
                rs.getLong("completed_count"),
                rs.getObject("away_starts_on", LocalDate.class),
                rs.getObject("away_ends_on", LocalDate.class)),
        week.parameters(householdId, LocalDate.now(clock.withZone(zone)), householdId));
  }

  /**
   * Week credit, in the household's time zone from Monday to Sunday. {@code done_this_week} holds
   * the occurrences completed this week with whoever completed them (the latest completion of a
   * completed occurrence). {@code planned} holds the occurrences planned this week: not cancelled
   * or skipped, not completed in another week, and not an open copy of an "After it's done" or
   * "When needed" chore that is still waiting with no deadline this week. A member's assigned count
   * is their planned occurrences (except on their away days: those aren't theirs) plus what they
   * completed this week; completion credit goes to the completer alone, so completed never exceeds
   * assigned.
   */
  private static final String WEEK_CREDIT =
      """
      WITH done AS (
        SELECT DISTINCT ON (c.assignment_id)
               c.assignment_id, c.completed_by_user_id, c.completed_at
        FROM chore_completions c
        JOIN chore_assignments a ON a.id=c.assignment_id AND a.status='COMPLETED'
        WHERE c.household_id=?
        ORDER BY c.assignment_id, c.completed_at DESC, c.attempt_number DESC
      ),
      done_this_week AS (
        SELECT assignment_id, completed_by_user_id FROM done
        WHERE completed_at>=? AND completed_at<?
      ),
      planned AS (
        SELECT a.id, a.scheduled_for FROM chore_assignments a
        LEFT JOIN done d ON d.assignment_id=a.id
        WHERE a.household_id=? AND a.scheduled_for>=? AND a.scheduled_for<?
          AND a.status NOT IN ('CANCELLED','SKIPPED')
          AND NOT (a.kind_snapshot<>'CALENDAR' AND a.status IN ('PENDING','SUBMITTED')
                   AND (a.due_at IS NULL OR a.due_at>=?))
          AND (d.completed_at IS NULL OR (d.completed_at>=? AND d.completed_at<?))
      )
      """;

  /** This week, Monday to Sunday in the household's zone, as the bind values for WEEK_CREDIT. */
  private record WeekWindow(LocalDate monday, ZoneId zone) {
    Object[] parameters(UUID householdId, Object... more) {
      OffsetDateTime start = monday.atStartOfDay(zone).toOffsetDateTime();
      OffsetDateTime end = monday.plusDays(7).atStartOfDay(zone).toOffsetDateTime();
      List<Object> values =
          new ArrayList<>(
              List.of(
                  householdId,
                  start,
                  end,
                  householdId,
                  monday,
                  monday.plusDays(7),
                  end,
                  start,
                  end));
      values.addAll(List.of(more));
      return values.toArray();
    }
  }

  @Transactional
  public AssignmentResponse complete(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    lockHousehold(householdId);
    HouseholdMembership actor = requireActiveMember(householdId, authentication);
    // Lock order: household, schedule, occurrence (as in lockForAction).
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
    List<String[]> rows =
        jdbc.query(
            "SELECT status, kind_snapshot FROM chore_assignments "
                + "WHERE id=? AND household_id=? FOR UPDATE",
            (rs, row) -> new String[] {rs.getString("status"), rs.getString("kind_snapshot")},
            assignmentId,
            householdId);
    String status = rows.getFirst()[0];
    String kind = rows.getFirst()[1];
    boolean openCopyKind = !"CALENDAR".equals(kind);
    UUID actorId = actor.getUser().getId();
    if (openCopyKind && "COMPLETED".equals(status)) {
      // One completion wins; a double tap by the same person is answered with the result.
      List<Map<String, Object>> done =
          jdbc.queryForList(
              """
                  SELECT c.completed_by_user_id, u.display_name FROM chore_completions c
                  JOIN users u ON u.id=c.completed_by_user_id
                  WHERE c.assignment_id=? ORDER BY c.completed_at DESC LIMIT 1
                  """,
              assignmentId);
      if (!done.isEmpty() && !actorId.equals(done.getFirst().get("completed_by_user_id"))) {
        throw new DuplicateResourceException(
            ALREADY_DONE_MESSAGE_PREFIX + done.getFirst().get("display_name") + ".");
      }
      return assignmentResponse(assignmentId, actorId);
    }
    boolean participant =
        "AS_NEEDED".equals(kind) && schedule != null && participantIds(schedule).contains(actorId);
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
    if (!Boolean.TRUE.equals(assigned) && !participant) {
      throw new HouseholdAccessDeniedException(
          "AS_NEEDED".equals(kind)
              ? "Only people in this chore's rotation can complete it."
              : "Only an assigned household member may complete this chore.");
    }
    List<UUID> previousTurn = currentAssignees(assignmentId);
    if (!"COMPLETED".equals(status)) {
      if (!"PENDING".equals(status) && !"SUBMITTED".equals(status)) {
        throw new InvalidHouseholdException("This assignment cannot be completed.");
      }
      OffsetDateTime now = OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
      Integer attempt =
          jdbc.queryForObject(
              "SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM chore_completions WHERE assignment_id=?",
              Integer.class,
              assignmentId);
      jdbc.update(
          """
                    INSERT INTO chore_completions
                        (household_id, assignment_id, attempt_number, completed_by_user_id,
                         completed_at, effort_points)
                    SELECT ?, a.id, ?, ?, ?, COALESCE(c.difficulty, a.difficulty_snapshot)
                    FROM chore_assignments a LEFT JOIN chores c ON c.id=a.chore_id
                    WHERE a.id=?
                    ON CONFLICT (assignment_id, attempt_number) DO NOTHING
                    """,
          householdId,
          attempt,
          actor.getUser().getId(),
          now,
          assignmentId);
      jdbc.update(
          "UPDATE chore_assignments SET status='COMPLETED', updated_at=NOW() "
              + "WHERE id=? AND household_id=? AND status IN ('PENDING','SUBMITTED')",
          assignmentId,
          householdId);
      // History keeps how much of the checklist was ticked ("4 of 5 steps").
      choreSteps.snapshot(assignmentId);
      cancelPendingNotifications(assignmentId);
      if (openCopyKind && schedule != null) {
        ZoneId zone = ZoneId.of(schedule.getTimezone());
        LocalDate doneOn = now.atZoneSameInstant(zone).toLocalDate();
        // A "When needed" copy without a deadline is dated on the day it was done (week totals).
        jdbc.update(
            "UPDATE chore_assignments SET scheduled_for=? WHERE id=? AND due_at IS NULL "
                + "AND kind_snapshot='AS_NEEDED'",
            doneOn,
            assignmentId);
        if (kind.equals(schedule.getKind().name())) {
          continueOpenCopySeries(schedule, doneOn, now, previousTurn, actorId);
        }
      }
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
    choreRequests.closeChanged(householdId, actor.getUser().getId());
    return assignmentResponse(assignmentId, actor.getUser().getId());
  }

  // ---- Checklist ticks (E12) -------------------------------------------------------------------

  static final String STEP_NOT_FOUND = "This step is no longer on the chore.";
  static final String STEP_NOT_OPEN = "Steps can only be ticked while the chore is still to do.";
  static final String STEP_NOT_YOURS = "Only the people doing this chore can tick its steps.";

  /**
   * Ticks or unticks one step on an open occurrence. Who may tick is who may complete it: its
   * assignees, or anyone in the rotation for When needed. Ticks are shared, so on a group chore
   * everyone sees who ticked each step. Someone outside the household gets "not found".
   */
  @Transactional
  public AssignmentResponse tickStep(
      UUID householdId,
      UUID assignmentId,
      UUID stepId,
      boolean ticked,
      Authentication authentication) {
    UUID viewerId = memberOrNotFound(householdId, authentication);
    lockHousehold(householdId);
    List<String> statuses =
        jdbc.queryForList(
            "SELECT status FROM chore_assignments WHERE id=? AND household_id=? FOR UPDATE",
            String.class,
            assignmentId,
            householdId);
    if (statuses.isEmpty()) {
      throw new ResourceNotFoundException("Assignment was not found in this household.");
    }
    if (!choreSteps.belongsTo(stepId, assignmentId)) {
      throw new ResourceNotFoundException(STEP_NOT_FOUND);
    }
    String status = statuses.getFirst();
    if (!"PENDING".equals(status) && !"SUBMITTED".equals(status)) {
      throw new InvalidHouseholdException(STEP_NOT_OPEN);
    }
    AssignmentResponse current = assignmentResponse(assignmentId, viewerId);
    if (!current.canComplete()) {
      throw new HouseholdAccessDeniedException(STEP_NOT_YOURS);
    }
    choreSteps.setTick(
        assignmentId,
        stepId,
        viewerId,
        ticked,
        OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC));
    return assignmentResponse(assignmentId, viewerId);
  }

  /** The viewer's id when they are an active member; "not found" for anyone else. */
  private UUID memberOrNotFound(UUID householdId, Authentication authentication) {
    try {
      return requireActiveMember(householdId, authentication).getUser().getId();
    } catch (HouseholdAccessDeniedException exception) {
      throw new ResourceNotFoundException("Assignment was not found in this household.");
    }
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
    if ("AS_NEEDED".equals(occurrence.kind())) {
      throw new InvalidHouseholdException("A When needed chore can't be moved.");
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
    if (!"AFTER_COMPLETION".equals(occurrence.kind()) && dayTaken(context, date)) {
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
    choreRequests.closeChanged(householdId, context.actorId());
    return assignmentResponse(occurrence.id(), context.actorId());
  }

  /** Skips one pending occurrence. It still counts as that person's turn in a rotation. */
  @Transactional
  public AssignmentResponse skip(
      UUID householdId, UUID assignmentId, Authentication authentication) {
    ActionContext context = lockForAction(householdId, assignmentId, authentication);
    requireAdmin(context, "skip");
    LockedOccurrence occurrence = context.occurrence();
    if ("AS_NEEDED".equals(occurrence.kind())) {
      throw new InvalidHouseholdException("A When needed chore can't be skipped.");
    }
    requirePending(occurrence, "skipped");
    jdbc.update(
        "UPDATE chore_assignments SET status='SKIPPED', updated_at=NOW() "
            + "WHERE id=? AND status='PENDING'",
        occurrence.id());
    recordAction(occurrence.id(), "SKIP", context.actorId());
    cancelPendingOccurrenceReminders(occurrence.id());
    if ("AFTER_COMPLETION".equals(occurrence.kind())
        && context.schedule() != null
        && context.schedule().getKind() == ScheduleKind.AFTER_COMPLETION) {
      // The next one is counted from the day of the skip.
      continueOpenCopySeries(
          context.schedule(), context.today(), null, context.assignees(), context.actorId());
    }
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
    choreRequests.closeChanged(householdId, context.actorId());
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
    if (!"CALENDAR".equals(occurrence.kind())) {
      throw new InvalidHouseholdException(
          "This chore has already moved on to its next one, so the skip can't be undone.");
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
    if ("AS_NEEDED".equals(occurrence.kind())
        && context.schedule() != null
        && !participantIds(context.schedule()).containsAll(chosen)) {
      throw new InvalidHouseholdException("Choose someone in this chore's rotation.");
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
    if (!"CALENDAR".equals(occurrence.kind())) {
      // A turn change: an in-app line only, and nobody's completion count changes.
      announceTurn(
          householdId,
          occurrence.id(),
          occurrence.title(),
          context.actorId(),
          chosen.stream().filter(userId -> !previous.contains(userId)).toList());
      choreRequests.closeChanged(householdId, context.actorId());
      return assignmentResponse(occurrence.id(), context.actorId());
    }
    announceOccurrenceAssignment(
        householdId,
        occurrence.id(),
        occurrence.title(),
        occurrence.scheduledFor(),
        context.actorId(),
        chosen.stream().filter(userId -> !previous.contains(userId)).toList());
    choreRequests.closeChanged(householdId, context.actorId());
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
    return scheduleDates(
        RecurrenceRule.parse(schedule.getRecurrenceRule()),
        schedule.getStartsOn(),
        schedule.getCountRebasedOn(),
        schedule.getCountProducedBefore(),
        from,
        untilExclusive);
  }

  /** As above, from the schedule's rule fields (also used by the calendar's projections). */
  static List<LocalDate> scheduleDates(
      RecurrenceRule rule,
      LocalDate startsOn,
      LocalDate countRebasedOn,
      Integer countProducedBefore,
      LocalDate from,
      LocalDate untilExclusive) {
    if (rule.count().isPresent() && countRebasedOn != null && countProducedBefore != null) {
      int remaining = Math.max(0, rule.count().get() - countProducedBefore);
      if (remaining == 0) {
        return List.of();
      }
      LocalDate anchor = countRebasedOn.isAfter(startsOn) ? countRebasedOn : startsOn;
      return rule.withoutCount().datesBetween(startsOn, anchor, untilExclusive).stream()
          .limit(remaining)
          .filter(day -> !day.isBefore(from))
          .toList();
    }
    return rule.datesBetween(startsOn, from, untilExclusive);
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
                       metadata->>'movedFrom' moved_from, kind_snapshot, flagged_at
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
                        : LocalDate.parse(rs.getString("moved_from")),
                    rs.getString("kind_snapshot"),
                    rs.getObject("flagged_at", OffsetDateTime.class)),
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
      LocalDate movedFrom,
      String kind,
      OffsetDateTime flaggedAt) {}

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
    boolean ownsRun = beginBalancedRun();
    try {
      generateHouseholdInRun(householdId);
      choreRequests.closeChanged(householdId, null);
    } finally {
      endBalancedRun(ownsRun);
    }
  }

  private void generateHouseholdInRun(UUID householdId) {
    lockHousehold(householdId);
    // Balanced schedules go last, so their workloads include what the others assigned this run.
    List<UUID> scheduleIds =
        jdbc.query(
            "SELECT id FROM chore_schedules WHERE household_id=? AND is_active=TRUE "
                + "ORDER BY assignment_strategy='BALANCED', id",
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

  // ---- Away mode (E10)
  // ---------------------------------------------------------------------------

  /**
   * Re-plans the household after an away period was set, changed or ended: every active schedule
   * goes through the usual reconcile path. Calendar rotations are re-picked in date order (so turns
   * stay balanced); everything else changes only where away mode matters. Lock order: household,
   * then each schedule, then its occurrences.
   */
  @Transactional
  public void replanForAway(UUID householdId) {
    boolean ownsRun = beginBalancedRun();
    try {
      replanForAwayInRun(householdId);
      choreRequests.closeChanged(householdId, null);
    } finally {
      endBalancedRun(ownsRun);
    }
  }

  private void replanForAwayInRun(UUID householdId) {
    lockHousehold(householdId);
    List<UUID> scheduleIds =
        jdbc.queryForList(
            "SELECT id FROM chore_schedules WHERE household_id=? AND is_active=TRUE "
                + "ORDER BY assignment_strategy='BALANCED', id",
            UUID.class,
            householdId);
    for (UUID scheduleId : scheduleIds) {
      ChoreSchedule schedule =
          scheduleRepository
              .findByIdForUpdate(scheduleId)
              .orElseThrow(() -> new IllegalStateException("A locked chore schedule disappeared."));
      entityManager.refresh(schedule, LockModeType.PESSIMISTIC_WRITE);
      entityManager.refresh(schedule.getChore());
      entityManager.refresh(schedule.getHousehold());
      if (!schedule.isActive() || !hasSupportedRule(schedule)) {
        continue;
      }
      boolean rotation =
          schedule.getKind() == ScheduleKind.CALENDAR
              && schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN
              && !"FREQ=ONCE".equals(schedule.getRecurrenceRule());
      synchronizeSchedule(schedule, rotation, false);
    }
  }

  /**
   * What happens to {@code userId}'s chores while away from {@code from} to {@code until}
   * (inclusive): their turns skip them, someone covers their slot in a fixed group, or the chore
   * waits until they're back. Only chores that would come to them in those dates are listed.
   */
  public record AwayEffect(
      UUID choreId,
      String title,
      String categoryIcon,
      String effect,
      LocalDate resumesOn,
      String coveredBy) {}

  public static final String SKIPS_YOU = "SKIPS_YOU";
  public static final String COVERED = "COVERED";
  public static final String PAUSED = "PAUSED";

  @Transactional(readOnly = true)
  public List<AwayEffect> awayEffects(
      UUID householdId, UUID userId, LocalDate from, LocalDate until) {
    List<UUID> scheduleIds =
        jdbc.queryForList(
            """
                SELECT s.id FROM chore_schedules s JOIN chores c ON c.id=s.chore_id
                WHERE s.household_id=? AND s.is_active AND c.is_active AND c.archived_at IS NULL
                ORDER BY LOWER(c.title), s.id
                """,
            UUID.class,
            householdId);
    Set<UUID> active =
        Set.copyOf(
            jdbc.queryForList(
                "SELECT user_id FROM household_memberships WHERE household_id=? AND status='ACTIVE'",
                UUID.class,
                householdId));
    LocalDate returnsOn = until.plusDays(1);
    List<AwayEffect> effects = new ArrayList<>();
    for (UUID scheduleId : scheduleIds) {
      ChoreSchedule schedule = scheduleRepository.findById(scheduleId).orElse(null);
      if (schedule == null || !hasSupportedRule(schedule)) {
        continue;
      }
      List<UUID> pool = participantIds(schedule).stream().filter(active::contains).toList();
      UUID fixed = schedule.getFixedAssignee() == null ? null : schedule.getFixedAssignee().getId();
      if (!pool.contains(userId) && !userId.equals(fixed)) {
        continue;
      }
      String effect = null;
      String coveredBy = null;
      AssignmentStrategy strategy = schedule.getAssignmentStrategy();
      if (schedule.getKind() == ScheduleKind.CALENDAR) {
        LocalDate start = schedule.getStartsOn().isAfter(from) ? schedule.getStartsOn() : from;
        boolean anyDate =
            "FREQ=ONCE".equals(schedule.getRecurrenceRule())
                ? !schedule.getStartsOn().isBefore(from) && !schedule.getStartsOn().isAfter(until)
                : !start.isAfter(until) && !scheduleDates(schedule, start, returnsOn).isEmpty();
        if (!anyDate) {
          continue;
        }
        if (strategy == AssignmentStrategy.FIXED) {
          List<UUID> group = pool.subList(0, Math.min(peopleNeeded(schedule), pool.size()));
          if (!group.contains(userId)) {
            continue;
          }
          List<UUID> others = group.stream().filter(id -> !id.equals(userId)).toList();
          if (others.isEmpty()) {
            effect = PAUSED;
          } else {
            effect = COVERED;
            coveredBy = displayNames(others);
          }
        } else {
          effect = pool.size() > 1 ? SKIPS_YOU : PAUSED;
        }
      } else if (strategy == AssignmentStrategy.FIXED || pool.size() <= 1) {
        // Only them: the open copy waits for their return when it would be due while away.
        if (!userId.equals(fixed) && strategy == AssignmentStrategy.FIXED) {
          continue;
        }
        LocalDate due =
            jdbc.query(
                """
                    SELECT scheduled_for FROM chore_assignments
                    WHERE schedule_id=? AND kind_snapshot=? AND status='PENDING'
                      AND due_at IS NOT NULL
                    ORDER BY created_at DESC LIMIT 1
                    """,
                rs -> rs.next() ? rs.getObject(1, LocalDate.class) : null,
                scheduleId,
                schedule.getKind().name());
        if (due == null || due.isAfter(until)) {
          continue;
        }
        effect = PAUSED;
      } else {
        effect = SKIPS_YOU;
      }
      String icon =
          jdbc.query(
              """
                  SELECT cc.icon_key FROM chores c
                  LEFT JOIN chore_categories cc ON cc.id=c.category_id WHERE c.id=?
                  """,
              rs -> rs.next() ? rs.getString(1) : null,
              schedule.getChore().getId());
      effects.add(
          new AwayEffect(
              schedule.getChore().getId(),
              schedule.getChore().getTitle(),
              icon,
              effect,
              PAUSED.equals(effect) ? returnsOn : null,
              coveredBy));
    }
    return effects;
  }

  private String displayNames(List<UUID> userIds) {
    List<String> names =
        userIds.stream()
            .map(
                id ->
                    jdbc.query(
                        "SELECT display_name FROM users WHERE id=?",
                        rs -> rs.next() ? rs.getString(1) : "Someone",
                        id))
            .toList();
    if (names.size() <= 1) {
      return names.isEmpty() ? "" : names.getFirst();
    }
    return String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.getLast();
  }

  private static boolean hasSupportedRule(ChoreSchedule schedule) {
    if (schedule.getKind() != ScheduleKind.CALENDAR) {
      // "After it's done" and "When needed" have no rule; their settings are checked by the
      // database (ck_schedule_kind_settings).
      return true;
    }
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
                  AND a.status<>'CANCELLED' AND a.kind_snapshot<>'AS_NEEDED'
                  AND NOT a.away_paused
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
                       vm.role viewer_role,
                       a.kind_snapshot, a.flagged_at, a.flagged_by_user_id,
                       fu.display_name flagged_by, s.interval_count, s.interval_unit,
                       s.backstop_days, s.due_time schedule_due_time,
                       COALESCE(jsonb_exists(s.strategy_config->'participantUserIds', ?::text), FALSE)
                           viewer_participant,
                       ld.completed_at last_done_at, ld.completed_by_user_id last_done_by_id,
                       ld.display_name last_done_by,
                       a.away_from_user_id, au.display_name away_from_name,
                       a.metadata->'requestNote'->>'type' request_note_type,
                       a.metadata->'requestNote'->>'userId' request_note_user,
                       s.strategy_config->>'rotationWeeks' rotation_weeks,
                       s.strategy_config->>'rotationStartsOn' rotation_starts_on,
                       COALESCE(a.away_from_user_id, a.assigned_to_user_id) week_owner_id,
                       wo.display_name week_owner_name,
                       a.steps_total, a.steps_ticked, ch.reminder_mode
                FROM chore_assignments a
                LEFT JOIN users au ON au.id=a.away_from_user_id
                LEFT JOIN users wo ON wo.id=COALESCE(a.away_from_user_id, a.assigned_to_user_id)
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
                LEFT JOIN users fu ON fu.id=a.flagged_by_user_id
                LEFT JOIN LATERAL (
                    SELECT c2.completed_at, c2.completed_by_user_id, u2.display_name
                    FROM chore_assignments a2
                    JOIN chore_completions c2 ON c2.assignment_id=a2.id
                    JOIN users u2 ON u2.id=c2.completed_by_user_id
                    WHERE a2.schedule_id=a.schedule_id AND a2.status='COMPLETED' AND a2.id<>a.id
                      -- Before this one when it is done; any time while it is open (no NOW():
                      -- completion times come from the app's clock, not the database's).
                      AND (cc.completed_at IS NULL OR c2.completed_at <= cc.completed_at)
                    ORDER BY c2.completed_at DESC LIMIT 1) ld
                    ON a.kind_snapshot<>'CALENDAR' AND a.schedule_id IS NOT NULL
                WHERE a.id=?
                """,
        (rs, row) -> mapAssignment(rs, viewerId),
        viewerId.toString(),
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
    String kind = rs.getString("kind_snapshot");
    boolean openCopyKind = !"CALENDAR".equals(kind);
    boolean viewerMember = rs.getString("viewer_role") != null;
    // "When needed": anyone in the rotation may do it, and credit goes to whoever does.
    boolean canComplete =
        pending
            && (assignees.stream().anyMatch(a -> a.userId().equals(viewerId))
                || ("AS_NEEDED".equals(kind)
                    && viewerMember
                    && rs.getBoolean("viewer_participant")));
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
            peopleNeeded(rs.getString("people_needed")),
            kind,
            viewerMember);
    AssignmentResponse.Person turn =
        openCopyKind && pending && !assignees.isEmpty()
            ? new AssignmentResponse.Person(
                assignees.getFirst().userId(), assignees.getFirst().displayName())
            : null;
    AssignmentResponse.LastDone lastDone =
        openCopyKind && rs.getObject("last_done_at") != null
            ? new AssignmentResponse.LastDone(
                rs.getObject("last_done_at", OffsetDateTime.class),
                rs.getObject("last_done_by_id", UUID.class),
                rs.getString("last_done_by"))
            : null;
    AssignmentResponse.Flag flag =
        pending && rs.getObject("flagged_at") != null
            ? new AssignmentResponse.Flag(
                rs.getObject("flagged_at", OffsetDateTime.class),
                rs.getObject("flagged_by_user_id", UUID.class),
                rs.getString("flagged_by"))
            : null;
    java.sql.Time scheduleDueTime = rs.getTime("schedule_due_time");
    AssignmentResponse.Repeat repeat =
        openCopyKind
            ? new AssignmentResponse.Repeat(
                (Integer) rs.getObject("interval_count"),
                rs.getString("interval_unit"),
                (Integer) rs.getObject("backstop_days"),
                scheduleDueTime == null
                    ? null
                    : scheduleDueTime
                        .toLocalTime()
                        .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")))
            : null;
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
        actions,
        kind,
        turn,
        lastDone,
        flag,
        repeat,
        pending && !assignees.isEmpty() && rs.getObject("away_from_user_id") != null
            ? new AssignmentResponse.Person(
                rs.getObject("away_from_user_id", UUID.class), rs.getString("away_from_name"))
            : null,
        choreRequests.stateFor(
            id,
            viewerId,
            dbStatus,
            kind,
            // Past its deadline it's too late to ask anyone.
            viewerAssigned && !overdue,
            rs.getString("request_note_type"),
            rs.getString("request_note_user") == null
                ? null
                : UUID.fromString(rs.getString("request_note_user"))),
        pending && !rs.getBoolean("assignees_overridden") ? week(rs) : null,
        // Checklist (E12): who can tick is who can complete.
        choreSteps.stateFor(
            id,
            rs.getObject("chore_id", UUID.class),
            householdId,
            pending,
            canComplete,
            (Integer) rs.getObject("steps_total"),
            (Integer) rs.getObject("steps_ticked")),
        rs.getString("reminder_mode"));
  }

  /** Week by week: whose period this occurrence is in, and its last day; null otherwise. */
  private static AssignmentResponse.Week week(ResultSet rs) throws SQLException {
    if (!"CALENDAR".equals(rs.getString("kind_snapshot"))
        || rs.getString("rotation_weeks") == null
        || rs.getString("rotation_starts_on") == null
        || rs.getObject("week_owner_id") == null) {
      return null;
    }
    Map<String, Object> config =
        Map.of(
            RotationConfig.WEEKS,
            Integer.parseInt(rs.getString("rotation_weeks")),
            RotationConfig.STARTS_ON,
            rs.getString("rotation_starts_on"));
    Integer weeks = RotationConfig.weeks(config);
    LocalDate anchor = RotationConfig.startsOn(config);
    if (weeks == null || anchor == null) {
      return null;
    }
    LocalDate planned = rs.getObject("planned_for", LocalDate.class);
    if (planned.isBefore(anchor)) {
      // Planned before the chore became Week by week (this week, after a switch): no one's week.
      return null;
    }
    return new AssignmentResponse.Week(
        new AssignmentResponse.Person(
            rs.getObject("week_owner_id", UUID.class), rs.getString("week_owner_name")),
        RotationConfig.nextBoundary(anchor, weeks, planned).minusDays(1));
  }

  /**
   * The day an occurrence was originally due when it has been moved to another day, else null. A
   * recurring occurrence keeps its planned date; a one-time chore's single occurrence follows its
   * due date, so the day before its first move is kept in metadata.
   */
  private static LocalDate originalDate(ResultSet rs, LocalDate scheduledFor) throws SQLException {
    if ("AS_NEEDED".equals(rs.getString("kind_snapshot"))) {
      // A When needed chore is never moved; a "Needs doing" flag brings its day forward.
      return null;
    }
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
    return actionsFor(
        status, admin, assigned, today, scheduledFor, anchor, peopleNeeded, "CALENDAR", true);
  }

  /**
   * Per kind: AFTER_COMPLETION allows move, skip and reassign on the open copy, never unskip (the
   * series has moved on). AS_NEEDED allows reassign (whose turn it is) and "Needs doing" only.
   */
  static AssignmentResponse.Actions actionsFor(
      String status,
      boolean admin,
      boolean assigned,
      LocalDate today,
      LocalDate scheduledFor,
      LocalDate anchor,
      int peopleNeeded,
      String kind,
      boolean member) {
    boolean open = "PENDING".equals(status) || "SUBMITTED".equals(status);
    if ("AS_NEEDED".equals(kind)) {
      return new AssignmentResponse.Actions(
          false, false, false, "PENDING".equals(status) && admin, null, null, 1, open && member);
    }
    boolean calendar = !"AFTER_COMPLETION".equals(kind);
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
        calendar && admin && "SKIPPED".equals(status) && !scheduledFor.isBefore(today),
        pending && admin,
        earliest,
        latest,
        peopleNeeded,
        false);
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

  /**
   * Who does the occurrence on {@code date}, with members away that day left out (E10). {@code
   * awayFrom} is the away member whose slot someone else covers; {@code paused} means everyone who
   * would do it is away, so the occurrence waits (skipped, counted for nobody).
   */
  record Selection(List<UUID> assignees, UUID awayFrom, boolean paused) {}

  Selection selection(ChoreSchedule schedule, LocalDate date) {
    return selection(schedule, date, null);
  }

  /**
   * As above; {@code exclude} is the occurrence being re-picked (Balanced leaves its effort out).
   */
  private Selection selection(ChoreSchedule schedule, LocalDate date, UUID exclude) {
    Set<UUID> away = awayPeriods.awayOn(schedule.getHousehold().getId(), date);
    if (away.isEmpty()) {
      return new Selection(selectedAssignees(schedule, date, Set.of(), exclude), null, false);
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM) {
      // Away members are simply left out of the draw.
      List<UUID> drawn = selectedAssignees(schedule, date, away);
      boolean anyone = !selectedAssignees(schedule, date, Set.of()).isEmpty();
      return new Selection(drawn, null, drawn.isEmpty() && anyone);
    }
    List<UUID> usual = selectedAssignees(schedule, date, Set.of(), exclude);
    UUID awayFrom = usual.stream().filter(away::contains).findFirst().orElse(null);
    if (awayFrom == null) {
      // Nobody it would go to is away: the usual pick, unchanged.
      return new Selection(usual, null, false);
    }
    List<UUID> covered = selectedAssignees(schedule, date, away, exclude);
    return covered.isEmpty()
        ? new Selection(List.of(), null, true)
        : new Selection(covered, awayFrom, false);
  }

  // ---- Balanced (E8)
  // ------------------------------------------------------------------------------------

  /**
   * The household's Balanced workloads for this run, read once and then kept up to date as
   * occurrences are assigned. Outside a run they are read for this one pick.
   */
  private EffortLedger.Workloads workloads(ChoreSchedule schedule) {
    UUID householdId = schedule.getHousehold().getId();
    Map<UUID, EffortLedger.Workloads> run = balancedRun.get();
    EffortLedger.Workloads cached = run == null ? null : run.get(householdId);
    if (cached != null) {
      return cached;
    }
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    OffsetDateTime now = OffsetDateTime.now(clock);
    EffortLedger.Workloads loaded =
        effortLedger.workloads(householdId, zone, LocalDate.now(zone), now);
    if (run != null) {
      run.put(householdId, loaded);
    }
    return loaded;
  }

  /**
   * Balanced: the {@code count} people (from {@code eligible}, in participant order) with the least
   * effort per present day lately for an occurrence on {@code day}. See {@link
   * EffortLedger.Workloads#workload}.
   */
  private List<UUID> balancedPick(
      ChoreSchedule schedule, List<UUID> eligible, LocalDate day, int count, UUID exclude) {
    EffortLedger.Workloads workloads = workloads(schedule);
    Map<UUID, OffsetDateTime> lastDone =
        schedule.getId() == null
            ? Map.of()
            : workloads.lastDone(schedule.getId(), this::lastCompletions);
    return workloads.pick(
        eligible, day == null ? workloads.today() : day, count, lastDone, exclude);
  }

  /**
   * Keeps this run's Balanced workloads in step after an occurrence's people changed (an empty
   * list: it no longer counts for anyone). Nothing to do when no workloads were read yet: they will
   * be read from the database, which already has the change.
   */
  private void noteAssigned(
      ChoreSchedule schedule, UUID occurrenceId, LocalDate day, List<UUID> assignees) {
    Map<UUID, EffortLedger.Workloads> run = balancedRun.get();
    EffortLedger.Workloads cached = run == null ? null : run.get(schedule.getHousehold().getId());
    if (cached != null) {
      cached.assigned(occurrenceId, day, schedule.getChore().getDifficulty(), assignees);
    }
  }

  private boolean isAwayPaused(UUID occurrenceId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT away_paused FROM chore_assignments WHERE id=?", Boolean.class, occurrenceId));
  }

  /**
   * Whether away mode should look at this pending occurrence again: one of its people is away on
   * {@code day}, or it was covered for someone (who may be back now).
   */
  private boolean awayRelevant(UUID occurrenceId, LocalDate day) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
                SELECT a.away_from_user_id IS NOT NULL OR EXISTS (
                    SELECT 1 FROM chore_assignment_assignees aa
                    JOIN member_away_periods p
                      ON p.household_id=a.household_id AND p.user_id=aa.user_id
                    WHERE aa.assignment_id=a.id AND p.starts_on<=? AND p.ends_on>=?)
                FROM chore_assignments a WHERE a.id=?
                """,
            Boolean.class,
            day,
            day,
            occurrenceId));
  }

  /** Everyone who would do it is away: it waits, skipped, with no people and no reminders. */
  private void pauseForAway(UUID occurrenceId) {
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
    jdbc.update(
        """
            UPDATE chore_assignments
            SET status='SKIPPED', away_paused=TRUE, assigned_to_user_id=NULL,
                away_from_user_id=NULL, updated_at=NOW()
            WHERE id=? AND status='PENDING'
            """,
        occurrenceId);
    cancelPendingOccurrenceReminders(occurrenceId);
  }

  /** A paused occurrence whose people are back (or whose dates changed) is pending again. */
  private void resumeAwayPaused(UUID householdId, UUID occurrenceId, Selection selection) {
    int resumed =
        jdbc.update(
            """
                UPDATE chore_assignments
                SET status='PENDING', away_paused=FALSE, assigned_to_user_id=?,
                    away_from_user_id=?, updated_at=NOW()
                WHERE id=? AND status='SKIPPED' AND away_paused
                """,
            selection.assignees().isEmpty() ? null : selection.assignees().getFirst(),
            selection.awayFrom(),
            occurrenceId);
    if (resumed == 1) {
      insertAssignees(occurrenceId, householdId, selection.assignees());
    }
  }

  private List<UUID> selectedAssignees(ChoreSchedule schedule, LocalDate date) {
    return selection(schedule, date).assignees();
  }

  private List<UUID> selectedAssignees(ChoreSchedule schedule, LocalDate date, Set<UUID> away) {
    return selectedAssignees(schedule, date, away, null);
  }

  private List<UUID> selectedAssignees(
      ChoreSchedule schedule, LocalDate date, Set<UUID> away, UUID exclude) {
    int needed = peopleNeeded(schedule);
    List<UUID> pool = new ArrayList<>(participantIds(schedule));
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN
        && isWeekByWeek(schedule)) {
      return weekByWeekPick(schedule, date, pool, away);
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
      if (pool.isEmpty() && schedule.getFixedAssignee() != null) {
        pool = List.of(schedule.getFixedAssignee().getId());
      }
      // A fixed group carries on without an away member; nobody else steps in.
      return pool.subList(0, Math.min(needed, pool.size())).stream()
          .filter(userId -> !away.contains(userId))
          .toList();
    }
    pool.removeIf(away::contains);
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.BALANCED) {
      // Only active members can be picked; they are kept in participant order for ties.
      pool = new ArrayList<>(activeMembersOnly(schedule.getHousehold().getId(), pool));
    }
    // With fewer people available than needed, as many as are available do it.
    int available = Math.min(needed, pool.size());
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.BALANCED) {
      return available == 0 ? List.of() : balancedPick(schedule, pool, date, available, exclude);
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM) {
      Collections.shuffle(pool, RANDOM);
      return List.copyOf(pool.subList(0, available));
    }
    if (schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN) {
      if (available == 0) {
        return List.of();
      }
      Map<UUID, Integer> standing = calendarStanding(schedule, date);
      List<UUID> rotationPool = pool;
      List<Integer> counts =
          rotationPool.stream().map(userId -> standing.getOrDefault(userId, 0)).toList();
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
      return rotate(pool, available, occurrenceIndex(schedule, date), counts, pairCounts);
    }
    return List.of();
  }

  // ---- Week by week and "everyone"
  // ---------------------------------------------------------------------------------

  static LocalDate min(LocalDate first, LocalDate second) {
    return first.isBefore(second) ? first : second;
  }

  private static boolean isWeekByWeek(ChoreSchedule schedule) {
    return schedule.getKind() == ScheduleKind.CALENDAR
        && RotationConfig.weeks(schedule.getStrategyConfig()) != null
        && RotationConfig.startsOn(schedule.getStrategyConfig()) != null;
  }

  /** The next Week by week period boundary after {@code today}, or null for other chores. */
  private static LocalDate weekByWeekBoundary(ChoreSchedule schedule, LocalDate today) {
    if (!isWeekByWeek(schedule)) {
      return null;
    }
    return RotationConfig.nextBoundary(
        RotationConfig.startsOn(schedule.getStrategyConfig()),
        RotationConfig.weeks(schedule.getStrategyConfig()),
        today);
  }

  /**
   * Week by week on {@code date}: the period's owner, unless they are away that day, when the next
   * person in rotation order who isn't away covers it (the owner keeps the rest of the period).
   * Nobody, when everyone is away.
   */
  private List<UUID> weekByWeekPick(
      ChoreSchedule schedule, LocalDate date, List<UUID> pool, Set<UUID> away) {
    if (pool.isEmpty()) {
      return List.of();
    }
    UUID owner = weekOwner(schedule, date, pool);
    if (!away.contains(owner)) {
      return List.of(owner);
    }
    int start = pool.indexOf(owner);
    for (int step = 1; step < pool.size(); step++) {
      UUID candidate = pool.get(Math.floorMod(start + step, pool.size()));
      if (!away.contains(candidate)) {
        return List.of(candidate);
      }
    }
    return List.of();
  }

  /**
   * Who has the Week by week period holding {@code date}: whoever has an earlier day of it (covered
   * days count for the person they cover for; days given away by hand don't count), so a period
   * never changes hands part way through. Otherwise the usual rotation rule, counting one turn per
   * period: the fewest periods (plus offsets and away credit), ties in rotation order.
   */
  private UUID weekOwner(ChoreSchedule schedule, LocalDate date, List<UUID> pool) {
    int weeks = RotationConfig.weeks(schedule.getStrategyConfig());
    LocalDate anchor = RotationConfig.startsOn(schedule.getStrategyConfig());
    LocalDate start = RotationConfig.periodStart(anchor, weeks, date);
    if (schedule.getId() != null) {
      List<UUID> earlier =
          jdbc.queryForList(
              """
                  SELECT COALESCE(a.away_from_user_id, a.assigned_to_user_id)
                  FROM chore_assignments a
                  WHERE a.schedule_id=? AND a.kind_snapshot='CALENDAR'
                    AND a.planned_for>=? AND a.planned_for<?
                    AND a.status<>'CANCELLED' AND NOT a.assignees_overridden
                    AND COALESCE(a.away_from_user_id, a.assigned_to_user_id) IS NOT NULL
                  ORDER BY a.planned_for DESC LIMIT 1
                  """,
              UUID.class,
              schedule.getId(),
              start,
              date);
      if (!earlier.isEmpty() && pool.contains(earlier.getFirst())) {
        return earlier.getFirst();
      }
    }
    Map<UUID, Integer> standing = calendarStanding(schedule, start);
    List<Integer> counts = pool.stream().map(userId -> standing.getOrDefault(userId, 0)).toList();
    int index = (int) RotationConfig.periodIndex(anchor, weeks, date);
    return rotate(pool, 1, index, counts, Map.of()).getFirst();
  }

  /**
   * Turns had before {@code date}: occurrences for a Take turns chore, periods (of the current
   * length, history before a switch included) someone did it in for a Week by week one. Covered
   * days and days given away by hand don't make a period someone's.
   */
  private Map<UUID, Integer> turnCounts(ChoreSchedule schedule, LocalDate date) {
    if (!isWeekByWeek(schedule)) {
      return calendarCounts(schedule.getId(), date);
    }
    Map<UUID, Integer> values = new java.util.HashMap<>();
    if (schedule.getId() == null) {
      return values;
    }
    LocalDate anchor = RotationConfig.startsOn(schedule.getStrategyConfig());
    int days = 7 * RotationConfig.weeks(schedule.getStrategyConfig());
    jdbc.query(
        """
            SELECT a.assigned_to_user_id user_id,
                   COUNT(DISTINCT FLOOR((a.planned_for - ?::date)::numeric / ?)) n
            FROM chore_assignments a
            WHERE a.schedule_id=? AND a.kind_snapshot='CALENDAR'
              AND a.planned_for<? AND a.status<>'CANCELLED'
              AND a.away_from_user_id IS NULL AND NOT a.assignees_overridden
              AND a.assigned_to_user_id IS NOT NULL
            GROUP BY a.assigned_to_user_id
            """,
        rs -> {
          values.put(rs.getObject("user_id", UUID.class), rs.getInt("n"));
        },
        anchor,
        days,
        schedule.getId(),
        date);
    return values;
  }

  /**
   * "Everyone": makes the stored people the household's active members again. People still in it
   * keep their place and offsets; people who joined go at the end, level with the lowest standing
   * (Week by week: at the next period, which is when they come in); people who left drop out.
   * Returns whether anything changed (the caller re-plans).
   */
  private boolean syncEveryone(ChoreSchedule schedule, LocalDate today) {
    UUID householdId = schedule.getHousehold().getId();
    List<UUID> stored = participantIds(schedule);
    List<UUID> members =
        jdbc.queryForList(
            """
                SELECT user_id FROM household_memberships
                WHERE household_id=? AND status='ACTIVE'
                ORDER BY joined_at NULLS FIRST, created_at, user_id
                """,
            UUID.class,
            householdId);
    List<UUID> staying = stored.stream().filter(members::contains).toList();
    List<UUID> joiners = members.stream().filter(userId -> !stored.contains(userId)).toList();
    if (joiners.isEmpty() && staying.size() == stored.size()) {
      return false;
    }
    Map<UUID, Integer> offsets = turnOffsets(schedule.getStrategyConfig());
    offsets.keySet().retainAll(members);
    List<UUID> next = new ArrayList<>(staying);
    next.addAll(joiners);
    Map<String, Integer> stored0 = new LinkedHashMap<>();
    if (!joiners.isEmpty()
        && schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN
        && schedule.getId() != null) {
      if (schedule.getKind() == ScheduleKind.CALENDAR) {
        LocalDate boundary = weekByWeekBoundary(schedule, today);
        LocalDate at = boundary == null ? today : boundary;
        Map<UUID, Integer> standing = calendarStanding(schedule, at);
        Map<UUID, Integer> counts = turnCounts(schedule, at);
        java.util.OptionalInt floor =
            staying.stream().mapToInt(userId -> standing.getOrDefault(userId, 0)).min();
        for (UUID joiner : joiners) {
          int own = counts.getOrDefault(joiner, 0) + offsets.getOrDefault(joiner, 0);
          int credit = floor.isEmpty() ? 0 : Math.max(0, floor.getAsInt() - own);
          if (credit > 0) {
            offsets.merge(joiner, credit, Integer::sum);
          }
        }
      } else {
        rebaseTurnOffsets(schedule, next, false)
            .forEach((userId, offset) -> offsets.put(UUID.fromString(userId), offset));
      }
    }
    offsets.forEach(
        (userId, offset) -> {
          if (next.contains(userId) && offset != 0) {
            stored0.put(userId.toString(), offset);
          }
        });
    Map<String, Object> config =
        schedule.getStrategyConfig() == null
            ? new LinkedHashMap<>()
            : new LinkedHashMap<>(schedule.getStrategyConfig());
    config.put("participantUserIds", next.stream().map(UUID::toString).toList());
    if (stored0.isEmpty()) {
      config.remove(TURN_OFFSETS);
    } else {
      config.put(TURN_OFFSETS, stored0);
    }
    schedule.setStrategyConfig(config);
    scheduleRepository.saveAndFlush(schedule);
    return true;
  }

  /** Calendar turns each participant had before {@code date} (cancelled ones don't count). */
  private Map<UUID, Integer> calendarCounts(UUID scheduleId, LocalDate date) {
    Map<UUID, Integer> values = new java.util.HashMap<>();
    if (scheduleId == null) {
      return values;
    }
    jdbc.query(
        """
            SELECT aa.user_id, COUNT(*) AS n
            FROM chore_assignment_assignees aa
            JOIN chore_assignments a ON a.id=aa.assignment_id
            WHERE a.schedule_id=? AND a.planned_for<? AND a.status<>'CANCELLED'
            GROUP BY aa.user_id
            """,
        rs -> {
          values.put(rs.getObject("user_id", UUID.class), rs.getInt("n"));
        },
        scheduleId,
        date);
    return values;
  }

  /**
   * A calendar rotation's standing before {@code date}: turns had, plus the stored offsets, plus
   * the "level on return" credit of anyone back from an away period by then whose credit isn't
   * stored yet (it is stored by {@link #levelOnReturn} on their return day, with the same value).
   */
  private Map<UUID, Integer> calendarStanding(ChoreSchedule schedule, LocalDate date) {
    Map<UUID, Integer> offsets = turnOffsets(schedule.getStrategyConfig());
    Map<UUID, Integer> credits = new java.util.HashMap<>();
    List<UUID> participants = participantIds(schedule);
    List<AwayPeriods.Period> periods = awayPeriods.household(schedule.getHousehold().getId());
    for (AwayPeriods.Period period : periods) {
      if (period.levelled()
          || !participants.contains(period.userId())
          || period.returnsOn().isAfter(date)) {
        continue;
      }
      Map<UUID, Integer> atReturn =
          plus(turnCounts(schedule, period.returnsOn()), offsets, credits);
      credits.merge(
          period.userId(), levelCredit(period, periods, participants, atReturn), Integer::sum);
    }
    return plus(turnCounts(schedule, date), offsets, credits);
  }

  @SafeVarargs
  private static Map<UUID, Integer> plus(Map<UUID, Integer>... parts) {
    Map<UUID, Integer> sum = new java.util.HashMap<>();
    for (Map<UUID, Integer> part : parts) {
      part.forEach((userId, value) -> sum.merge(userId, value, Integer::sum));
    }
    return sum;
  }

  /**
   * How far a member back from {@code period} is raised so they start level with the others: up to
   * the lowest standing among the other participants who aren't away on the return day; never down.
   * {@code atReturn} is the rotation's standing on the return day (turns or completions, plus
   * offsets). Missed turns are written off, not owed.
   */
  static int levelCredit(
      AwayPeriods.Period period,
      List<AwayPeriods.Period> periods,
      List<UUID> participants,
      Map<UUID, Integer> atReturn) {
    java.util.OptionalInt floor =
        participants.stream()
            .filter(userId -> !userId.equals(period.userId()))
            .filter(
                userId ->
                    periods.stream()
                        .noneMatch(
                            other ->
                                other.userId().equals(userId) && other.covers(period.returnsOn())))
            .mapToInt(userId -> atReturn.getOrDefault(userId, 0))
            .min();
    if (floor.isEmpty()) {
      return 0;
    }
    return Math.max(0, floor.getAsInt() - atReturn.getOrDefault(period.userId(), 0));
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
