package com.dirtyduty.app.notification;

import com.dirtyduty.app.service.MembershipExitCleanupService;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class NotificationScheduler {
  private static final DateTimeFormatter DUE_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");
  private static final String NOTIFICATION_SCOPE_CTE =
      """
      WITH notification_scope AS (
          SELECT n.id, n.recipient_user_id,
              COALESCE(
                  e.household_id,
                  CASE n.reference_type
                      WHEN 'HOUSEHOLD' THEN n.reference_id
                      WHEN 'CHORE_ASSIGNMENT' THEN (
                          SELECT a.household_id FROM chore_assignments a WHERE a.id=n.reference_id
                      )
                      WHEN 'CHORE_SCHEDULE' THEN (
                          SELECT s.household_id FROM chore_schedules s WHERE s.id=n.reference_id
                      )
                  END,
                  CASE e.reference_type
                      WHEN 'HOUSEHOLD' THEN e.reference_id
                      WHEN 'CHORE_ASSIGNMENT' THEN (
                          SELECT a.household_id FROM chore_assignments a WHERE a.id=e.reference_id
                      )
                      WHEN 'CHORE_SCHEDULE' THEN (
                          SELECT s.household_id FROM chore_schedules s WHERE s.id=e.reference_id
                      )
                  END
              ) AS household_id
          FROM notifications n
          LEFT JOIN notification_events e ON e.id=n.event_id
      )
      """;

  private final JdbcTemplate jdbc;
  private final NotificationEventService eventService;
  private final List<NotificationDeliveryProvider> providers;
  private final NotificationCooldownService cooldownService;
  private final NotificationTemplateResolver templateResolver;
  private final MembershipExitCleanupService membershipExitCleanupService;

  public NotificationScheduler(
      JdbcTemplate jdbc,
      NotificationEventService eventService,
      List<NotificationDeliveryProvider> providers,
      NotificationCooldownService cooldownService,
      NotificationTemplateResolver templateResolver,
      MembershipExitCleanupService membershipExitCleanupService) {
    this.jdbc = jdbc;
    this.eventService = eventService;
    this.providers = providers;
    this.cooldownService = cooldownService;
    this.templateResolver = templateResolver;
    this.membershipExitCleanupService = membershipExitCleanupService;
  }

  @Scheduled(
      fixedDelayString = "${app.notifications.scheduler-delay:60000}",
      initialDelayString = "${app.notifications.scheduler-initial-delay:0}")
  @Transactional
  public void run() {
    // Lock order: affected households, recipient users, notifications/deliveries, then push
    // subscriptions updated by providers. Every processing query is restricted to these locks.
    List<UUID> householdIds =
        membershipExitCleanupService.lockExistingHouseholds(householdsTouchedByRun());
    List<UUID> userIds =
        membershipExitCleanupService.lockExistingUsers(usersTouchedByRun(householdIds));
    cancelInactiveAssignmentReminders(householdIds, userIds);
    generateAssignmentReminders(householdIds);
    dispatchDueNotifications(householdIds, userIds);
  }

  private List<UUID> householdsTouchedByRun() {
    return jdbc.query(
        NOTIFICATION_SCOPE_CTE
            + """
        , candidate_scope AS (
            SELECT s.id, s.recipient_user_id, s.household_id, n.status, n.reference_type,
                   n.reference_id, n.scheduled_at, n.expires_at, n.type,
                   d.status AS delivery_status, d.attempts, d.next_attempt_at
            FROM notification_scope s
            JOIN notifications n ON n.id=s.id
            LEFT JOIN notification_deliveries d
              ON d.notification_id=n.id AND d.channel='WEB_PUSH'
        )
        SELECT DISTINCT household_id FROM (
            SELECT a.household_id
            FROM chore_assignments a
            JOIN households h ON h.id=a.household_id
            JOIN notification_reminder_rules r ON r.mode=h.reminder_mode AND r.enabled=TRUE
            WHERE a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
            UNION
            SELECT s.household_id
            FROM candidate_scope s
            LEFT JOIN chore_assignments a
              ON s.reference_type='CHORE_ASSIGNMENT' AND a.id=s.reference_id
            WHERE s.household_id IS NOT NULL
              AND (
                  (s.status='PENDING' AND (
                      s.reference_type='CHORE_ASSIGNMENT'
                      OR s.expires_at<=NOW()
                      OR (s.scheduled_at<=NOW()
                          AND (s.expires_at IS NULL OR s.expires_at>NOW()))
                  ))
                  OR (s.delivery_status IN ('PENDING', 'FAILED') AND (
                      s.status='CANCELLED'
                      OR (s.reference_type='CHORE_ASSIGNMENT'
                          AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                              OR (s.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                                  AND a.assigned_to_user_id IS DISTINCT FROM s.recipient_user_id
                                  AND NOT EXISTS (
                                      SELECT 1 FROM chore_assignment_assignees aa
                                      WHERE aa.assignment_id=a.id
                                        AND aa.user_id=s.recipient_user_id
                                  ))))
                      OR (s.status IN ('PENDING', 'SENT', 'FAILED')
                          AND s.scheduled_at<=NOW()
                          AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=NOW())
                          AND s.attempts<3
                          AND (s.expires_at IS NULL OR s.expires_at>NOW()))
                  ))
              )
        ) affected
        WHERE household_id IS NOT NULL
        ORDER BY household_id
        """,
        (rs, row) -> rs.getObject("household_id", UUID.class));
  }

  private List<UUID> usersTouchedByRun(List<UUID> householdIds) {
    String householdMarkers = placeholders(householdIds.size());
    String householdScope =
        householdIds.isEmpty() ? "FALSE" : "s.household_id IN (" + householdMarkers + ")";
    String assignmentScope =
        householdIds.isEmpty() ? "FALSE" : "a.household_id IN (" + householdMarkers + ")";
    List<Object> args = new ArrayList<>();
    if (!householdIds.isEmpty()) {
      args.addAll(householdIds);
    }
    return jdbc.query(
        NOTIFICATION_SCOPE_CTE
            + """
            SELECT recipient_user_id FROM (
                SELECT DISTINCT s.recipient_user_id
                FROM notification_scope s
                JOIN notifications n ON n.id=s.id
                WHERE (%s OR s.household_id IS NULL)
                  AND (n.status IN ('PENDING', 'CANCELLED')
                       OR EXISTS (
                           SELECT 1 FROM notification_deliveries d
                           WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
                       ))
                UNION
                SELECT aa.user_id
                FROM chore_assignments a
                JOIN households h ON h.id=a.household_id
                JOIN notification_reminder_rules r
                  ON r.mode=h.reminder_mode AND r.enabled=TRUE
                JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id
                WHERE %s AND a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
                UNION
                SELECT a.assigned_to_user_id
                FROM chore_assignments a
                JOIN households h ON h.id=a.household_id
                JOIN notification_reminder_rules r
                  ON r.mode=h.reminder_mode AND r.enabled=TRUE
                WHERE %s AND a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
                  AND a.assigned_to_user_id IS NOT NULL
            ) users
            ORDER BY recipient_user_id
            """
                .formatted(householdScope, assignmentScope, assignmentScope),
        (rs, row) -> rs.getObject("recipient_user_id", UUID.class),
        concat(args, args, args).toArray());
  }

  private void generateAssignmentReminders(List<UUID> householdIds) {
    if (householdIds.isEmpty()) {
      return;
    }
    List<Assignment> assignments =
        jdbc.query(
            """
                SELECT a.id, a.household_id, a.due_at, a.title_snapshot,
                       h.timezone, h.reminder_mode
                FROM chore_assignments a
                JOIN households h ON h.id=a.household_id
                WHERE a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
                  AND a.household_id IN (%s)
                """
                .formatted(placeholders(householdIds.size())),
            (rs, row) ->
                new Assignment(
                    rs.getObject("id", UUID.class),
                    rs.getObject("household_id", UUID.class),
                    rs.getObject("due_at", OffsetDateTime.class),
                    rs.getString("title_snapshot"),
                    rs.getString("timezone"),
                    rs.getString("reminder_mode")),
            householdIds.toArray());

    for (Assignment assignment : assignments) {
      List<ReminderSchedulePlanner.ReminderRule> rules =
          jdbc.query(
              """
                    SELECT event_type, minutes_before_due
                    FROM notification_reminder_rules
                    WHERE mode=? AND enabled=TRUE
                    ORDER BY minutes_before_due DESC
                    """,
              (rs, row) ->
                  new ReminderSchedulePlanner.ReminderRule(
                      rs.getString("event_type"), rs.getInt("minutes_before_due")),
              assignment.reminderMode());
      if (rules.isEmpty()) {
        continue;
      }
      List<UUID> recipients =
          jdbc.query(
              """
                    SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=?
                    UNION
                    SELECT assigned_to_user_id FROM chore_assignments
                    WHERE id=? AND assigned_to_user_id IS NOT NULL
                    """,
              (rs, row) -> rs.getObject(1, UUID.class),
              assignment.id(),
              assignment.id());
      OffsetDateTime planningTime = OffsetDateTime.now(ZoneOffset.UTC);
      for (ReminderSchedulePlanner.PlannedReminder planned :
          ReminderSchedulePlanner.plan(assignment.dueAt(), rules, planningTime)) {
        ReminderSchedulePlanner.ReminderRule rule = planned.rule();
        OffsetDateTime scheduledAt = planned.scheduledAt();
        Map<String, String> variables = new HashMap<>();
        variables.put("chore_name", assignment.title());
        variables.put(
            "due_time",
            assignment
                .dueAt()
                .atZoneSameInstant(ZoneId.of(assignment.timezone()))
                .format(DUE_TIME_FORMAT));
        variables.put(
            "hours_late",
            Long.toString(
                Math.max(0, Duration.between(assignment.dueAt(), scheduledAt).toHours())));
        variables.put("scheduled_at", scheduledAt.withOffsetSameInstant(ZoneOffset.UTC).toString());
        variables.put(
            "expires_at", planned.expiresAt().withOffsetSameInstant(ZoneOffset.UTC).toString());
        for (UUID recipient : recipients) {
          Integer completionCount =
              jdbc.queryForObject(
                  """
                            SELECT COUNT(*) FROM chore_completions
                            WHERE completed_by_user_id=? AND household_id=?
                              AND completed_at >= date_trunc('week', NOW())
                            """,
                  Integer.class,
                  recipient,
                  assignment.householdId());
          variables.put(
              "completion_count", Integer.toString(completionCount == null ? 0 : completionCount));
          if (!templateResolver.hasEnabledTemplate(
                  rule.eventType(), assignment.householdId(), recipient)
              || reminderExists(rule.eventType(), assignment.id(), recipient, scheduledAt)) {
            continue;
          }
          eventService.publish(
              new NotificationEvent(
                  rule.eventType(),
                  null,
                  assignment.householdId(),
                  "CHORE_ASSIGNMENT",
                  assignment.id(),
                  "CHORE_REMINDER",
                  Map.copyOf(variables),
                  List.of(recipient)));
        }
      }
    }
  }

  private void cancelInactiveAssignmentReminders(List<UUID> householdIds, List<UUID> userIds) {
    QueryScope scope = notificationScope(householdIds, userIds);
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
            UPDATE notifications n SET status='CANCELLED'
            WHERE n.status='PENDING' AND n.reference_type='CHORE_ASSIGNMENT'
              AND n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
              AND n.id IN (
                  SELECT s.id FROM notification_scope s
                  JOIN notifications scoped ON scoped.id=s.id
                  LEFT JOIN chore_assignments a
                    ON scoped.reference_type='CHORE_ASSIGNMENT' AND a.id=scoped.reference_id
                  WHERE %s AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                      OR (a.assigned_to_user_id IS DISTINCT FROM s.recipient_user_id
                          AND NOT EXISTS (
                              SELECT 1 FROM chore_assignment_assignees aa
                              WHERE aa.assignment_id=a.id AND aa.user_id=s.recipient_user_id
                          )))
              )
            """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
            UPDATE notification_deliveries d SET status='CANCELLED'
            FROM notifications n
            LEFT JOIN chore_assignments a
              ON n.reference_type='CHORE_ASSIGNMENT' AND a.id=n.reference_id
            WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
              AND (n.status='CANCELLED'
                  OR (n.reference_type='CHORE_ASSIGNMENT'
                      AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                          OR (n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                              AND a.assigned_to_user_id IS DISTINCT FROM n.recipient_user_id
                              AND NOT EXISTS (
                                  SELECT 1 FROM chore_assignment_assignees aa
                                  WHERE aa.assignment_id=a.id
                                    AND aa.user_id=n.recipient_user_id
                              )))))
              AND n.id IN (
                  SELECT s.id FROM notification_scope s
                  WHERE %s
              )
            """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
            UPDATE notification_push_delivery_targets t
            SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
            WHERE t.status IN ('PENDING', 'FAILED')
              AND t.notification_id IN (
                  SELECT s.id FROM notification_scope s
                  JOIN notifications n ON n.id=s.id
                  LEFT JOIN chore_assignments a
                    ON n.reference_type='CHORE_ASSIGNMENT' AND a.id=n.reference_id
                  WHERE %s AND (n.status='CANCELLED'
                      OR (n.reference_type='CHORE_ASSIGNMENT'
                          AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                              OR (n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                                  AND a.assigned_to_user_id IS DISTINCT FROM n.recipient_user_id
                                  AND NOT EXISTS (
                                      SELECT 1 FROM chore_assignment_assignees aa
                                      WHERE aa.assignment_id=a.id
                                        AND aa.user_id=n.recipient_user_id
                                  )))))
              )
            """
                .formatted(scope.predicate()),
        scope.args().toArray());
  }

  private void dispatchDueNotifications(List<UUID> householdIds, List<UUID> userIds) {
    QueryScope scope = notificationScope(householdIds, userIds);
    cancelExpiredNotifications(scope);
    List<PendingNotification> pending =
        jdbc.query(
            NOTIFICATION_SCOPE_CTE
                + """
                SELECT n.id, n.event_id, n.recipient_user_id, n.type, n.category, n.priority,
                       n.title, n.message, n.reference_type, n.reference_id, n.scheduled_at,
                       n.expires_at, n.deduplication_key
                FROM notifications n
                JOIN notification_scope s ON s.id=n.id
                WHERE n.status='PENDING' AND n.scheduled_at<=NOW()
                  AND (n.expires_at IS NULL OR n.expires_at>NOW())
                  AND %s
                ORDER BY n.scheduled_at, n.created_at
                LIMIT 200
                FOR UPDATE OF n SKIP LOCKED
                """
                    .formatted(scope.predicate()),
            (rs, row) ->
                new PendingNotification(
                    rs.getObject("id", UUID.class),
                    rs.getObject("event_id", UUID.class),
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("category"),
                    rs.getString("priority"),
                    rs.getString("title"),
                    rs.getString("message"),
                    rs.getString("reference_type"),
                    rs.getObject("reference_id", UUID.class),
                    rs.getObject("scheduled_at", OffsetDateTime.class),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getString("deduplication_key")),
            scope.args().toArray());

    for (PendingNotification item : pending) {
      NotificationMessage message = item.toMessage();
      if (!isEnabled(item)
          || !isAssignmentActive(item)
          || !membershipExitCleanupService.isRecipientActiveForNotification(item.id())) {
        cancelNotification(item.id());
        continue;
      }
      OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
      if (!cooldownService.isAvailable(message, now)) {
        continue;
      }
      int sent =
          jdbc.update(
              """
                    UPDATE notifications SET status='SENT', sent_at=?
                    WHERE id=? AND status='PENDING' AND scheduled_at<=?
                    """,
              now,
              item.id(),
              now);
      if (sent == 0) {
        continue;
      }
      jdbc.update(
          """
                    UPDATE notification_deliveries SET status='SENT', sent_at=?, attempts=attempts+1
                    WHERE notification_id=? AND channel='IN_APP' AND status='PENDING'
                    """,
          now,
          item.id());
      for (NotificationDeliveryProvider provider : providers) {
        provider.deliver(message, item.eventId());
      }
    }
    dispatchPushRetries(scope);
  }

  private void cancelExpiredNotifications(QueryScope scope) {
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
                UPDATE notifications SET status='CANCELLED'
                WHERE status='PENDING' AND expires_at IS NOT NULL AND expires_at<=NOW()
                  AND id IN (
                      SELECT s.id FROM notification_scope s WHERE %s
                  )
                """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
                UPDATE notification_push_delivery_targets t
                SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
                WHERE t.status IN ('PENDING', 'FAILED')
                  AND t.notification_id IN (
                      SELECT s.id FROM notification_scope s
                      JOIN notifications n ON n.id=s.id
                      WHERE n.expires_at IS NOT NULL AND n.expires_at<=NOW()
                        AND %s
                  )
                """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
                UPDATE notification_deliveries d SET status='CANCELLED'
                FROM notifications n
                WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
                  AND n.expires_at IS NOT NULL AND n.expires_at<=NOW()
                  AND n.id IN (
                      SELECT s.id FROM notification_scope s WHERE %s
                  )
                """
                .formatted(scope.predicate()),
        scope.args().toArray());
  }

  private void dispatchPushRetries(QueryScope scope) {
    List<PendingNotification> retries =
        jdbc.query(
            NOTIFICATION_SCOPE_CTE
                + """
                SELECT n.id, n.event_id, n.recipient_user_id, n.type, n.category, n.priority,
                       n.title, n.message, n.reference_type, n.reference_id, n.scheduled_at,
                       n.expires_at, n.deduplication_key
                FROM notifications n
                JOIN notification_scope s ON s.id=n.id
                JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='WEB_PUSH'
                WHERE d.status IN ('PENDING', 'FAILED') AND d.attempts<3
                  AND n.scheduled_at<=NOW()
                  AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=NOW())
                  AND (n.expires_at IS NULL OR n.expires_at>NOW())
                  AND %s
                ORDER BY d.next_attempt_at NULLS FIRST, n.created_at
                LIMIT 200
                FOR UPDATE OF n, d SKIP LOCKED
                """
                    .formatted(scope.predicate()),
            (rs, row) ->
                new PendingNotification(
                    rs.getObject("id", UUID.class),
                    rs.getObject("event_id", UUID.class),
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("category"),
                    rs.getString("priority"),
                    rs.getString("title"),
                    rs.getString("message"),
                    rs.getString("reference_type"),
                    rs.getObject("reference_id", UUID.class),
                    rs.getObject("scheduled_at", OffsetDateTime.class),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getString("deduplication_key")),
            scope.args().toArray());
    for (PendingNotification item : retries) {
      NotificationMessage message = item.toMessage();
      if (!isEnabled(item)
          || !isAssignmentActive(item)
          || !membershipExitCleanupService.isRecipientActiveForNotification(item.id())) {
        cancelNotification(item.id());
        continue;
      }
      providers.stream()
          .filter(provider -> "WEB_PUSH".equals(provider.channel()))
          .forEach(provider -> provider.deliver(message, item.eventId()));
    }
  }

  private boolean isEnabled(PendingNotification item) {
    Boolean enabled =
        jdbc.queryForObject(
            """
                SELECT CASE
                    WHEN ?='CHORE_ASSIGNED' THEN COALESCE(p.chore_assigned_enabled, TRUE)
                    WHEN ? IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW')
                        THEN COALESCE(p.chore_reminders_enabled, TRUE)
                    WHEN ?='CHORE_OVERDUE'
                        THEN COALESCE(p.chore_reminders_enabled, TRUE)
                             AND COALESCE(p.overdue_enabled, TRUE)
                    WHEN ?='CHORE_COMPLETED' THEN COALESCE(p.chore_completion_enabled, TRUE)
                    WHEN ?='COMPETITIVE' THEN COALESCE(p.competitive_notifications_enabled, TRUE)
                    ELSE COALESCE(p.household_updates_enabled, TRUE)
                END
                FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id
                WHERE u.id=?
                """,
            Boolean.class,
            item.type(),
            item.type(),
            item.type(),
            item.type(),
            item.category(),
            item.recipientUserId());
    return Boolean.TRUE.equals(enabled);
  }

  private boolean isAssignmentActive(PendingNotification item) {
    if (!"CHORE_ASSIGNMENT".equals(item.referenceType())) {
      return true;
    }
    Boolean active =
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM chore_assignments
                              WHERE id=? AND status IN ('PENDING', 'SUBMITTED')
                )
                """,
            Boolean.class,
            item.referenceId());
    if (!Boolean.TRUE.equals(active) || !isChoreReminder(item.type())) {
      return Boolean.TRUE.equals(active);
    }
    Boolean assigned =
        jdbc.queryForObject(
            """
                SELECT EXISTS(
                    SELECT 1 FROM chore_assignments a
                    WHERE a.id=? AND (
                        a.assigned_to_user_id=? OR EXISTS (
                            SELECT 1 FROM chore_assignment_assignees aa
                            WHERE aa.assignment_id=a.id AND aa.user_id=?
                        )
                    )
                )
                """,
            Boolean.class,
            item.referenceId(),
            item.recipientUserId(),
            item.recipientUserId());
    return Boolean.TRUE.equals(assigned);
  }

  private boolean isChoreReminder(String type) {
    return "CHORE_DUE_SOON".equals(type)
        || "CHORE_DUE_NOW".equals(type)
        || "CHORE_OVERDUE".equals(type);
  }

  private void cancelNotification(UUID notificationId) {
    jdbc.update(
        "UPDATE notifications SET status='CANCELLED' WHERE id=? AND status='PENDING'",
        notificationId);
    jdbc.update(
        """
                UPDATE notification_deliveries SET status='CANCELLED'
                WHERE notification_id=? AND status IN ('PENDING', 'FAILED')
                """,
        notificationId);
    jdbc.update(
        """
                UPDATE notification_push_delivery_targets
                SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
                WHERE notification_id=? AND status IN ('PENDING', 'FAILED')
                """,
        notificationId);
  }

  private QueryScope notificationScope(List<UUID> householdIds, List<UUID> userIds) {
    String householdClause =
        householdIds.isEmpty()
            ? "FALSE"
            : "s.household_id IN (" + placeholders(householdIds.size()) + ")";
    String userClause =
        userIds.isEmpty()
            ? "FALSE"
            : "(s.household_id IS NULL AND s.recipient_user_id IN ("
                + placeholders(userIds.size())
                + "))";
    List<Object> args = new ArrayList<>(householdIds);
    args.addAll(userIds);
    return new QueryScope("(" + householdClause + " OR " + userClause + ")", args);
  }

  private static String placeholders(int count) {
    return String.join(",", java.util.Collections.nCopies(count, "?"));
  }

  @SafeVarargs
  private static List<Object> concat(List<Object>... lists) {
    List<Object> result = new ArrayList<>();
    for (List<Object> list : lists) {
      result.addAll(list);
    }
    return result;
  }

  private boolean reminderExists(
      String eventType, UUID assignmentId, UUID recipient, OffsetDateTime scheduledAt) {
    String deduplicationKey =
        String.join(
            ":",
            eventType,
            assignmentId.toString(),
            recipient.toString(),
            scheduledAt.toInstant().toString());
    Boolean exists =
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM notifications WHERE deduplication_key=?)
                """,
            Boolean.class,
            deduplicationKey);
    return Boolean.TRUE.equals(exists);
  }

  @Scheduled(cron = "${app.notifications.retention-cron:0 10 3 * * *}")
  @Transactional
  public void cleanupReadNotifications() {
    jdbc.update(
        """
                DELETE FROM notifications
                WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL '90 days'
                """);
  }

  private record Assignment(
      UUID id,
      UUID householdId,
      OffsetDateTime dueAt,
      String title,
      String timezone,
      String reminderMode) {}

  private record QueryScope(String predicate, List<Object> args) {}

  private record PendingNotification(
      UUID id,
      UUID eventId,
      UUID recipientUserId,
      String type,
      String category,
      String priority,
      String title,
      String message,
      String referenceType,
      UUID referenceId,
      OffsetDateTime scheduledAt,
      OffsetDateTime expiresAt,
      String deduplicationKey) {
    private NotificationMessage toMessage() {
      return new NotificationMessage(
          recipientUserId,
          type,
          category,
          priority,
          title,
          message,
          referenceType,
          referenceId,
          scheduledAt,
          expiresAt,
          deduplicationKey);
    }
  }
}
