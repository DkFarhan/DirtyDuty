package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.notification.NotificationPreferencesRequest;
import com.dirtyduty.app.dto.notification.NotificationPreferencesResponse;
import com.dirtyduty.app.dto.notification.NotificationResponse;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {
    private final JdbcTemplate jdbc;
    private final UserRepository userRepository;

    public NotificationService(JdbcTemplate jdbc, UserRepository userRepository) {
        this.jdbc = jdbc;
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public List<NotificationResponse> list(Authentication authentication) {
        UUID userId = currentUserId(authentication);
        return jdbc.query("""
                SELECT id, type, category, priority, title, message, reference_type, reference_id,
                       status, scheduled_at, sent_at, read_at, created_at
                FROM notifications
                WHERE recipient_user_id=? AND status='SENT'
                ORDER BY created_at DESC, id DESC
                """, (rs, row) -> new NotificationResponse(
                rs.getObject("id", UUID.class), rs.getString("type"), rs.getString("category"),
                rs.getString("priority"), rs.getString("title"), rs.getString("message"),
                rs.getString("reference_type"), rs.getObject("reference_id", UUID.class),
                rs.getString("status"), rs.getObject("scheduled_at", OffsetDateTime.class),
                rs.getObject("sent_at", OffsetDateTime.class), rs.getObject("read_at", OffsetDateTime.class),
                rs.getObject("created_at", OffsetDateTime.class)), userId);
    }

    @Transactional(readOnly = true)
    public long unreadCount(Authentication authentication) {
        UUID userId = currentUserId(authentication);
        return jdbc.queryForObject("""
                SELECT COUNT(*) FROM notifications
                WHERE recipient_user_id=? AND status='SENT' AND read_at IS NULL
                """, Long.class, userId);
    }

    @Transactional
    public void markRead(UUID notificationId, Authentication authentication) {
        UUID userId = currentUserId(authentication);
        int updated = jdbc.update("""
                UPDATE notifications SET read_at=COALESCE(read_at, ?)
                WHERE id=? AND recipient_user_id=? AND status='SENT'
                """, OffsetDateTime.now(ZoneOffset.UTC), notificationId, userId);
        if (updated == 0) {
            throw new ResourceNotFoundException("Notification was not found.");
        }
    }

    @Transactional
    public void markAllRead(Authentication authentication) {
        UUID userId = currentUserId(authentication);
        jdbc.update("""
                UPDATE notifications SET read_at=?
                WHERE recipient_user_id=? AND status='SENT' AND read_at IS NULL
                """, OffsetDateTime.now(ZoneOffset.UTC), userId);
    }

    @Transactional(readOnly = true)
    public NotificationPreferencesResponse preferences(Authentication authentication) {
        UUID userId = currentUserId(authentication);
        return jdbc.queryForObject("""
                SELECT COALESCE(chore_reminders_enabled, TRUE) AS chore_reminders_enabled,
                       COALESCE(chore_completion_enabled, TRUE) AS chore_completion_enabled,
                       COALESCE(household_updates_enabled, TRUE) AS household_updates_enabled,
                       quiet_hours_start, quiet_hours_end,
                       COALESCE(funny_notifications_enabled, FALSE) AS funny_notifications_enabled,
                       COALESCE(push_enabled, FALSE) AS push_enabled
                FROM users LEFT JOIN notification_preferences ON users.id=notification_preferences.user_id
                WHERE users.id=?
                """, (rs, row) -> new NotificationPreferencesResponse(
                rs.getBoolean("chore_reminders_enabled"), rs.getBoolean("chore_completion_enabled"),
                rs.getBoolean("household_updates_enabled"), rs.getObject("quiet_hours_start", java.time.LocalTime.class),
                rs.getObject("quiet_hours_end", java.time.LocalTime.class),
                rs.getBoolean("funny_notifications_enabled"), rs.getBoolean("push_enabled")), userId);
    }

    @Transactional
    public NotificationPreferencesResponse updatePreferences(
            NotificationPreferencesRequest request, Authentication authentication) {
        if ((request.quietHoursStart() == null) != (request.quietHoursEnd() == null)) {
            throw new InvalidHouseholdException("Both quiet hours start and end must be provided.");
        }
        UUID userId = currentUserId(authentication);
        jdbc.update("""
                INSERT INTO notification_preferences
                    (user_id, chore_reminders_enabled, chore_completion_enabled, household_updates_enabled,
                     quiet_hours_start, quiet_hours_end, funny_notifications_enabled, push_enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                    chore_reminders_enabled=EXCLUDED.chore_reminders_enabled,
                    chore_completion_enabled=EXCLUDED.chore_completion_enabled,
                    household_updates_enabled=EXCLUDED.household_updates_enabled,
                    quiet_hours_start=EXCLUDED.quiet_hours_start,
                    quiet_hours_end=EXCLUDED.quiet_hours_end,
                    funny_notifications_enabled=EXCLUDED.funny_notifications_enabled,
                    push_enabled=EXCLUDED.push_enabled,
                    updated_at=NOW()
                """, userId, request.choreRemindersEnabled(), request.choreCompletionEnabled(),
                request.householdUpdatesEnabled(), request.quietHoursStart(), request.quietHoursEnd(),
                request.funnyNotificationsEnabled(), request.pushEnabled());
        return preferences(authentication);
    }

    private UUID currentUserId(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new ResourceNotFoundException("Authenticated user was not found.");
        }
        return userRepository.findByEmailIgnoreCase(authentication.getName())
                .map(user -> user.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Authenticated user was not found."));
    }
}
