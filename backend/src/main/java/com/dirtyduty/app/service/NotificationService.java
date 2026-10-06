package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.notification.NotificationPreferencesRequest;
import com.dirtyduty.app.dto.notification.NotificationPreferencesResponse;
import com.dirtyduty.app.dto.notification.NotificationResponse;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
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
    return jdbc.query(
        """
                SELECT n.id, n.type, n.category, n.priority, n.title, n.message, n.reference_type, n.reference_id,
                       n.status, n.scheduled_at,
                       COALESCE(d.sent_at, n.sent_at, n.created_at) AS delivered_at,
                       n.sent_at, n.read_at, n.created_at
                FROM notifications n
                LEFT JOIN notification_deliveries d
                    ON d.notification_id = n.id AND d.channel = 'IN_APP'
                WHERE n.recipient_user_id=? AND n.status='SENT'
                ORDER BY COALESCE(d.sent_at, n.sent_at, n.created_at) DESC, n.id DESC
                """,
        (rs, row) -> {
          OffsetDateTime deliveredAt = rs.getObject("delivered_at", OffsetDateTime.class);
          return new NotificationResponse(
              rs.getObject("id", UUID.class),
              rs.getString("type"),
              rs.getString("category"),
              rs.getString("priority"),
              rs.getString("title"),
              rs.getString("message"),
              rs.getString("reference_type"),
              rs.getObject("reference_id", UUID.class),
              rs.getString("status"),
              rs.getObject("scheduled_at", OffsetDateTime.class),
              deliveredAt,
              deliveredAt,
              rs.getObject("read_at", OffsetDateTime.class),
              rs.getObject("created_at", OffsetDateTime.class));
        },
        userId);
  }

  @Transactional(readOnly = true)
  public long unreadCount(Authentication authentication) {
    UUID userId = currentUserId(authentication);
    return jdbc.queryForObject(
        """
                SELECT COUNT(*) FROM notifications
                WHERE recipient_user_id=? AND status='SENT' AND read_at IS NULL
                """,
        Long.class,
        userId);
  }

  @Transactional
  public void markRead(UUID notificationId, Authentication authentication) {
    UUID userId = currentUserId(authentication);
    int updated =
        jdbc.update(
            """
                UPDATE notifications SET read_at=COALESCE(read_at, ?)
                WHERE id=? AND recipient_user_id=? AND status='SENT'
                """,
            OffsetDateTime.now(ZoneOffset.UTC),
            notificationId,
            userId);
    if (updated == 0) {
      throw new ResourceNotFoundException("Notification was not found.");
    }
  }

  @Transactional
  public void markAllRead(Authentication authentication) {
    UUID userId = currentUserId(authentication);
    jdbc.update(
        """
                UPDATE notifications SET read_at=?
                WHERE recipient_user_id=? AND status='SENT' AND read_at IS NULL
                """,
        OffsetDateTime.now(ZoneOffset.UTC),
        userId);
  }

  @Transactional(readOnly = true)
  public NotificationPreferencesResponse preferences(Authentication authentication) {
    UUID userId = currentUserId(authentication);
    return jdbc.queryForObject(
        """
                SELECT COALESCE(chore_reminders_enabled, TRUE) AS chore_reminders_enabled,
                       COALESCE(chore_assigned_enabled, TRUE) AS chore_assigned_enabled,
                       COALESCE(overdue_enabled, TRUE) AS overdue_enabled,
                       COALESCE(chore_completion_enabled, TRUE) AS chore_completion_enabled,
                       COALESCE(household_updates_enabled, TRUE) AS household_updates_enabled,
                       quiet_hours_start, quiet_hours_end,
                       notification_style_override,
                       COALESCE(household_default.notification_style, 'NORMAL') AS household_notification_style,
                       COALESCE(funny_notifications_enabled, FALSE) AS funny_notifications_enabled,
                       COALESCE(competitive_notifications_enabled, TRUE) AS competitive_notifications_enabled,
                       COALESCE(push_enabled, FALSE) AS push_enabled
                FROM users LEFT JOIN notification_preferences ON users.id=notification_preferences.user_id
                LEFT JOIN LATERAL (
                    SELECT h.notification_style
                    FROM household_memberships hm
                    JOIN households h ON h.id=hm.household_id
                    WHERE hm.user_id=users.id AND hm.status='ACTIVE'
                    ORDER BY hm.joined_at DESC NULLS LAST
                    LIMIT 1
                ) household_default ON TRUE
                WHERE users.id=?
                """,
        (rs, row) ->
            new NotificationPreferencesResponse(
                rs.getBoolean("chore_assigned_enabled"),
                rs.getBoolean("chore_reminders_enabled"),
                rs.getBoolean("overdue_enabled"),
                rs.getBoolean("chore_completion_enabled"),
                rs.getBoolean("household_updates_enabled"),
                rs.getObject("quiet_hours_start", java.time.LocalTime.class),
                rs.getObject("quiet_hours_end", java.time.LocalTime.class),
                rs.getString("notification_style_override"),
                rs.getString("household_notification_style"),
                rs.getBoolean("funny_notifications_enabled"),
                rs.getBoolean("competitive_notifications_enabled"),
                rs.getBoolean("push_enabled")),
        userId);
  }

  @Transactional
  public NotificationPreferencesResponse updatePreferences(
      NotificationPreferencesRequest request, Authentication authentication) {
    if ((request.quietHoursStart() == null) != (request.quietHoursEnd() == null)) {
      throw new InvalidHouseholdException("Both quiet hours start and end must be provided.");
    }
    UUID userId = currentUserId(authentication);
    jdbc.update(
        """
                INSERT INTO notification_preferences
                    (user_id, chore_assigned_enabled, chore_reminders_enabled, overdue_enabled,
                     chore_completion_enabled, household_updates_enabled, quiet_hours_start, quiet_hours_end,
                     notification_style_override, funny_notifications_enabled,
                     competitive_notifications_enabled, push_enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                    chore_assigned_enabled=EXCLUDED.chore_assigned_enabled,
                    chore_reminders_enabled=EXCLUDED.chore_reminders_enabled,
                    overdue_enabled=EXCLUDED.overdue_enabled,
                    chore_completion_enabled=EXCLUDED.chore_completion_enabled,
                    household_updates_enabled=EXCLUDED.household_updates_enabled,
                    quiet_hours_start=EXCLUDED.quiet_hours_start,
                    quiet_hours_end=EXCLUDED.quiet_hours_end,
                    notification_style_override=EXCLUDED.notification_style_override,
                    funny_notifications_enabled=EXCLUDED.funny_notifications_enabled,
                    competitive_notifications_enabled=EXCLUDED.competitive_notifications_enabled,
                    push_enabled=EXCLUDED.push_enabled,
                    updated_at=NOW()
                """,
        userId,
        request.choreAssignedEnabled(),
        request.choreRemindersEnabled(),
        request.overdueEnabled(),
        request.choreCompletionEnabled(),
        request.householdUpdatesEnabled(),
        request.quietHoursStart(),
        request.quietHoursEnd(),
        request.notificationStyleOverride(),
        request.funnyNotificationsEnabled(),
        request.competitiveNotificationsEnabled(),
        request.pushEnabled());
    return preferences(authentication);
  }

  @Transactional
  public void updateHouseholdStyle(UUID householdId, String style, Authentication authentication) {
    UUID userId = currentUserId(authentication);
    int updated =
        jdbc.update(
            """
                UPDATE households h SET notification_style=?, updated_at=NOW()
                WHERE h.id=? AND EXISTS (
                    SELECT 1 FROM household_memberships hm
                    WHERE hm.household_id=h.id AND hm.user_id=?
                      AND hm.status='ACTIVE' AND hm.role IN ('OWNER', 'ADMIN')
                )
                """,
            style,
            householdId,
            userId);
    if (updated == 0) {
      throw new HouseholdAccessDeniedException(
          "Only a household owner or admin may update its notification style.");
    }
  }

  private UUID currentUserId(Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new ResourceNotFoundException("Authenticated user was not found.");
    }
    return userRepository
        .findByEmailIgnoreCase(authentication.getName())
        .map(user -> user.getId())
        .orElseThrow(() -> new ResourceNotFoundException("Authenticated user was not found."));
  }
}
