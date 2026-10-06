package com.dirtyduty.app.notification;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
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

  private final JdbcTemplate jdbc;
  private final NotificationEventService eventService;
  private final List<NotificationDeliveryProvider> providers;
  private final NotificationCooldownService cooldownService;
  private final NotificationTemplateResolver templateResolver;

  public NotificationScheduler(
      JdbcTemplate jdbc,
      NotificationEventService eventService,
      List<NotificationDeliveryProvider> providers,
      NotificationCooldownService cooldownService,
      NotificationTemplateResolver templateResolver) {
    this.jdbc = jdbc;
    this.eventService = eventService;
    this.providers = providers;
    this.cooldownService = cooldownService;
    this.templateResolver = templateResolver;
  }

  @Scheduled(fixedDelayString = "${app.notifications.scheduler-delay:60000}")
  @Transactional
  public void run() {
    cancelInactiveAssignmentReminders();
    generateAssignmentReminders();
    dispatchDueNotifications();
  }

  private void generateAssignmentReminders() {
    List<Assignment> assignments =
        jdbc.query(
            """
                SELECT a.id, a.household_id, a.due_at, a.title_snapshot,
                       h.timezone, h.reminder_mode
                FROM chore_assignments a
                JOIN households h ON h.id=a.household_id
                WHERE a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
                """,
            (rs, row) ->
                new Assignment(
                    rs.getObject("id", UUID.class),
                    rs.getObject("household_id", UUID.class),
                    rs.getObject("due_at", OffsetDateTime.class),
                    rs.getString("title_snapshot"),
                    rs.getString("timezone"),
                    rs.getString("reminder_mode")));

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

  private void cancelInactiveAssignmentReminders() {
    jdbc.update(
        """
                UPDATE notifications n SET status='CANCELLED'
                WHERE n.status='PENDING' AND n.reference_type='CHORE_ASSIGNMENT'
                  AND NOT EXISTS (
                      SELECT 1 FROM chore_assignments a
                      WHERE a.id=n.reference_id AND a.status IN ('PENDING', 'SUBMITTED')
                  )
                """);
    jdbc.update(
        """
                UPDATE notification_deliveries d SET status='CANCELLED'
                FROM notifications n
                LEFT JOIN chore_assignments a
                    ON a.id=n.reference_id AND n.reference_type='CHORE_ASSIGNMENT'
                WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
                  AND (n.status='CANCELLED'
                       OR (n.reference_type='CHORE_ASSIGNMENT'
                           AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED'))))
                """);
  }

  private void dispatchDueNotifications() {
    cancelExpiredNotifications();
    List<PendingNotification> pending =
        jdbc.query(
            """
                SELECT n.id, n.event_id, n.recipient_user_id, n.type, n.category, n.priority,
                       n.title, n.message, n.reference_type, n.reference_id, n.scheduled_at,
                       n.expires_at, n.deduplication_key
                FROM notifications n
                WHERE n.status='PENDING' AND n.scheduled_at<=NOW()
                  AND (n.expires_at IS NULL OR n.expires_at>NOW())
                ORDER BY n.scheduled_at, n.created_at
                LIMIT 200
                FOR UPDATE OF n SKIP LOCKED
                """,
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
                    rs.getString("deduplication_key")));

    for (PendingNotification item : pending) {
      NotificationMessage message = item.toMessage();
      if (!isEnabled(item) || !isAssignmentActive(item)) {
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
    dispatchPushRetries();
  }

  private void cancelExpiredNotifications() {
    jdbc.update(
        """
                UPDATE notifications SET status='CANCELLED'
                WHERE status='PENDING' AND expires_at IS NOT NULL AND expires_at<=NOW()
                """);
    jdbc.update(
        """
                UPDATE notification_deliveries d SET status='CANCELLED'
                FROM notifications n
                WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
                  AND n.expires_at IS NOT NULL AND n.expires_at<=NOW()
                """);
  }

  private void dispatchPushRetries() {
    List<PendingNotification> retries =
        jdbc.query(
            """
                SELECT n.id, n.event_id, n.recipient_user_id, n.type, n.category, n.priority,
                       n.title, n.message, n.reference_type, n.reference_id, n.scheduled_at,
                       n.expires_at, n.deduplication_key
                FROM notifications n
                JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='WEB_PUSH'
                WHERE d.status IN ('PENDING', 'FAILED') AND d.attempts<3
                  AND n.scheduled_at<=NOW()
                  AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=NOW())
                  AND (n.expires_at IS NULL OR n.expires_at>NOW())
                ORDER BY d.next_attempt_at NULLS FIRST, n.created_at
                LIMIT 200
                FOR UPDATE OF n, d SKIP LOCKED
                """,
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
                    rs.getString("deduplication_key")));
    for (PendingNotification item : retries) {
      NotificationMessage message = item.toMessage();
      if (!isEnabled(item) || !isAssignmentActive(item)) {
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
                              WHERE id=? AND status IN ('PENDING', 'SUBMITTED'))
                """,
            Boolean.class,
            item.referenceId());
    return Boolean.TRUE.equals(active);
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
