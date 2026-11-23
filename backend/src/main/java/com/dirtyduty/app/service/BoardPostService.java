package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.board.BoardMemberResponse;
import com.dirtyduty.app.dto.board.BoardPostRequest;
import com.dirtyduty.app.dto.board.BoardPostResponse;
import com.dirtyduty.app.dto.board.BoardReaderResponse;
import com.dirtyduty.app.dto.board.BoardResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.DefaultNotificationGenerator;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.repository.UserRepository;
import java.sql.Array;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Household Board: posts the whole house needs to know or act on that aren't chores.
 *
 * <p>Lifecycle. A post is active while {@code past_at} is null. Events become Past when their date
 * has ended in the household's time zone, heads-ups after 7 days, problems when marked fixed; a
 * pinned post never does, and unpinning one that would already be Past moves it there at that
 * moment. {@code past_at} is set lazily whenever the household's board is read, and by {@link
 * #runRetention()} from the nightly retention job, which also hard-deletes posts that have been
 * Past for 30 days.
 *
 * <p>Lock order matches the rest of the app: the household row first (FOR UPDATE for writes, FOR
 * SHARE for reads so they still wait for a member exit), then post rows, then notification rows.
 */
@Service
public class BoardPostService {
  static final Duration REMIND_REPEAT_WINDOW = Duration.ofHours(2);
  static final Duration URGENT_WINDOW = Duration.ofHours(1);
  static final Duration HEADS_UP_LIFETIME = Duration.ofDays(7);
  static final Duration PAST_RETENTION = Duration.ofDays(30);
  static final LocalTime EVENING_REMINDER = LocalTime.of(19, 0);
  static final LocalTime MORNING_REMINDER = LocalTime.of(8, 0);
  static final int MAX_TITLE_LENGTH = 120;
  static final int MAX_DETAILS_LENGTH = 2000;
  static final int MAX_SEEN_BATCH = 100;
  static final String FORMER_MEMBER = "Former member";
  static final String REFERENCE_TYPE = "BOARD_POST";
  static final String CATEGORY = "BOARD";

  private static final DateTimeFormatter DAY_FORMAT =
      DateTimeFormatter.ofPattern("EEE, MMM d", Locale.ENGLISH);
  private static final DateTimeFormatter TIME_FORMAT =
      DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH);
  private static final DateTimeFormatter HOUR_FORMAT =
      DateTimeFormatter.ofPattern("h a", Locale.ENGLISH);

  /** The post columns every read selects, aliased on {@code p}. */
  private static final String POST_COLUMNS =
      """
      p.id, p.household_id, p.author_user_id, p.type, p.title, p.details, p.event_date,
      p.start_time, p.end_time, p.pinned, p.notify_mode, p.handler_user_id, p.fixed_at,
      p.fixed_by_user_id, p.last_reminded_at, p.past_at, p.edited_at, p.created_at, p.urgent
      """;

  /** Active, unpinned posts whose time is up (household {@code h} joined on {@code p}). */
  private static final String EXPIRED_PREDICATE =
      """
      p.past_at IS NULL AND NOT p.pinned AND (
          (p.type='EVENT' AND ((p.event_date + 1)::timestamp AT TIME ZONE h.timezone) <= ?)
          OR (p.type='HEADS_UP' AND p.created_at + INTERVAL '7 days' <= ?)
          OR (p.type='PROBLEM' AND p.fixed_at IS NOT NULL)
      )
      """;

  private final JdbcTemplate jdbc;
  private final UserRepository userRepository;
  private final MembershipExitCleanupService membershipLocks;
  private final NotificationEventService notificationEventService;
  private final BoardListService boardListService;
  private Clock clock = Clock.systemUTC();

  public BoardPostService(
      JdbcTemplate jdbc,
      UserRepository userRepository,
      MembershipExitCleanupService membershipLocks,
      NotificationEventService notificationEventService,
      BoardListService boardListService) {
    this.jdbc = jdbc;
    this.userRepository = userRepository;
    this.membershipLocks = membershipLocks;
    this.notificationEventService = notificationEventService;
    this.boardListService = boardListService;
  }

  /** Tests pin the clock; {@code null} restores the system clock. */
  void useClock(Clock testClock) {
    this.clock = testClock == null ? Clock.systemUTC() : testClock;
  }

  private OffsetDateTime now() {
    return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
  }

  // ---- Reads -----------------------------------------------------------------------------------

  @Transactional
  public BoardResponse board(UUID householdId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    expire(householdId);
    List<PostRow> rows =
        jdbc.query(
            "SELECT "
                + POST_COLUMNS
                + " FROM board_posts p WHERE p.household_id=? AND p.past_at IS NULL"
                + " ORDER BY p.created_at DESC, p.id",
            this::postRow,
            householdId);
    Integer pastCount =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM board_posts WHERE household_id=? AND past_at IS NOT NULL",
            Integer.class,
            householdId);
    List<BoardPostResponse> posts = responses(rows, actor);
    int unseen = (int) posts.stream().filter(post -> !post.viewer().seen()).count();
    return new BoardResponse(
        posts,
        pastCount == null ? 0 : pastCount,
        unseen,
        actor.admin(),
        actor.members().values().stream()
            .map(member -> new BoardMemberResponse(member.userId(), member.name(), member.role()))
            .toList(),
        boardListService.toBuyCount(householdId),
        boardListService.shoppingSummary(householdId, actor.zone()));
  }

  /** Past posts, most recently Past first. */
  @Transactional
  public List<BoardPostResponse> past(UUID householdId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    expire(householdId);
    List<PostRow> rows =
        jdbc.query(
            "SELECT "
                + POST_COLUMNS
                + " FROM board_posts p WHERE p.household_id=? AND p.past_at IS NOT NULL"
                + " ORDER BY p.past_at DESC, p.id",
            this::postRow,
            householdId);
    return responses(rows, actor);
  }

  /** Active posts the viewer has not seen yet (the author counts as having seen their own). */
  @Transactional
  public int unseenCount(UUID householdId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    expire(householdId);
    Integer count =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM board_posts p
                WHERE p.household_id=? AND p.past_at IS NULL
                  AND p.author_user_id IS DISTINCT FROM ?
                  AND NOT EXISTS (
                      SELECT 1 FROM board_post_reads r WHERE r.post_id=p.id AND r.user_id=?
                  )
                """,
            Integer.class,
            householdId,
            actor.userId(),
            actor.userId());
    return count == null ? 0 : count;
  }

  @Transactional
  public BoardPostResponse get(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    expire(householdId);
    return response(requirePost(householdId, postId, false), actor);
  }

  // ---- Create, edit, delete --------------------------------------------------------------------

  @Transactional
  public BoardPostResponse create(
      UUID householdId, BoardPostRequest request, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    Draft draft = validate(request, actor, null);
    UUID postId = UUID.randomUUID();
    OffsetDateTime now = now();
    boolean urgent = request != null && Boolean.TRUE.equals(request.urgent());
    if (urgent) {
      requireUrgentAllowance(actor, now);
    }
    jdbc.update(
        """
            INSERT INTO board_posts
                (id, household_id, author_user_id, type, title, details, event_date, start_time,
                 end_time, pinned, notify_mode, created_at, updated_at, urgent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
        postId,
        householdId,
        actor.userId(),
        draft.type(),
        draft.title(),
        draft.details(),
        draft.eventDate(),
        draft.startTime(),
        draft.endTime(),
        draft.pinned(),
        draft.notifyMode(),
        now,
        now,
        urgent);
    replaceRecipients(postId, draft.recipients());
    PostRow post = requirePost(householdId, postId, false);
    for (UUID recipient : notifyRecipients(post, actor.members().keySet(), Set.of())) {
      publish(
          "BOARD_POST_NEW",
          actor.userId(),
          post,
          recipient,
          Map.of("post_when", whenSuffix(post)),
          null);
    }
    planEventReminders(post, actor);
    return response(post, actor);
  }

  @Transactional
  public BoardPostResponse update(
      UUID householdId, UUID postId, BoardPostRequest request, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    expire(householdId);
    PostRow before = requirePost(householdId, postId, true);
    requireAuthorOrAdmin(before, actor, "edit");
    requireActive(before, "edited");
    Draft draft = validate(request, actor, before);
    boolean wasEvent = "EVENT".equals(before.type());
    boolean isEvent = "EVENT".equals(draft.type());
    boolean whenChanged =
        wasEvent
            && isEvent
            && (!before.eventDate().equals(draft.eventDate())
                || !java.util.Objects.equals(before.startTime(), draft.startTime())
                || !java.util.Objects.equals(before.endTime(), draft.endTime()));
    boolean problem = "PROBLEM".equals(draft.type());
    OffsetDateTime now = now();
    jdbc.update(
        """
            UPDATE board_posts
            SET type=?, title=?, details=?, event_date=?, start_time=?, end_time=?, pinned=?,
                notify_mode=?,
                handler_user_id=CASE WHEN ? THEN handler_user_id END,
                fixed_at=CASE WHEN ? THEN fixed_at END,
                fixed_by_user_id=CASE WHEN ? THEN fixed_by_user_id END,
                edited_at=?, updated_at=?
            WHERE id=?
            """,
        draft.type(),
        draft.title(),
        draft.details(),
        draft.eventDate(),
        draft.startTime(),
        draft.endTime(),
        draft.pinned(),
        draft.notifyMode(),
        problem,
        problem,
        problem,
        now,
        now,
        postId);
    replaceRecipients(postId, draft.recipients());
    if (before.pinned() && !draft.pinned()) {
      // Unpinned after its time was up: it becomes Past now, so retention counts from today.
      jdbc.update(
          "UPDATE board_posts p SET past_at=?, updated_at=? FROM households h"
              + " WHERE h.id=p.household_id AND p.id=? AND "
              + EXPIRED_PREDICATE,
          now,
          now,
          postId,
          now,
          now);
    }
    PostRow after = requirePost(householdId, postId, false);
    if (whenChanged) {
      // Everyone confirms the new date again, and the people notified hear that it moved.
      jdbc.update("UPDATE board_post_reads SET got_it_at=NULL WHERE post_id=?", postId);
      for (UUID recipient :
          notifyRecipients(after, actor.members().keySet(), Set.of(actor.userId()))) {
        publish(
            "BOARD_POST_CHANGED",
            actor.userId(),
            after,
            recipient,
            Map.of("post_when_long", whenLong(after)),
            null);
      }
    }
    cancelPendingNotifications(postId, List.of("BOARD_EVENT_REMINDER"));
    planEventReminders(after, actor);
    return response(after, actor);
  }

  @Transactional
  public void delete(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    PostRow post = requirePost(householdId, postId, true);
    requireAuthorOrAdmin(post, actor, "delete");
    cancelPendingNotifications(postId, null);
    jdbc.update("DELETE FROM board_posts WHERE id=?", postId);
  }

  // ---- Seen and Got it -------------------------------------------------------------------------

  /**
   * Records that the viewer saw these posts. Idempotent: ids already seen, the viewer's own posts
   * and ids from other households are ignored.
   */
  @Transactional
  public void seen(UUID householdId, List<UUID> postIds, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    List<UUID> ids = postIds == null ? List.of() : postIds.stream().distinct().toList();
    if (ids.isEmpty()) {
      return;
    }
    if (ids.size() > MAX_SEEN_BATCH) {
      throw new InvalidHouseholdException("Send at most " + MAX_SEEN_BATCH + " posts at a time.");
    }
    jdbc.update(
        """
            INSERT INTO board_post_reads (post_id, user_id, seen_at)
            SELECT p.id, ?, ? FROM board_posts p
            WHERE p.household_id=? AND p.id = ANY(?)
              AND p.author_user_id IS DISTINCT FROM ?
            ON CONFLICT (post_id, user_id) DO NOTHING
            """,
        ps -> {
          ps.setObject(1, actor.userId());
          ps.setObject(2, now());
          ps.setObject(3, householdId);
          ps.setArray(4, uuidArray(ps.getConnection(), ids));
          ps.setObject(5, actor.userId());
        });
  }

  @Transactional
  public BoardPostResponse gotIt(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    expire(householdId);
    PostRow post = requirePost(householdId, postId, true);
    requireActive(post, "confirmed");
    if (!actor.userId().equals(post.authorUserId())) {
      OffsetDateTime now = now();
      jdbc.update(
          """
              INSERT INTO board_post_reads (post_id, user_id, seen_at, got_it_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (post_id, user_id)
              DO UPDATE SET got_it_at=COALESCE(board_post_reads.got_it_at, EXCLUDED.got_it_at)
              """,
          postId,
          actor.userId(),
          now,
          now);
    }
    return response(post, actor);
  }

  // ---- Problems --------------------------------------------------------------------------------

  /** "I'll handle it": one handler at a time. */
  @Transactional
  public BoardPostResponse handle(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    expire(householdId);
    PostRow post = requireOpenProblem(householdId, postId);
    if (post.handlerUserId() != null && !post.handlerUserId().equals(actor.userId())) {
      Member handler = actor.members().get(post.handlerUserId());
      throw new DuplicateResourceException(
          (handler == null ? "Someone" : handler.name()) + " is already handling it.");
    }
    jdbc.update(
        "UPDATE board_posts SET handler_user_id=?, updated_at=? WHERE id=?",
        actor.userId(),
        now(),
        postId);
    return response(requirePost(householdId, postId, false), actor);
  }

  /** Any member may release the handler, so a problem never stays stuck with someone. */
  @Transactional
  public BoardPostResponse release(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    expire(householdId);
    requireOpenProblem(householdId, postId);
    jdbc.update(
        "UPDATE board_posts SET handler_user_id=NULL, updated_at=? WHERE id=?", now(), postId);
    return response(requirePost(householdId, postId, false), actor);
  }

  @Transactional
  public BoardPostResponse fix(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    expire(householdId);
    PostRow post = requirePost(householdId, postId, true);
    if (!"PROBLEM".equals(post.type())) {
      throw new InvalidHouseholdException("Only a problem can be marked fixed.");
    }
    if (post.fixedAt() != null) {
      Member fixer =
          post.fixedByUserId() == null ? null : actor.members().get(post.fixedByUserId());
      throw new DuplicateResourceException(
          "Already fixed by " + (fixer == null ? FORMER_MEMBER : fixer.name()) + ".");
    }
    OffsetDateTime now = now();
    jdbc.update(
        """
            UPDATE board_posts
            SET fixed_at=?, fixed_by_user_id=?, past_at=CASE WHEN pinned THEN NULL ELSE ? END,
                updated_at=?
            WHERE id=?
            """,
        now,
        actor.userId(),
        now,
        now,
        postId);
    return response(requirePost(householdId, postId, false), actor);
  }

  // ---- Remind ----------------------------------------------------------------------------------

  /**
   * One push to everyone the post is for who hasn't seen it yet: the picked people for a PICKED
   * post, every active member otherwise, never the author. The author or an owner/admin may send
   * it, at most once per post every 2 hours.
   */
  @Transactional
  public BoardPostResponse remind(UUID householdId, UUID postId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    expire(householdId);
    PostRow post = requirePost(householdId, postId, true);
    if (!actor.userId().equals(post.authorUserId()) && !actor.admin()) {
      throw new HouseholdAccessDeniedException(
          "Only the person who posted it or an owner or admin can send a reminder.");
    }
    requireActive(post, "reminded about");
    OffsetDateTime now = now();
    if (post.lastRemindedAt() != null
        && post.lastRemindedAt().isAfter(now.minus(REMIND_REPEAT_WINDOW))) {
      throw new DuplicateResourceException(
          "Already reminded at "
              + TIME_FORMAT.format(post.lastRemindedAt().atZoneSameInstant(actor.zone()))
              + ".");
    }
    Set<UUID> seen =
        new LinkedHashSet<>(
            jdbc.query(
                "SELECT user_id FROM board_post_reads WHERE post_id=?",
                (rs, row) -> rs.getObject("user_id", UUID.class),
                postId));
    // A PICKED post reminds only the picked people; EVERYONE and NONE remind every active member.
    Collection<UUID> audience =
        "PICKED".equals(post.notifyMode()) ? recipientsOf(postId) : actor.members().keySet();
    List<UUID> unseen =
        audience.stream()
            .filter(actor.members()::containsKey)
            .filter(userId -> !userId.equals(post.authorUserId()) && !seen.contains(userId))
            .toList();
    if (unseen.isEmpty()) {
      throw new InvalidHouseholdException("Everyone has seen this post.");
    }
    jdbc.update(
        "UPDATE board_posts SET last_reminded_at=?, updated_at=? WHERE id=?", now, now, postId);
    for (UUID recipient : unseen) {
      publish("BOARD_POST_REMIND", actor.userId(), post, recipient, Map.of(), null);
    }
    return response(requirePost(householdId, postId, false), actor);
  }

  // ---- Retention -------------------------------------------------------------------------------

  /**
   * Nightly: moves posts whose time is up to Past and hard-deletes posts that have been Past for 30
   * days. Runs inside the existing notification retention job's transaction; households are locked
   * in id order first, like every other household writer.
   */
  @Transactional
  public int runRetention() {
    OffsetDateTime now = now();
    OffsetDateTime purgeBefore = now.minus(PAST_RETENTION);
    List<UUID> householdIds =
        jdbc.query(
            "SELECT DISTINCT p.household_id FROM board_posts p JOIN households h"
                + " ON h.id=p.household_id WHERE ("
                + EXPIRED_PREDICATE
                + ") OR p.past_at < ? ORDER BY p.household_id",
            (rs, row) -> rs.getObject("household_id", UUID.class),
            now,
            now,
            purgeBefore);
    int purged = 0;
    for (UUID householdId : membershipLocks.lockExistingHouseholds(householdIds)) {
      expire(householdId);
      purged +=
          jdbc.update(
              "DELETE FROM board_posts WHERE household_id=? AND past_at < ?",
              householdId,
              purgeBefore);
    }
    return purged;
  }

  /** Sets {@code past_at} on this household's posts whose time is up. */
  private void expire(UUID householdId) {
    OffsetDateTime now = now();
    // Rows are locked in id order and skipped when another reader is already expiring them, so two
    // concurrent board reads never deadlock on each other.
    List<UUID> due =
        jdbc.query(
            "SELECT p.id FROM board_posts p JOIN households h ON h.id=p.household_id"
                + " WHERE p.household_id=? AND "
                + EXPIRED_PREDICATE
                + " ORDER BY p.id FOR UPDATE OF p SKIP LOCKED",
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId,
            now,
            now);
    if (due.isEmpty()) {
      return;
    }
    jdbc.update(
        """
            UPDATE board_posts p
            SET past_at = CASE p.type
                    WHEN 'EVENT' THEN (p.event_date + 1)::timestamp AT TIME ZONE h.timezone
                    WHEN 'HEADS_UP' THEN p.created_at + INTERVAL '7 days'
                    ELSE p.fixed_at
                END,
                updated_at = ?
            FROM households h
            WHERE h.id=p.household_id AND p.id = ANY(?) AND p.past_at IS NULL AND NOT p.pinned
            """,
        ps -> {
          ps.setObject(1, now);
          ps.setArray(2, uuidArray(ps.getConnection(), due));
        });
  }

  // ---- Notifications ---------------------------------------------------------------------------

  /**
   * Who hears about a post: nobody for NONE, the picked people for PICKED, everyone otherwise;
   * always current members only, and never the author (or anyone in {@code exclude}).
   */
  private List<UUID> notifyRecipients(PostRow post, Set<UUID> activeMembers, Set<UUID> exclude) {
    Collection<UUID> candidates =
        switch (post.notifyMode()) {
          case "NONE" -> List.of();
          case "PICKED" -> recipientsOf(post.id());
          default -> activeMembers;
        };
    return candidates.stream()
        .filter(activeMembers::contains)
        .filter(userId -> !userId.equals(post.authorUserId()))
        .filter(userId -> !exclude.contains(userId))
        .distinct()
        .toList();
  }

  /**
   * The evening-before (7 PM) and morning-of (8 AM) reminders in the household's time zone, for an
   * active event that notifies anyone. Slots already passed are skipped; pending reminders were
   * cancelled by the caller, and a new deduplication revision keeps re-planned rows unique.
   */
  private void planEventReminders(PostRow post, Actor actor) {
    if (!"EVENT".equals(post.type()) || post.pastAt() != null) {
      return;
    }
    List<UUID> recipients = notifyRecipients(post, actor.members().keySet(), Set.of());
    if (recipients.isEmpty()) {
      return;
    }
    OffsetDateTime now = now();
    LocalDate day = post.eventDate();
    // The evening before, then the morning of the event.
    OffsetDateTime[] slots = {
      day.minusDays(1).atTime(EVENING_REMINDER).atZone(actor.zone()).toOffsetDateTime(),
      day.atTime(MORNING_REMINDER).atZone(actor.zone()).toOffsetDateTime()
    };
    String at = post.startTime() == null ? "" : " at " + clockTime(post.startTime());
    for (int index = 0; index < slots.length; index++) {
      if (!slots[index].isAfter(now)) {
        continue;
      }
      String when = (index == 0 ? "tomorrow" : "today") + at;
      for (UUID recipient : recipients) {
        publish(
            "BOARD_EVENT_REMINDER",
            null,
            post,
            recipient,
            Map.of("reminder_when", when),
            slots[index].withOffsetSameInstant(ZoneOffset.UTC));
      }
    }
  }

  /**
   * Publishes one notification. Every row after the first for the same type, post and recipient
   * gets a new deduplication revision, so a moved date, a second reminder or a re-planned slot is
   * never swallowed by an earlier (possibly cancelled) row.
   */
  private void publish(
      String type,
      UUID actorId,
      PostRow post,
      UUID recipient,
      Map<String, String> extra,
      OffsetDateTime scheduledAt) {
    Integer earlier =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM notifications
                WHERE reference_type=? AND reference_id=? AND recipient_user_id=? AND type=?
                """,
            Integer.class,
            REFERENCE_TYPE,
            post.id(),
            recipient,
            type);
    Map<String, String> variables = new HashMap<>(extra);
    variables.put("post_title", post.title());
    if (scheduledAt != null) {
      variables.put("scheduled_at", scheduledAt.toString());
    }
    if (earlier != null && earlier > 0) {
      variables.put(DefaultNotificationGenerator.DEDUPLICATION_REVISION, "r" + (earlier + 1));
    }
    notificationEventService.publish(
        new NotificationEvent(
            type,
            actorId,
            post.householdId(),
            REFERENCE_TYPE,
            post.id(),
            CATEGORY,
            Map.copyOf(variables),
            List.of(recipient)));
  }

  /** Cancels this post's pending notifications of the given types (all types when null). */
  private void cancelPendingNotifications(UUID postId, List<String> types) {
    String typeFilter =
        types == null
            ? ""
            : " AND n.type IN (" + String.join(",", types.stream().map(t -> "?").toList()) + ")";
    List<Object> args = new ArrayList<>();
    args.add(REFERENCE_TYPE);
    args.add(postId);
    if (types != null) {
      args.addAll(types);
    }
    jdbc.update(
        "UPDATE notifications n SET status='CANCELLED' WHERE n.reference_type=?"
            + " AND n.reference_id=? AND n.status='PENDING'"
            + typeFilter,
        args.toArray());
    jdbc.update(
        "UPDATE notification_deliveries d SET status='CANCELLED' FROM notifications n"
            + " WHERE d.notification_id=n.id AND n.reference_type=? AND n.reference_id=?"
            + " AND n.status='CANCELLED' AND d.status IN ('PENDING','FAILED')"
            + typeFilter,
        args.toArray());
    jdbc.update(
        "UPDATE notification_push_delivery_targets t"
            + " SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()"
            + " FROM notifications n WHERE t.notification_id=n.id AND n.reference_type=?"
            + " AND n.reference_id=? AND n.status='CANCELLED' AND t.status IN ('PENDING','FAILED')"
            + typeFilter,
        args.toArray());
  }

  /** " · Thu, Nov 27, 10 AM–12 PM" for events, "" otherwise. */
  private static String whenSuffix(PostRow post) {
    return "EVENT".equals(post.type()) ? " · " + whenLong(post) : "";
  }

  /** "Fri, Nov 28", "Fri, Nov 28, 10 AM" or "Fri, Nov 28, 10 AM–12 PM". */
  static String whenLong(PostRow post) {
    String day = DAY_FORMAT.format(post.eventDate());
    if (post.startTime() == null) {
      return day;
    }
    String time = clockTime(post.startTime());
    if (post.endTime() != null) {
      time += "–" + clockTime(post.endTime());
    }
    return day + ", " + time;
  }

  /** "10 AM" on the hour, "10:30 AM" otherwise. */
  static String clockTime(LocalTime time) {
    return (time.getMinute() == 0 ? HOUR_FORMAT : TIME_FORMAT).format(time);
  }

  // ---- Validation ------------------------------------------------------------------------------

  private Draft validate(BoardPostRequest request, Actor actor, PostRow before) {
    if (request == null) {
      throw new InvalidHouseholdException("Enter what's happening.");
    }
    String title = request.title() == null ? "" : request.title().strip();
    if (title.isEmpty()) {
      throw new InvalidHouseholdException("Enter what's happening.");
    }
    if (title.length() > MAX_TITLE_LENGTH) {
      throw new InvalidHouseholdException("Keep it to 120 characters.");
    }
    String details = request.details() == null ? null : request.details().strip();
    if (details != null && details.isEmpty()) {
      details = null;
    }
    if (details != null && details.length() > MAX_DETAILS_LENGTH) {
      throw new InvalidHouseholdException("Details can be at most 2000 characters.");
    }
    String type = request.type() == null || request.type().isBlank() ? "HEADS_UP" : request.type();
    if (!Set.of("EVENT", "PROBLEM", "HEADS_UP").contains(type)) {
      throw new InvalidHouseholdException("Choose Event, Problem or Heads-up.");
    }
    LocalDate eventDate = null;
    LocalTime startTime = null;
    LocalTime endTime = null;
    if ("EVENT".equals(type)) {
      eventDate = request.eventDate();
      startTime = request.startTime();
      endTime = request.endTime();
      if (eventDate == null) {
        throw new InvalidHouseholdException("Choose a date for this event.");
      }
      boolean unchangedDate = before != null && eventDate.equals(before.eventDate());
      if (!unchangedDate && eventDate.isBefore(LocalDate.now(clock.withZone(actor.zone())))) {
        throw new InvalidHouseholdException("Choose today or a later date.");
      }
      if (endTime != null && startTime == null) {
        throw new InvalidHouseholdException("Add a start time first.");
      }
      if (endTime != null && !endTime.isAfter(startTime)) {
        throw new InvalidHouseholdException("The end time must be after the start time.");
      }
    }
    boolean pinned =
        request.pinned() == null ? before != null && before.pinned() : request.pinned();
    boolean wasPinned = before != null && before.pinned();
    if (pinned != wasPinned && !actor.admin()) {
      throw new HouseholdAccessDeniedException("Only owners and admins can pin posts.");
    }
    String notifyMode =
        request.notifyMode() == null || request.notifyMode().isBlank()
            ? "EVERYONE"
            : request.notifyMode();
    if (!Set.of("EVERYONE", "PICKED", "NONE").contains(notifyMode)) {
      throw new InvalidHouseholdException("Choose who gets a notification.");
    }
    List<UUID> recipients = List.of();
    if ("PICKED".equals(notifyMode)) {
      UUID authorId = before == null ? actor.userId() : before.authorUserId();
      List<UUID> picked =
          request.recipientUserIds() == null
              ? List.of()
              : request.recipientUserIds().stream()
                  .distinct()
                  .filter(userId -> !userId.equals(authorId))
                  .toList();
      if (picked.isEmpty()) {
        throw new InvalidHouseholdException("Pick at least one person to notify.");
      }
      if (!actor.members().keySet().containsAll(picked)) {
        throw new InvalidHouseholdException(
            "Everyone you pick must be a current household member.");
      }
      recipients = picked;
    }
    return new Draft(
        type, title, details, eventDate, startTime, endTime, pinned, notifyMode, recipients);
  }

  private void replaceRecipients(UUID postId, List<UUID> recipients) {
    jdbc.update("DELETE FROM board_post_recipients WHERE post_id=?", postId);
    for (UUID userId : recipients) {
      jdbc.update(
          "INSERT INTO board_post_recipients (post_id, user_id) VALUES (?, ?)", postId, userId);
    }
  }

  private List<UUID> recipientsOf(UUID postId) {
    return jdbc.query(
        "SELECT user_id FROM board_post_recipients WHERE post_id=? ORDER BY user_id",
        (rs, row) -> rs.getObject("user_id", UUID.class),
        postId);
  }

  /**
   * One urgent post per member per hour (across households): "You can post one urgent post an hour.
   * Try again at 3:40 PM."
   */
  private void requireUrgentAllowance(Actor actor, OffsetDateTime now) {
    List<OffsetDateTime> recent =
        jdbc.query(
            """
                SELECT created_at FROM board_posts
                WHERE author_user_id=? AND urgent AND created_at > ?
                ORDER BY created_at LIMIT 1
                """,
            (rs, row) -> rs.getObject("created_at", OffsetDateTime.class),
            actor.userId(),
            now.minus(URGENT_WINDOW));
    if (!recent.isEmpty()) {
      OffsetDateTime again = recent.getFirst().plus(URGENT_WINDOW);
      throw new DuplicateResourceException(
          "You can post one urgent post an hour. Try again at "
              + TIME_FORMAT.format(again.atZoneSameInstant(actor.zone()))
              + ".");
    }
  }

  // ---- Access ----------------------------------------------------------------------------------

  /** Writers take the household row FOR UPDATE, like every other household mutation. */
  private Actor writeActor(UUID householdId, Authentication authentication) {
    User user = requireUser(authentication);
    if (!membershipLocks.tryLockHousehold(householdId)) {
      throw new ResourceNotFoundException("Household was not found.");
    }
    return actor(householdId, user);
  }

  /** Readers take it FOR SHARE: they don't block each other but wait for a member exit. */
  private Actor readActor(UUID householdId, Authentication authentication) {
    User user = requireUser(authentication);
    List<UUID> locked =
        jdbc.query(
            "SELECT id FROM households WHERE id=? FOR SHARE",
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId);
    if (locked.isEmpty()) {
      throw new ResourceNotFoundException("Household was not found.");
    }
    return actor(householdId, user);
  }

  private User requireUser(Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new HouseholdAccessDeniedException("You are not authorized to view this board.");
    }
    return userRepository
        .findByEmailIgnoreCase(authentication.getName())
        .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
        .orElseThrow(
            () -> new HouseholdAccessDeniedException("You are not authorized to view this board."));
  }

  /** Non-members get 404, so a board's existence isn't revealed. */
  private Actor actor(UUID householdId, User user) {
    Map<UUID, Member> members = new LinkedHashMap<>();
    jdbc.query(
        """
            SELECT m.user_id, u.display_name, m.role
            FROM household_memberships m JOIN users u ON u.id=m.user_id
            WHERE m.household_id=? AND m.status='ACTIVE'
            ORDER BY m.joined_at, m.user_id
            """,
        rs -> {
          UUID userId = rs.getObject("user_id", UUID.class);
          members.put(
              userId, new Member(userId, rs.getString("display_name"), rs.getString("role")));
        },
        householdId);
    Member self = members.get(user.getId());
    if (self == null) {
      throw new ResourceNotFoundException("Household was not found.");
    }
    String timezone =
        jdbc.queryForObject(
            "SELECT timezone FROM households WHERE id=?", String.class, householdId);
    return new Actor(
        user.getId(),
        "OWNER".equals(self.role()) || "ADMIN".equals(self.role()),
        ZoneId.of(timezone == null ? "UTC" : timezone),
        members);
  }

  private PostRow requirePost(UUID householdId, UUID postId, boolean forUpdate) {
    List<PostRow> rows =
        jdbc.query(
            "SELECT "
                + POST_COLUMNS
                + " FROM board_posts p WHERE p.id=? AND p.household_id=?"
                + (forUpdate ? " FOR UPDATE" : ""),
            this::postRow,
            postId,
            householdId);
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException("This post is no longer on the board.");
    }
    return rows.getFirst();
  }

  private PostRow requireOpenProblem(UUID householdId, UUID postId) {
    PostRow post = requirePost(householdId, postId, true);
    if (!"PROBLEM".equals(post.type())) {
      throw new InvalidHouseholdException("Only a problem can be handled.");
    }
    if (post.fixedAt() != null) {
      throw new InvalidHouseholdException("This problem is already fixed.");
    }
    return post;
  }

  private static void requireAuthorOrAdmin(PostRow post, Actor actor, String verb) {
    if (!actor.userId().equals(post.authorUserId()) && !actor.admin()) {
      throw new HouseholdAccessDeniedException(
          "Only the person who posted it or an owner or admin can " + verb + " this post.");
    }
  }

  private static void requireActive(PostRow post, String participle) {
    if (post.pastAt() != null) {
      throw new InvalidHouseholdException(
          "This post is in Past and can't be " + participle + " anymore.");
    }
  }

  // ---- Responses -------------------------------------------------------------------------------

  private BoardPostResponse response(PostRow post, Actor actor) {
    return responses(List.of(post), actor).getFirst();
  }

  private List<BoardPostResponse> responses(List<PostRow> posts, Actor actor) {
    if (posts.isEmpty()) {
      return List.of();
    }
    List<UUID> ids = posts.stream().map(PostRow::id).toList();
    Map<UUID, List<UUID>> recipients = new HashMap<>();
    jdbc.query(
        "SELECT post_id, user_id FROM board_post_recipients WHERE post_id = ANY(?)"
            + " ORDER BY user_id",
        ps -> ps.setArray(1, uuidArray(ps.getConnection(), ids)),
        rs -> {
          recipients
              .computeIfAbsent(rs.getObject("post_id", UUID.class), key -> new ArrayList<>())
              .add(rs.getObject("user_id", UUID.class));
        });
    Map<UUID, Map<UUID, Read>> reads = new HashMap<>();
    jdbc.query(
        "SELECT post_id, user_id, seen_at, got_it_at FROM board_post_reads WHERE post_id = ANY(?)",
        ps -> ps.setArray(1, uuidArray(ps.getConnection(), ids)),
        rs -> {
          reads
              .computeIfAbsent(rs.getObject("post_id", UUID.class), key -> new HashMap<>())
              .put(
                  rs.getObject("user_id", UUID.class),
                  new Read(
                      rs.getObject("seen_at", OffsetDateTime.class),
                      rs.getObject("got_it_at", OffsetDateTime.class)));
        });
    OffsetDateTime now = now();
    return posts.stream()
        .map(
            post ->
                toResponse(
                    post,
                    actor,
                    recipients.getOrDefault(post.id(), List.of()),
                    reads.getOrDefault(post.id(), Map.of()),
                    now))
        .toList();
  }

  private BoardPostResponse toResponse(
      PostRow post, Actor actor, List<UUID> recipients, Map<UUID, Read> reads, OffsetDateTime now) {
    Map<UUID, Member> members = actor.members();
    List<BoardReaderResponse> readers = new ArrayList<>();
    int seenCount = 0;
    int gotItCount = 0;
    for (Member member : members.values()) {
      boolean author = member.userId().equals(post.authorUserId());
      Read read = reads.get(member.userId());
      readers.add(
          new BoardReaderResponse(
              member.userId(),
              member.name(),
              author,
              read == null ? null : read.seenAt(),
              read == null ? null : read.gotItAt()));
      if (!author && read != null) {
        seenCount++;
        if (read.gotItAt() != null) {
          gotItCount++;
        }
      }
    }
    // Readers who are the author come first ("Posted"), then everyone else in join order.
    readers.sort(Comparator.comparing(reader -> !reader.author()));
    int audience =
        (int)
            members.keySet().stream().filter(userId -> !userId.equals(post.authorUserId())).count();
    boolean isAuthor = actor.userId().equals(post.authorUserId());
    Read own = reads.get(actor.userId());
    boolean active = post.pastAt() == null;
    boolean manage = isAuthor || actor.admin();
    OffsetDateTime remindAgainAt =
        post.lastRemindedAt() == null ? null : post.lastRemindedAt().plus(REMIND_REPEAT_WINDOW);
    if (remindAgainAt != null && !remindAgainAt.isAfter(now)) {
      remindAgainAt = null;
    }
    Member author = post.authorUserId() == null ? null : members.get(post.authorUserId());
    Member handler = post.handlerUserId() == null ? null : members.get(post.handlerUserId());
    Member fixer = post.fixedByUserId() == null ? null : members.get(post.fixedByUserId());
    return new BoardPostResponse(
        post.id(),
        post.type(),
        post.title(),
        post.details(),
        post.eventDate(),
        post.startTime(),
        post.endTime(),
        post.pinned(),
        post.urgent(),
        post.notifyMode(),
        "PICKED".equals(post.notifyMode()) ? List.copyOf(recipients) : List.of(),
        author == null ? null : author.userId(),
        author == null ? FORMER_MEMBER : author.name(),
        handler == null ? null : handler.userId(),
        handler == null ? null : handler.name(),
        post.fixedAt(),
        post.fixedAt() == null ? null : fixer == null ? FORMER_MEMBER : fixer.name(),
        post.pastAt(),
        post.editedAt(),
        post.createdAt(),
        seenCount,
        gotItCount,
        audience,
        List.copyOf(readers),
        new BoardPostResponse.Viewer(
            isAuthor,
            isAuthor || own != null,
            own != null && own.gotItAt() != null,
            "PICKED".equals(post.notifyMode()) && recipients.contains(actor.userId()),
            manage && active,
            manage,
            manage && active,
            post.lastRemindedAt(),
            remindAgainAt));
  }

  private PostRow postRow(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
    return new PostRow(
        rs.getObject("id", UUID.class),
        rs.getObject("household_id", UUID.class),
        rs.getObject("author_user_id", UUID.class),
        rs.getString("type"),
        rs.getString("title"),
        rs.getString("details"),
        rs.getObject("event_date", LocalDate.class),
        rs.getObject("start_time", LocalTime.class),
        rs.getObject("end_time", LocalTime.class),
        rs.getBoolean("pinned"),
        rs.getString("notify_mode"),
        rs.getObject("handler_user_id", UUID.class),
        rs.getObject("fixed_at", OffsetDateTime.class),
        rs.getObject("fixed_by_user_id", UUID.class),
        rs.getObject("last_reminded_at", OffsetDateTime.class),
        rs.getObject("past_at", OffsetDateTime.class),
        rs.getObject("edited_at", OffsetDateTime.class),
        rs.getObject("created_at", OffsetDateTime.class),
        rs.getBoolean("urgent"));
  }

  private static Array uuidArray(java.sql.Connection connection, List<UUID> ids)
      throws java.sql.SQLException {
    return connection.createArrayOf("uuid", ids.toArray());
  }

  record PostRow(
      UUID id,
      UUID householdId,
      UUID authorUserId,
      String type,
      String title,
      String details,
      LocalDate eventDate,
      LocalTime startTime,
      LocalTime endTime,
      boolean pinned,
      String notifyMode,
      UUID handlerUserId,
      OffsetDateTime fixedAt,
      UUID fixedByUserId,
      OffsetDateTime lastRemindedAt,
      OffsetDateTime pastAt,
      OffsetDateTime editedAt,
      OffsetDateTime createdAt,
      boolean urgent) {}

  private record Member(UUID userId, String name, String role) {}

  private record Actor(UUID userId, boolean admin, ZoneId zone, Map<UUID, Member> members) {}

  private record Read(OffsetDateTime seenAt, OffsetDateTime gotItAt) {}

  private record Draft(
      String type,
      String title,
      String details,
      LocalDate eventDate,
      LocalTime startTime,
      LocalTime endTime,
      boolean pinned,
      String notifyMode,
      List<UUID> recipients) {}
}
