package com.dirtyduty.app.service;

import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import jakarta.persistence.EntityManager;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MembershipExitCleanupService {

  private static final String HOUSEHOLD_NOTIFICATION_IDS =
      """
      SELECT n.id
      FROM notifications n
      LEFT JOIN notification_events e ON e.id = n.event_id
      WHERE %s
        AND (
          e.household_id = ?
          OR (
            (e.id IS NULL OR e.household_id IS NULL)
            AND (
              (n.reference_type = 'HOUSEHOLD' AND n.reference_id = ?)
              OR (e.reference_type = 'HOUSEHOLD' AND e.reference_id = ?)
              OR (
                n.reference_type = 'CHORE_ASSIGNMENT'
                AND EXISTS (
                  SELECT 1 FROM chore_assignments a
                  WHERE a.id = n.reference_id AND a.household_id = ?
                )
              )
              OR (
                e.reference_type = 'CHORE_ASSIGNMENT'
                AND EXISTS (
                  SELECT 1 FROM chore_assignments a
                  WHERE a.id = e.reference_id AND a.household_id = ?
                )
              )
              OR (
                n.reference_type = 'CHORE_SCHEDULE'
                AND EXISTS (
                  SELECT 1 FROM chore_schedules s
                  WHERE s.id = n.reference_id AND s.household_id = ?
                )
              )
              OR (
                e.reference_type = 'CHORE_SCHEDULE'
                AND EXISTS (
                  SELECT 1 FROM chore_schedules s
                  WHERE s.id = e.reference_id AND s.household_id = ?
                )
              )
            )
          )
        )
      """;

  private final JdbcTemplate jdbc;
  private final ChoreScheduleRepository scheduleRepository;
  private final EntityManager entityManager;

  public MembershipExitCleanupService(
      JdbcTemplate jdbc, ChoreScheduleRepository scheduleRepository, EntityManager entityManager) {
    this.jdbc = jdbc;
    this.scheduleRepository = scheduleRepository;
    this.entityManager = entityManager;
  }

  /**
   * Reconciles only current/future PENDING assignments. Past-dated overdue work and SUBMITTED or
   * completed assignments retain their existing audit and approval state.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public int cleanupMembershipExit(UUID householdId, UUID userId) {
    entityManager.flush();

    List<UUID> scheduleIds =
        jdbc.query(
            """
            SELECT id FROM chore_schedules
            WHERE household_id=?
              AND (
                fixed_assignee_user_id=?
                OR (
                  assignment_strategy IN ('FIXED', 'ROUND_ROBIN', 'RANDOM')
                  AND jsonb_exists(strategy_config->'participantUserIds', ?)
                )
                  OR id IN (
                    SELECT a.schedule_id
                    FROM chore_assignments a
                    WHERE a.household_id=? AND a.schedule_id IS NOT NULL
                      AND a.scheduled_for >= CURRENT_DATE AND a.status='PENDING'
                      AND (
                        a.assigned_to_user_id=?
                        OR EXISTS (
                          SELECT 1 FROM chore_assignment_assignees aa
                          WHERE aa.assignment_id=a.id AND aa.household_id=a.household_id
                            AND aa.user_id=?
                        )
                      )
                  )
                )
            ORDER BY id
            FOR UPDATE
            """,
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId,
            userId,
            userId.toString(),
            householdId,
            userId,
            userId);

    int pausedSchedules = reconcileSchedules(scheduleIds, userId);
    entityManager.flush();
    reconcileAssignments(householdId, userId);
    cancelMemberNotifications(householdId, userId);
    entityManager.flush();
    return pausedSchedules;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void deleteHouseholdNotifications(UUID householdId) {
    String scopedIds = String.format(HOUSEHOLD_NOTIFICATION_IDS, "TRUE");
    Object[] args = householdScopeArgs(householdId);
    jdbc.update(
        "DELETE FROM notification_deliveries WHERE notification_id IN (" + scopedIds + ")", args);
    jdbc.update("DELETE FROM notifications WHERE id IN (" + scopedIds + ")", args);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void lockHouseholdSchedules(UUID householdId) {
    jdbc.query(
        "SELECT id FROM chore_schedules WHERE household_id=? ORDER BY id FOR UPDATE",
        (rs, row) -> rs.getObject("id", UUID.class),
        householdId);
  }

  @Transactional(readOnly = true)
  public boolean isRecipientActiveForNotification(UUID notificationId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
            WITH candidate AS (
              SELECT n.recipient_user_id,
                COALESCE(
                  n.reference_type IN ('HOUSEHOLD', 'CHORE_ASSIGNMENT', 'CHORE_SCHEDULE')
                    OR e.reference_type IN ('HOUSEHOLD', 'CHORE_ASSIGNMENT', 'CHORE_SCHEDULE'),
                  FALSE
                )
                  AS has_household_reference,
                CASE
                  WHEN e.household_id IS NOT NULL THEN e.household_id
                  WHEN n.reference_type = 'HOUSEHOLD' THEN n.reference_id
                  WHEN e.reference_type = 'HOUSEHOLD' THEN e.reference_id
                  WHEN n.reference_type = 'CHORE_ASSIGNMENT'
                    THEN (
                      SELECT a.household_id FROM chore_assignments a
                      WHERE a.id = n.reference_id
                    )
                  WHEN e.reference_type = 'CHORE_ASSIGNMENT'
                    THEN (
                      SELECT a.household_id FROM chore_assignments a
                      WHERE a.id = e.reference_id
                    )
                  WHEN n.reference_type = 'CHORE_SCHEDULE'
                    THEN (
                      SELECT s.household_id FROM chore_schedules s
                      WHERE s.id = n.reference_id
                    )
                  WHEN e.reference_type = 'CHORE_SCHEDULE'
                    THEN (
                      SELECT s.household_id FROM chore_schedules s
                      WHERE s.id = e.reference_id
                    )
                  ELSE NULL
                END AS household_id
              FROM notifications n
              LEFT JOIN notification_events e ON e.id=n.event_id
              WHERE n.id=?
            )
            SELECT CASE WHEN household_id IS NULL THEN NOT has_household_reference ELSE EXISTS (
              SELECT 1 FROM household_memberships m
              WHERE m.household_id=candidate.household_id
                AND m.user_id=candidate.recipient_user_id AND m.status='ACTIVE'
            ) END
            FROM candidate
            """,
            Boolean.class,
            notificationId));
  }

  private int reconcileSchedules(List<UUID> scheduleIds, UUID departingUserId) {
    int pausedSchedules = 0;
    for (ChoreSchedule schedule : scheduleRepository.findAllById(scheduleIds)) {
      Map<String, Object> config =
          schedule.getStrategyConfig() == null
              ? new LinkedHashMap<>()
              : new LinkedHashMap<>(schedule.getStrategyConfig());
      UUID fixedAssigneeId =
          schedule.getFixedAssignee() == null ? null : schedule.getFixedAssignee().getId();
      List<Object> configuredParticipants = participantValues(config.get("participantUserIds"));

      if (configuredParticipants.isEmpty() && fixedAssigneeId != null) {
        configuredParticipants.add(fixedAssigneeId.toString());
      }
      configuredParticipants.removeIf(
          participant -> departingUserId.toString().equals(String.valueOf(participant)));
      Set<UUID> remainingIds = parseParticipantIds(configuredParticipants, schedule.getId());
      boolean fixedStrategy = "FIXED".equals(schedule.getAssignmentStrategy().name());
      if (fixedStrategy && fixedAssigneeId != null && !departingUserId.equals(fixedAssigneeId)) {
        remainingIds.add(fixedAssigneeId);
        if (!configuredParticipants.contains(fixedAssigneeId.toString())) {
          configuredParticipants.add(fixedAssigneeId.toString());
        }
      }
      List<UUID> remaining =
          remainingIds.stream().sorted(Comparator.comparing(UUID::toString)).toList();
      config.put("participantUserIds", configuredParticipants);
      schedule.setStrategyConfig(config);

      if (fixedStrategy) {
        UUID nextFixedAssignee =
            fixedAssigneeId != null && remaining.contains(fixedAssigneeId)
                ? fixedAssigneeId
                : remaining.stream().findFirst().orElse(null);
        schedule.setFixedAssignee(
            nextFixedAssignee == null
                ? null
                : entityManager.getReference(User.class, nextFixedAssignee));
      } else if (departingUserId.equals(fixedAssigneeId)) {
        schedule.setFixedAssignee(null);
      }

      if (schedule.isActive() && remaining.size() < peopleNeeded(config)) {
        schedule.setActive(false);
        pausedSchedules++;
      }
      scheduleRepository.save(schedule);
    }
    return pausedSchedules;
  }

  private void reconcileAssignments(UUID householdId, UUID departingUserId) {
    List<UUID> assignmentIds =
        jdbc.query(
            """
            SELECT a.id
            FROM chore_assignments a
            WHERE a.household_id=?
              AND a.scheduled_for >= CURRENT_DATE
              AND a.status='PENDING'
              AND (
                a.assigned_to_user_id=?
                OR EXISTS (
                  SELECT 1 FROM chore_assignment_assignees aa
                  WHERE aa.assignment_id=a.id AND aa.household_id=a.household_id
                    AND aa.user_id=?
                )
              )
            ORDER BY a.id
            FOR UPDATE
            """,
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId,
            departingUserId,
            departingUserId);

    for (UUID assignmentId : assignmentIds) {
      UUID primaryUserId =
          jdbc.queryForObject(
              "SELECT assigned_to_user_id FROM chore_assignments WHERE id=?",
              UUID.class,
              assignmentId);

      List<UUID> activeAssignees =
          jdbc.query(
              """
              SELECT aa.user_id
              FROM chore_assignment_assignees aa
              JOIN household_memberships m
                ON m.household_id=aa.household_id AND m.user_id=aa.user_id
              WHERE aa.assignment_id=? AND aa.household_id=? AND m.status='ACTIVE'
                AND aa.user_id<>?
              ORDER BY aa.user_id
              FOR UPDATE OF aa
              """,
              (rs, row) -> rs.getObject("user_id", UUID.class),
              assignmentId,
              householdId,
              departingUserId);
      Set<UUID> remaining = new LinkedHashSet<>(activeAssignees);
      if (primaryUserId != null
          && !primaryUserId.equals(departingUserId)
          && isActiveMember(householdId, primaryUserId)) {
        remaining.add(primaryUserId);
      }

      jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", assignmentId);
      if (remaining.isEmpty()) {
        jdbc.update(
            """
            UPDATE chore_assignments
            SET status='CANCELLED', assigned_to_user_id=NULL, updated_at=NOW()
            WHERE id=? AND status='PENDING'
            """,
            assignmentId);
        continue;
      }

      List<UUID> sortedRemaining =
          remaining.stream().sorted(Comparator.comparing(UUID::toString)).toList();
      UUID nextPrimary =
          primaryUserId != null && remaining.contains(primaryUserId)
              ? primaryUserId
              : sortedRemaining.getFirst();
      jdbc.update(
          "UPDATE chore_assignments SET assigned_to_user_id=?, updated_at=NOW() "
              + "WHERE id=? AND status='PENDING'",
          nextPrimary,
          assignmentId);
      for (UUID assigneeId : sortedRemaining) {
        jdbc.update(
            """
            INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
            VALUES (?, ?, ?)
            """,
            householdId,
            assignmentId,
            assigneeId);
      }
    }
  }

  private boolean isActiveMember(UUID householdId, UUID userId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
            SELECT EXISTS (
              SELECT 1 FROM household_memberships
              WHERE household_id=? AND user_id=? AND status='ACTIVE'
            )
            """,
            Boolean.class,
            householdId,
            userId));
  }

  private void cancelMemberNotifications(UUID householdId, UUID userId) {
    String scopedIds = String.format(HOUSEHOLD_NOTIFICATION_IDS, "n.recipient_user_id = ?");
    Object[] args = householdScopeArgs(userId, householdId);
    jdbc.update(
        """
        UPDATE notifications SET status='CANCELLED'
        WHERE status='PENDING' AND id IN (
        """
            + scopedIds
            + ")",
        args);
    jdbc.update(
        """
        UPDATE notification_deliveries SET status='CANCELLED'
        WHERE status IN ('PENDING', 'FAILED') AND notification_id IN (
        """
            + scopedIds
            + ")",
        args);
  }

  private Object[] householdScopeArgs(UUID householdId) {
    return new Object[] {
      householdId, householdId, householdId, householdId, householdId, householdId, householdId
    };
  }

  private Object[] householdScopeArgs(UUID userId, UUID householdId) {
    return new Object[] {
      userId,
      householdId,
      householdId,
      householdId,
      householdId,
      householdId,
      householdId,
      householdId
    };
  }

  private Set<UUID> parseParticipantIds(Object value, UUID scheduleId) {
    Set<UUID> result = new LinkedHashSet<>();
    if (value instanceof Collection<?> values) {
      for (Object participant : values) {
        try {
          result.add(UUID.fromString(String.valueOf(participant)));
        } catch (IllegalArgumentException exception) {
          throw new IllegalStateException(
              "Schedule " + scheduleId + " has an invalid participant user ID", exception);
        }
      }
    }
    return result;
  }

  private List<Object> participantValues(Object value) {
    if (value instanceof Collection<?> values) return new ArrayList<>(values);
    return new ArrayList<>();
  }

  private int peopleNeeded(Map<String, Object> config) {
    Object value = config.get("peopleNeeded");
    if (value == null) return 1;
    if (value instanceof Number number && number.intValue() > 0) return number.intValue();
    if (value instanceof String text) {
      try {
        int peopleNeeded = Integer.parseInt(text);
        if (peopleNeeded > 0) return peopleNeeded;
      } catch (NumberFormatException exception) {
        throw new IllegalStateException("Schedule has an invalid peopleNeeded value", exception);
      }
    }
    throw new IllegalStateException("Schedule has an invalid peopleNeeded value");
  }
}
