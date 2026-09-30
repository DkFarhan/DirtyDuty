package com.dirtyduty.app.notification;

import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class NotificationCooldownService {
    private final JdbcTemplate jdbc;

    public NotificationCooldownService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean isAvailable(NotificationMessage notification, OffsetDateTime now) {
        return isAvailable(notification, now, null);
    }

    public boolean isAvailable(
            NotificationMessage notification, OffsetDateTime now, String excludeDeduplicationKey) {
        CooldownPolicy policy = jdbc.query("""
                SELECT window_minutes, max_notifications
                FROM notification_cooldown_policies
                WHERE event_type=? AND enabled=TRUE
                """, rs -> rs.next() ? new CooldownPolicy(rs.getInt(1), rs.getInt(2)) : null,
                notification.type());
        if (policy == null) {
            return true;
        }
        jdbc.query("SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))", rs -> {
            rs.next();
            return Boolean.TRUE;
        }, notification.recipientUserId().toString(), notification.type());
        String query = """
                SELECT COUNT(DISTINCT n.id) FROM notifications n
                WHERE n.recipient_user_id=? AND n.type=?
                  AND EXISTS (
                      SELECT 1 FROM notification_deliveries d
                      WHERE d.notification_id=n.id AND d.status='SENT' AND d.sent_at>=?
                  )
                """;
        Object[] arguments = {
                notification.recipientUserId(), notification.type(), now.minusMinutes(policy.windowMinutes())};
        if (excludeDeduplicationKey != null) {
            query += " AND n.deduplication_key<>?";
            arguments = new Object[] {
                    notification.recipientUserId(), notification.type(),
                    now.minusMinutes(policy.windowMinutes()), excludeDeduplicationKey};
        }
        Integer recentCount = jdbc.queryForObject(query, Integer.class, arguments);
        return recentCount == null || recentCount < policy.maxNotifications();
    }

    private record CooldownPolicy(int windowMinutes, int maxNotifications) {}
}
