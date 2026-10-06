package com.dirtyduty.app.notification;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@Order(1)
public class InAppNotificationProvider implements NotificationDeliveryProvider {
  private final JdbcTemplate jdbc;
  private final NotificationCooldownService cooldownService;

  public InAppNotificationProvider(JdbcTemplate jdbc, NotificationCooldownService cooldownService) {
    this.jdbc = jdbc;
    this.cooldownService = cooldownService;
  }

  @Override
  public String channel() {
    return "IN_APP";
  }

  @Override
  public void deliver(NotificationMessage notification, UUID eventId) {
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
                FROM users u
                LEFT JOIN notification_preferences p ON p.user_id=u.id
                WHERE u.id=?
                """,
            Boolean.class,
            notification.type(),
            notification.type(),
            notification.type(),
            notification.type(),
            notification.category(),
            notification.recipientUserId());
    if (!Boolean.TRUE.equals(enabled)) {
      return;
    }
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime scheduledAt =
        notification.scheduledAt() == null ? now : notification.scheduledAt();
    boolean due = !scheduledAt.isAfter(now);
    boolean cooldownAvailable =
        due && cooldownService.isAvailable(notification, now, notification.deduplicationKey());
    jdbc.update(
        """
                INSERT INTO notifications
                    (recipient_user_id, event_id, type, category, priority, title, message,
                     reference_type, reference_id, status, scheduled_at, expires_at, sent_at, deduplication_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (deduplication_key) DO NOTHING
                """,
        notification.recipientUserId(),
        eventId,
        notification.type(),
        notification.category(),
        notification.priority(),
        notification.title(),
        notification.message(),
        notification.referenceType(),
        notification.referenceId(),
        cooldownAvailable ? "SENT" : "PENDING",
        scheduledAt,
        notification.expiresAt(),
        cooldownAvailable ? now : null,
        notification.deduplicationKey());
    jdbc.update(
        """
                INSERT INTO notification_deliveries (notification_id, channel, status, sent_at)
                SELECT id, 'IN_APP', CASE WHEN status='SENT' THEN 'SENT' ELSE 'PENDING' END, sent_at
                FROM notifications WHERE deduplication_key=?
                ON CONFLICT (notification_id, channel) DO NOTHING
                """,
        notification.deduplicationKey());
  }
}
