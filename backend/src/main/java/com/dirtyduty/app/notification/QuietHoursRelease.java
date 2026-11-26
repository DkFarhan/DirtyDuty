package com.dirtyduty.app.notification;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The morning after quiet hours: what was held for a person goes out at the end of their window,
 * once, in this order.
 *
 * <ol>
 *   <li>Held pushes that no longer apply are dropped (the chore was done, skipped or given away;
 *       the post was deleted, fixed or is past; the list item was bought or isn't needed today).
 *   <li>Pushes about one subject collapse: one chore keeps its most advanced reminder (overdue, due
 *       now, due soon, assigned), one post or one list keeps its latest push.
 *   <li>One or two left go as themselves, most important first, the second 5 minutes later.
 *   <li>More than two become at most two grouped pushes that name the things: the person's chores
 *       first, then everything else 5 minutes later (an empty group is left out). The held pushes
 *       themselves are then never sent.
 * </ol>
 *
 * The in-app rows are untouched throughout; grouped pushes are push-only.
 */
@Service
public class QuietHoursRelease {
  static final Duration SECOND_PUSH_DELAY = Duration.ofMinutes(5);
  static final Set<String> CHORE_TYPES =
      Set.of(
          "CHORE_OVERDUE",
          "CHORE_DUE_NOW",
          "CHORE_DUE_SOON",
          "CHORE_NEEDS_DOING",
          "CHORE_ASSIGNED");
  private static final DateTimeFormatter WEEKDAY =
      DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH);

  private final JdbcTemplate jdbc;
  private final QuietHoursService quietHours;
  private final WebPushNotificationProvider webPush;

  public QuietHoursRelease(
      JdbcTemplate jdbc, QuietHoursService quietHours, WebPushNotificationProvider webPush) {
    this.jdbc = jdbc;
    this.quietHours = quietHours;
    this.webPush = webPush;
  }

  /** Releases the pushes held for these people whose window has ended (or who turned it off). */
  public void releaseDue(Collection<UUID> recipientIds) {
    if (recipientIds.isEmpty()) {
      return;
    }
    OffsetDateTime now = quietHours.now();
    List<Object> args = new ArrayList<>();
    args.add(now);
    args.addAll(recipientIds);
    List<Held> held =
        jdbc.query(
            """
                SELECT n.id, n.recipient_user_id, n.type, n.title, n.reference_type,
                       n.reference_id, n.status, n.expires_at, n.created_at, d.quiet_held_until
                FROM notifications n
                JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='WEB_PUSH'
                WHERE d.quiet_held_until IS NOT NULL AND d.status IN ('PENDING', 'FAILED')
                  AND d.next_attempt_at<=? AND n.recipient_user_id IN (%s)
                ORDER BY n.recipient_user_id, n.created_at, n.id
                FOR UPDATE OF d SKIP LOCKED
                """
                .formatted(String.join(",", recipientIds.stream().map(id -> "?").toList())),
            (rs, row) ->
                new Held(
                    rs.getObject("id", UUID.class),
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("title"),
                    rs.getString("reference_type"),
                    rs.getObject("reference_id", UUID.class),
                    rs.getString("status"),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getObject("created_at", OffsetDateTime.class),
                    rs.getObject("quiet_held_until", OffsetDateTime.class)),
            args.toArray());
    Map<UUID, List<Held>> byRecipient =
        held.stream()
            .collect(
                Collectors.groupingBy(Held::recipientId, LinkedHashMap::new, Collectors.toList()));
    byRecipient.forEach((recipient, items) -> releaseFor(recipient, items, now));
  }

  private void releaseFor(UUID recipient, List<Held> items, OffsetDateTime now) {
    List<Held> live = new ArrayList<>();
    for (Held item : items) {
      if ("PENDING".equals(item.status())) {
        // Not in the app yet (e.g. held back by a reminder cooldown): it isn't this morning's to
        // send. It goes back to the normal flow, which delivers it once it's live (and checks
        // quiet hours again then).
        resume(item);
        continue;
      }
      if (isStale(item, now)) {
        finish(item, "No longer applies after quiet hours.");
      } else {
        live.add(item);
      }
    }
    Map<String, Held> bySubject = new LinkedHashMap<>();
    for (Held item : live) {
      Held kept = bySubject.get(subjectOf(item));
      if (kept == null) {
        bySubject.put(subjectOf(item), item);
      } else if (supersedes(item, kept)) {
        finish(kept, "Replaced by a newer push after quiet hours.");
        bySubject.put(subjectOf(item), item);
      } else {
        finish(item, "Replaced by a newer push after quiet hours.");
      }
    }
    List<Ranked> remaining =
        bySubject.values().stream()
            .map(item -> new Ranked(item, importance(item)))
            .sorted(
                Comparator.comparingInt(Ranked::importance)
                    .thenComparing(ranked -> ranked.item().createdAt()))
            .toList();
    if (remaining.isEmpty()) {
      return;
    }
    if (remaining.size() <= 2) {
      // The first goes now, in this run (the window has ended, so delivery doesn't hold it
      // again); the second 5 minutes after the window's end, or after now when released early.
      Held first = remaining.getFirst().item();
      OffsetDateTime base = first.heldUntil().isBefore(now) ? first.heldUntil() : now;
      sendNow(first);
      if (remaining.size() == 2) {
        release(remaining.get(1).item(), base.plus(SECOND_PUSH_DELAY));
      }
      return;
    }
    OffsetDateTime windowEnd =
        remaining.stream()
            .map(ranked -> ranked.item().heldUntil())
            .min(Comparator.naturalOrder())
            .orElse(now);
    List<Held> chores =
        remaining.stream().map(Ranked::item).filter(QuietHoursRelease::isChore).toList();
    List<Held> others =
        remaining.stream().map(Ranked::item).filter(item -> !isChore(item)).toList();
    OffsetDateTime next = now;
    if (!chores.isEmpty()) {
      digest(
          recipient,
          "CHORES",
          "Your chores",
          choresMessage(chores),
          "/?screen=my-chores",
          windowEnd,
          next);
      next = now.plus(SECOND_PUSH_DELAY);
    }
    if (!others.isEmpty()) {
      boolean board = others.stream().anyMatch(QuietHoursRelease::isBoard);
      digest(
          recipient,
          "OTHER",
          board ? "On the Board" : "Household updates",
          othersMessage(others, board),
          board ? "/?screen=board" : "/?screen=notifications",
          windowEnd,
          next);
    }
    for (Ranked ranked : remaining) {
      finish(ranked.item(), "Grouped into the morning push.");
    }
  }

  /** Sends the grouped pushes that are due for these people (after the caller commits). */
  public void sendDue(Collection<UUID> recipientIds) {
    if (recipientIds.isEmpty()) {
      return;
    }
    List<Object> args = new ArrayList<>();
    args.add(quietHours.now());
    args.addAll(recipientIds);
    List<Digest> due =
        jdbc.query(
            """
                SELECT id, send_at, recipient_user_id, title, message, target_path
                FROM notification_push_digests
                WHERE status='PENDING' AND send_at<=? AND recipient_user_id IN (%s)
                ORDER BY send_at, created_at
                FOR UPDATE SKIP LOCKED
                """
                .formatted(String.join(",", recipientIds.stream().map(id -> "?").toList())),
            (rs, row) ->
                new Digest(
                    rs.getObject("id", UUID.class),
                    rs.getObject("send_at", OffsetDateTime.class),
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("title"),
                    rs.getString("message"),
                    rs.getString("target_path")),
            args.toArray());
    // Each goes once this transaction commits (no lock held while it's on its way); the
    // provider records how it went.
    for (Digest digest : due) {
      webPush.sendDigest(
          digest.id(),
          digest.sendAt(),
          digest.recipientId(),
          digest.title(),
          digest.message(),
          digest.targetPath());
    }
  }

  // ---- Clean up and collapse -------------------------------------------------------------------

  /** Reuses the freshness rules the delivery path applies to reminders and board pushes. */
  private boolean isStale(Held item, OffsetDateTime now) {
    if ("CANCELLED".equals(item.status())) {
      return true;
    }
    if (item.expiresAt() != null && !item.expiresAt().isAfter(now)) {
      return true;
    }
    if (item.referenceId() == null) {
      return false;
    }
    return switch (item.referenceType()) {
      case "CHORE_ASSIGNMENT" -> isChore(item) && !choreStillTheirs(item);
      case "BOARD_POST" ->
          !Boolean.TRUE.equals(
              jdbc.queryForObject(
                  """
                      SELECT EXISTS(SELECT 1 FROM board_posts
                                    WHERE id=? AND past_at IS NULL AND fixed_at IS NULL)
                      """,
                  Boolean.class,
                  item.referenceId()));
      case "BOARD_LIST" -> neededToday(item).isEmpty();
      // An ask or "nobody took it" about a request that has closed (E11).
      case "CHORE_REQUEST" ->
          item.type().startsWith("REQUEST_")
              && !"REQUEST_ACCEPTED".equals(item.type())
              && !"REQUEST_DECLINED".equals(item.type())
              && !"REQUEST_EXPIRED".equals(item.type())
              && !Boolean.TRUE.equals(
                  jdbc.queryForObject(
                      "SELECT EXISTS(SELECT 1 FROM chore_requests WHERE id=? AND status='OPEN')",
                      Boolean.class,
                      item.referenceId()));
      default -> false;
    };
  }

  private boolean choreStillTheirs(Held item) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
                SELECT EXISTS(
                    SELECT 1 FROM chore_assignments a
                    WHERE a.id=? AND a.status IN ('PENDING', 'SUBMITTED')
                      AND (a.assigned_to_user_id=? OR EXISTS (
                          SELECT 1 FROM chore_assignment_assignees aa
                          WHERE aa.assignment_id=a.id AND aa.user_id=?)
                          OR (a.kind_snapshot='AS_NEEDED' AND ?='CHORE_NEEDS_DOING')))
                """,
            Boolean.class,
            item.referenceId(),
            item.recipientId(),
            item.recipientId(),
            item.type()));
  }

  /** The list's open items flagged for its household's today, oldest flag first. */
  private List<String> neededToday(Held item) {
    LocalDate today =
        quietHours
            .now()
            .atZoneSameInstant(quietHours.zoneFor(item.id(), item.recipientId()))
            .toLocalDate();
    return jdbc.queryForList(
        """
            SELECT i.name FROM board_list_items i
            JOIN board_lists l ON l.id=i.list_id AND l.archived_at IS NULL
            WHERE i.list_id=? AND i.bought_at IS NULL AND i.needed_today_on=?
            ORDER BY i.needed_today_at, i.id
            """,
        String.class,
        item.referenceId(),
        today);
  }

  /**
   * What a push is about. A chore push is about its occurrence, except for "After it's done" and
   * "When needed" chores (one open copy) and pushes about the chore's schedule ("New shared job"):
   * those are about the chore, so "assigned" and "needs doing" for one job collapse.
   */
  private String subjectOf(Held item) {
    if (item.referenceId() == null) {
      return "n:" + item.id();
    }
    if (isChore(item) && "CHORE_SCHEDULE".equals(item.referenceType())) {
      return jdbc
          .queryForList(
              "SELECT chore_id FROM chore_schedules WHERE id=?", UUID.class, item.referenceId())
          .stream()
          .findFirst()
          .map(chore -> "chore:" + chore)
          .orElse("n:" + item.id());
    }
    return switch (item.referenceType()) {
      case "CHORE_ASSIGNMENT" ->
          isChore(item)
              ? jdbc
                  .query(
                      "SELECT chore_id, kind_snapshot FROM chore_assignments WHERE id=?",
                      (rs, row) ->
                          "CALENDAR".equals(rs.getString("kind_snapshot"))
                              ? "occurrence:" + item.referenceId()
                              : "chore:" + rs.getObject("chore_id", UUID.class),
                      item.referenceId())
                  .stream()
                  .findFirst()
                  .orElse("occurrence:" + item.referenceId())
              : "n:" + item.id();
      case "BOARD_POST" -> "post:" + item.referenceId();
      case "BOARD_LIST" -> "list:" + item.referenceId();
      default -> "n:" + item.id();
    };
  }

  /** A chore's most advanced reminder wins; otherwise the latest push about the subject. */
  private static boolean supersedes(Held candidate, Held kept) {
    if (isChore(candidate) && isChore(kept)) {
      int byStage = Integer.compare(choreStage(candidate.type()), choreStage(kept.type()));
      if (byStage != 0) {
        return byStage > 0;
      }
    }
    return candidate.createdAt().isAfter(kept.createdAt());
  }

  private static int choreStage(String type) {
    return switch (type) {
      case "CHORE_OVERDUE" -> 4;
      case "CHORE_DUE_NOW", "CHORE_NEEDS_DOING" -> 3;
      case "CHORE_DUE_SOON" -> 2;
      default -> 1;
    };
  }

  /**
   * Lower goes first: overdue, due now, due today, newly assigned; then posts picked for this
   * person, event reminders, everything else.
   */
  private int importance(Held item) {
    if (isChore(item)) {
      return switch (item.type()) {
        case "CHORE_OVERDUE" -> 0;
        case "CHORE_DUE_NOW", "CHORE_NEEDS_DOING" -> 1;
        case "CHORE_DUE_SOON" -> 2;
        default -> 3;
      };
    }
    if ("BOARD_POST".equals(item.referenceType()) && item.referenceId() != null) {
      if ("BOARD_EVENT_REMINDER".equals(item.type())) {
        return 11;
      }
      Boolean picked =
          jdbc.queryForObject(
              "SELECT EXISTS(SELECT 1 FROM board_posts WHERE id=? AND notify_mode='PICKED')",
              Boolean.class,
              item.referenceId());
      return Boolean.TRUE.equals(picked) ? 10 : 12;
    }
    return isBoard(item) ? 12 : 13;
  }

  private static boolean isChore(Held item) {
    return CHORE_TYPES.contains(item.type());
  }

  private static boolean isBoard(Held item) {
    return "BOARD_POST".equals(item.referenceType()) || "BOARD_LIST".equals(item.referenceType());
  }

  // ---- Send ------------------------------------------------------------------------------------

  /** It goes as itself, now, through the usual Web Push delivery. */
  private void sendNow(Held item) {
    jdbc.update(
        """
            UPDATE notification_deliveries
            SET quiet_held_until=NULL, next_attempt_at=NULL, last_error=NULL
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        item.id());
    jdbc.query(
            """
                SELECT recipient_user_id, type, category, priority, title, message, reference_type,
                       reference_id, scheduled_at, expires_at, deduplication_key, event_id
                FROM notifications WHERE id=?
                """,
            (rs, row) ->
                Map.entry(
                    new NotificationMessage(
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
                    java.util.Optional.ofNullable(rs.getObject("event_id", UUID.class))),
            item.id())
        .forEach(entry -> webPush.deliver(entry.getKey(), entry.getValue().orElse(null)));
  }

  /** It goes as itself at {@code at} (the retry path sends it then; it's no longer held). */
  private void release(Held item, OffsetDateTime at) {
    jdbc.update(
        """
            UPDATE notification_deliveries
            SET quiet_held_until=NULL, next_attempt_at=?, last_error=NULL
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        at,
        item.id());
  }

  /** Back to the normal flow, untouched by the morning release. */
  private void resume(Held item) {
    jdbc.update(
        """
            UPDATE notification_deliveries
            SET quiet_held_until=NULL, next_attempt_at=NULL, last_error=NULL
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        item.id());
  }

  /** It won't go: dropped, replaced, or carried by a grouped push. The in-app row stays. */
  private void finish(Held item, String reason) {
    jdbc.update(
        """
            UPDATE notification_deliveries
            SET status='CANCELLED', quiet_held_until=NULL, next_attempt_at=NULL, last_error=?
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        reason,
        item.id());
  }

  private void digest(
      UUID recipient,
      String kind,
      String title,
      String message,
      String targetPath,
      OffsetDateTime windowEnd,
      OffsetDateTime sendAt) {
    jdbc.update(
        """
            INSERT INTO notification_push_digests
                (recipient_user_id, kind, title, message, target_path, window_end, send_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (recipient_user_id, window_end, kind) DO NOTHING
            """,
        recipient,
        kind,
        title,
        message,
        targetPath,
        windowEnd,
        sendAt);
  }

  // ---- Grouped wording -------------------------------------------------------------------------

  /** "Take out organic is overdue · Dishes due by 6 PM", or "…, plus 2 more chores today". */
  String choresMessage(List<Held> chores) {
    List<String> phrases = chores.stream().map(this::chorePhrase).toList();
    if (phrases.size() <= 2) {
      return String.join(" · ", phrases);
    }
    return phrases.getFirst() + ", plus " + (phrases.size() - 1) + " more chores today";
  }

  private String chorePhrase(Held item) {
    Map<String, Object> chore =
        item.referenceId() == null
            ? Map.of()
            : jdbc
                .queryForList(
                    """
                        SELECT a.title_snapshot, a.due_at, h.timezone FROM chore_assignments a
                        JOIN households h ON h.id=a.household_id WHERE a.id=?
                        """,
                    item.referenceId())
                .stream()
                .findFirst()
                .orElse(Map.of());
    String title =
        !chore.isEmpty()
            ? (String) chore.get("title_snapshot")
            : "CHORE_SCHEDULE".equals(item.referenceType()) && item.referenceId() != null
                ? jdbc
                    .queryForList(
                        """
                            SELECT c.title FROM chore_schedules s JOIN chores c ON c.id=s.chore_id
                            WHERE s.id=?
                            """,
                        String.class,
                        item.referenceId())
                    .stream()
                    .findFirst()
                    .orElse(item.title())
                : item.title();
    return switch (item.type()) {
      case "CHORE_OVERDUE" -> title + " is overdue";
      case "CHORE_DUE_NOW" -> title + " is due now";
      case "CHORE_NEEDS_DOING" -> title + " needs doing";
      case "CHORE_DUE_SOON" -> {
        String by = dueTime(chore);
        yield by == null ? title + " is due soon" : title + " due by " + by;
      }
      default -> title + " assigned to you";
    };
  }

  private static String dueTime(Map<String, Object> chore) {
    Object due = chore.get("due_at");
    if (due == null) {
      return null;
    }
    OffsetDateTime at =
        due instanceof java.sql.Timestamp timestamp
            ? timestamp.toInstant().atOffset(java.time.ZoneOffset.UTC)
            : (OffsetDateTime) due;
    String zone = (String) chore.get("timezone");
    return clock(at.atZoneSameInstant(ZoneId.of(zone == null ? "UTC" : zone)).toLocalTime());
  }

  /** "6 PM", "6:30 PM". */
  static String clock(LocalTime time) {
    String hour = (time.getHour() % 12 == 0 ? 12 : time.getHour() % 12) + "";
    String minutes = time.getMinute() == 0 ? "" : String.format(":%02d", time.getMinute());
    return hour + minutes + (time.getHour() < 12 ? " AM" : " PM");
  }

  /**
   * "Pest control Thu 10 AM · Package for you · Shopping: Milk needed today"; more than three name
   * two and add "+N more on the Board".
   */
  String othersMessage(List<Held> others, boolean board) {
    List<String> phrases = others.stream().map(this::otherPhrase).toList();
    if (phrases.size() <= 3) {
      return String.join(" · ", phrases);
    }
    return String.join(" · ", phrases.subList(0, 2))
        + ", +"
        + (phrases.size() - 2)
        + " more"
        + (board ? " on the Board" : "");
  }

  private String otherPhrase(Held item) {
    if ("BOARD_POST".equals(item.referenceType()) && item.referenceId() != null) {
      List<Map<String, Object>> posts =
          jdbc.queryForList(
              "SELECT title, type, event_date, start_time FROM board_posts WHERE id=?",
              item.referenceId());
      if (!posts.isEmpty()) {
        Map<String, Object> post = posts.getFirst();
        String title = (String) post.get("title");
        if ("EVENT".equals(post.get("type")) && post.get("event_date") != null) {
          LocalDate day = ((java.sql.Date) post.get("event_date")).toLocalDate();
          Object start = post.get("start_time");
          String when =
              WEEKDAY.format(day)
                  + (start == null ? "" : " " + clock(((java.sql.Time) start).toLocalTime()));
          return title + " " + when;
        }
        return title;
      }
    }
    if ("BOARD_LIST".equals(item.referenceType()) && item.referenceId() != null) {
      List<String> names = neededToday(item);
      String list =
          jdbc
              .queryForList(
                  "SELECT name FROM board_lists WHERE id=?", String.class, item.referenceId())
              .stream()
              .findFirst()
              .orElse("List");
      String what =
          names.size() <= 2
              ? String.join(", ", names)
              : String.join(", ", names.subList(0, 2)) + " +" + (names.size() - 2);
      return list + ": " + what + " needed today";
    }
    return item.title();
  }

  record Held(
      UUID id,
      UUID recipientId,
      String type,
      String title,
      String referenceType,
      UUID referenceId,
      String status,
      OffsetDateTime expiresAt,
      OffsetDateTime createdAt,
      OffsetDateTime heldUntil) {}

  private record Ranked(Held item, int importance) {}

  private record Digest(
      UUID id,
      OffsetDateTime sendAt,
      UUID recipientId,
      String title,
      String message,
      String targetPath) {}
}
