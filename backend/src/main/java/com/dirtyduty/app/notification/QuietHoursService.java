package com.dirtyduty.app.notification;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Quiet hours: when a person's pushes wait. They hold push delivery only (the in-app row is created
 * right away), for every push type, and are checked once in the Web Push delivery path.
 *
 * <p>A window is evaluated in the time zone of the notification's household; a notification with no
 * household uses the person's own time zone unless it is UTC, else their active household's, else
 * UTC. Windows may cross midnight (22:00–08:00) or sit inside one day (13:00–15:00); the end is
 * resolved with {@link ZonedDateTime}, so a daylight-saving change moves it with the wall clock.
 *
 * <p>Urgent board posts skip the hold for their creation push and Remind.
 */
@Service
public class QuietHoursService {
  static final LocalTime DEFAULT_START = LocalTime.of(22, 0);
  static final LocalTime DEFAULT_END = LocalTime.of(8, 0);

  private final JdbcTemplate jdbc;
  private Clock clock = Clock.systemUTC();

  public QuietHoursService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /** Tests pin the clock; {@code null} restores the system clock. */
  public void useClock(Clock testClock) {
    this.clock = testClock == null ? Clock.systemUTC() : testClock;
  }

  public OffsetDateTime now() {
    return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
  }

  /**
   * When this notification's push may go, if the recipient is in quiet hours now; null when it may
   * go now (quiet hours off, outside the window, or an urgent post).
   */
  public OffsetDateTime holdUntil(UUID notificationId) {
    List<Target> targets =
        jdbc.query(
            """
                SELECT n.recipient_user_id, n.type, n.reference_type, n.reference_id,
                       p.quiet_hours_enabled, p.quiet_hours_start, p.quiet_hours_end
                FROM notifications n
                JOIN notification_preferences p ON p.user_id=n.recipient_user_id
                WHERE n.id=?
                """,
            (rs, row) ->
                new Target(
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("reference_type"),
                    rs.getObject("reference_id", UUID.class),
                    rs.getBoolean("quiet_hours_enabled"),
                    rs.getObject("quiet_hours_start", LocalTime.class),
                    rs.getObject("quiet_hours_end", LocalTime.class)),
            notificationId);
    if (targets.isEmpty()) {
      return null;
    }
    Target target = targets.getFirst();
    if (!target.enabled() || target.start() == null || target.end() == null) {
      return null;
    }
    if (isUrgentPostPush(target)) {
      return null;
    }
    ZoneId zone = zoneFor(notificationId, target.recipientId());
    ZonedDateTime end = windowEnd(target.start(), target.end(), now().atZoneSameInstant(zone));
    return end == null ? null : end.toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC);
  }

  /**
   * The end of the quiet window containing {@code now}, or null when {@code now} is outside it. The
   * window is [start, end) in local wall time; start after end crosses midnight.
   */
  static ZonedDateTime windowEnd(LocalTime start, LocalTime end, ZonedDateTime now) {
    if (start.equals(end)) {
      return null;
    }
    LocalTime time = now.toLocalTime();
    LocalDate day = now.toLocalDate();
    ZoneId zone = now.getZone();
    if (start.isBefore(end)) {
      boolean inside = !time.isBefore(start) && time.isBefore(end);
      return inside ? ZonedDateTime.of(day, end, zone) : null;
    }
    if (!time.isBefore(start)) {
      return ZonedDateTime.of(day.plusDays(1), end, zone);
    }
    return time.isBefore(end) ? ZonedDateTime.of(day, end, zone) : null;
  }

  /** An urgent post's creation push or Remind goes even during quiet hours. */
  private boolean isUrgentPostPush(Target target) {
    if (!"BOARD_POST".equals(target.referenceType())
        || target.referenceId() == null
        || !("BOARD_POST_NEW".equals(target.type()) || "BOARD_POST_REMIND".equals(target.type()))) {
      return false;
    }
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM board_posts WHERE id=? AND urgent)",
            Boolean.class,
            target.referenceId()));
  }

  /**
   * The household's zone for a notification about a household; otherwise the person's own zone
   * unless it is UTC, else their active household's, else UTC.
   */
  public ZoneId zoneFor(UUID notificationId, UUID recipientId) {
    List<String> household =
        jdbc.queryForList(
            """
                SELECT h.timezone FROM notifications n
                LEFT JOIN notification_events e ON e.id=n.event_id
                JOIN households h ON h.id=COALESCE(
                    e.household_id,
                    CASE n.reference_type
                        WHEN 'HOUSEHOLD' THEN n.reference_id
                        WHEN 'CHORE_ASSIGNMENT' THEN
                            (SELECT a.household_id FROM chore_assignments a WHERE a.id=n.reference_id)
                        WHEN 'CHORE_SCHEDULE' THEN
                            (SELECT s.household_id FROM chore_schedules s WHERE s.id=n.reference_id)
                        WHEN 'BOARD_POST' THEN
                            (SELECT p.household_id FROM board_posts p WHERE p.id=n.reference_id)
                        WHEN 'BOARD_LIST' THEN
                            (SELECT l.household_id FROM board_lists l WHERE l.id=n.reference_id)
                    END)
                WHERE n.id=?
                """,
            String.class,
            notificationId);
    if (!household.isEmpty() && household.getFirst() != null) {
      return zone(household.getFirst());
    }
    return personalZone(recipientId);
  }

  /** The person's own zone unless it is UTC, else their active household's, else UTC. */
  public ZoneId personalZone(UUID userId) {
    List<String> own =
        jdbc.queryForList("SELECT timezone FROM users WHERE id=?", String.class, userId);
    if (!own.isEmpty() && own.getFirst() != null && !isUtc(own.getFirst())) {
      return zone(own.getFirst());
    }
    List<String> active =
        jdbc.queryForList(
            """
                SELECT h.timezone FROM household_memberships m
                JOIN households h ON h.id=m.household_id
                WHERE m.user_id=? AND m.status='ACTIVE'
                ORDER BY m.joined_at DESC NULLS LAST LIMIT 1
                """,
            String.class,
            userId);
    return active.isEmpty() || active.getFirst() == null ? ZoneOffset.UTC : zone(active.getFirst());
  }

  private static boolean isUtc(String zone) {
    return "UTC".equalsIgnoreCase(zone) || "Etc/UTC".equalsIgnoreCase(zone) || "Z".equals(zone);
  }

  private static ZoneId zone(String id) {
    try {
      return ZoneId.of(id);
    } catch (RuntimeException invalid) {
      return ZoneOffset.UTC;
    }
  }

  private record Target(
      UUID recipientId,
      String type,
      String referenceType,
      UUID referenceId,
      boolean enabled,
      LocalTime start,
      LocalTime end) {}
}
