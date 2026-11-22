package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.board.BoardListItemAddResponse;
import com.dirtyduty.app.dto.board.BoardListItemRequest;
import com.dirtyduty.app.dto.board.BoardListItemResponse;
import com.dirtyduty.app.dto.board.BoardListItemsResponse;
import com.dirtyduty.app.dto.board.BoardListRequest;
import com.dirtyduty.app.dto.board.BoardListResponse;
import com.dirtyduty.app.dto.board.BoardListsResponse;
import com.dirtyduty.app.dto.board.BoardShoppingSummary;
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
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Board's shared lists: a default "Shopping" list per household (created the first time Lists
 * is opened, never renamed or archived) and up to {@value #MAX_ACTIVE_LISTS} active lists in all.
 * Lists are fully shared like a paper list on the fridge: every active member can add, edit,
 * delete, claim, flag and buy any item. Non-members get 404.
 *
 * <p>"Need it today" is the only list action that notifies: one push to every other member, at most
 * one per list per {@link #TODAY_PUSH_WINDOW}. Flags set inside the window wait (in-app only) and
 * are carried by the next push. A flag is for one household day and stops counting when the day
 * ends; bought items show under "bought today" for the rest of that day. {@link #runRetention()}
 * clears stale flags and deletes items bought more than {@link #BOUGHT_RETENTION} ago.
 *
 * <p>Lock order: the household row (FOR UPDATE for writes, FOR SHARE for reads), then the list row,
 * then item rows, then notification rows.
 */
@Service
public class BoardListService {
  static final String DEFAULT_LIST_NAME = "Shopping";
  static final int MAX_LIST_NAME_LENGTH = 40;
  static final int MAX_ITEM_NAME_LENGTH = 80;
  static final int MAX_NOTE_LENGTH = 60;
  static final int MAX_ACTIVE_LISTS = 20;
  static final int RECENT_NAME_LIMIT = 50;
  static final int KEPT_NAMES_PER_HOUSEHOLD = 200;
  static final Duration TODAY_PUSH_WINDOW = Duration.ofMinutes(30);
  static final Duration BOUGHT_RETENTION = Duration.ofHours(24);
  static final String NEEDED_TODAY = "BOARD_LIST_NEEDED_TODAY";
  static final String REFERENCE_TYPE = "BOARD_LIST";
  static final String CATEGORY = "BOARD";
  static final String FORMER_MEMBER = "Former member";

  private static final String ITEM_COLUMNS =
      """
      i.id, i.list_id, i.name, i.note, i.added_by_user_id, i.claimed_by_user_id,
      i.needed_today_on, i.needed_today_by_user_id, i.bought_at, i.bought_by_user_id, i.created_at
      """;

  private final JdbcTemplate jdbc;
  private final UserRepository userRepository;
  private final MembershipExitCleanupService membershipLocks;
  private final NotificationEventService notificationEventService;
  private Clock clock = Clock.systemUTC();

  public BoardListService(
      JdbcTemplate jdbc,
      UserRepository userRepository,
      MembershipExitCleanupService membershipLocks,
      NotificationEventService notificationEventService) {
    this.jdbc = jdbc;
    this.userRepository = userRepository;
    this.membershipLocks = membershipLocks;
    this.notificationEventService = notificationEventService;
  }

  /** Tests pin the clock; {@code null} restores the system clock. */
  void useClock(Clock testClock) {
    this.clock = testClock == null ? Clock.systemUTC() : testClock;
  }

  private OffsetDateTime now() {
    return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
  }

  private LocalDate today(ZoneId zone) {
    return LocalDate.now(clock.withZone(zone));
  }

  // ---- Lists -----------------------------------------------------------------------------------

  /** The active lists (creating Shopping on first use) and open items across them. */
  @Transactional
  public BoardListsResponse lists(UUID householdId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    ensureDefaultList(householdId, actor.userId());
    List<BoardListResponse> lists = activeLists(householdId, today(actor.zone()));
    return new BoardListsResponse(
        lists, lists.stream().mapToInt(BoardListResponse::openCount).sum());
  }

  /**
   * The Board header's "To buy" and Home's Shopping row, read alongside the posts. Does not create
   * the Shopping list.
   */
  BoardShoppingSummary shoppingSummary(UUID householdId, ZoneId zone) {
    LocalDate today = today(zone);
    return jdbc.query(
        """
            SELECT l.id,
                   COUNT(i.id) FILTER (WHERE i.bought_at IS NULL) open_count,
                   COUNT(i.id) FILTER (WHERE i.bought_at IS NULL AND i.needed_today_on=?) today_count
            FROM board_lists l LEFT JOIN board_list_items i ON i.list_id=l.id
            WHERE l.household_id=? AND l.is_default
            GROUP BY l.id
            """,
        rs ->
            rs.next()
                ? new BoardShoppingSummary(
                    rs.getObject("id", UUID.class),
                    rs.getInt("open_count"),
                    rs.getInt("today_count"))
                : new BoardShoppingSummary(null, 0, 0),
        today,
        householdId);
  }

  /** Open items across the household's active lists. */
  int toBuyCount(UUID householdId) {
    Integer count =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM board_list_items i
                JOIN board_lists l ON l.id=i.list_id AND l.archived_at IS NULL
                WHERE i.household_id=? AND i.bought_at IS NULL
                """,
            Integer.class,
            householdId);
    return count == null ? 0 : count;
  }

  @Transactional
  public BoardListResponse createList(
      UUID householdId, BoardListRequest request, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ensureDefaultList(householdId, actor.userId());
    String name = listName(request);
    Integer active =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM board_lists WHERE household_id=? AND archived_at IS NULL",
            Integer.class,
            householdId);
    if (active != null && active >= MAX_ACTIVE_LISTS) {
      throw new InvalidHouseholdException(
          "You can have at most " + MAX_ACTIVE_LISTS + " lists. Archive one to make room.");
    }
    requireFreeListName(householdId, name, null);
    UUID id = UUID.randomUUID();
    OffsetDateTime now = now();
    jdbc.update(
        """
            INSERT INTO board_lists (id, household_id, name, created_by_user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
        id,
        householdId,
        name,
        actor.userId(),
        now,
        now);
    return listResponse(householdId, id, today(actor.zone()));
  }

  @Transactional
  public BoardListResponse renameList(
      UUID householdId, UUID listId, BoardListRequest request, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ListRow list = requireActiveList(householdId, listId, true);
    if (list.isDefault()) {
      throw new InvalidHouseholdException(DEFAULT_LIST_NAME + " can't be renamed.");
    }
    String name = listName(request);
    requireFreeListName(householdId, name, listId);
    jdbc.update("UPDATE board_lists SET name=?, updated_at=? WHERE id=?", name, now(), listId);
    return listResponse(householdId, listId, today(actor.zone()));
  }

  /** Archives a list (the screen confirms first when it still has open items). */
  @Transactional
  public void archiveList(UUID householdId, UUID listId, Authentication authentication) {
    writeActor(householdId, authentication);
    ListRow list = requireActiveList(householdId, listId, true);
    if (list.isDefault()) {
      throw new InvalidHouseholdException(DEFAULT_LIST_NAME + " can't be archived.");
    }
    OffsetDateTime now = now();
    jdbc.update("UPDATE board_lists SET archived_at=?, updated_at=? WHERE id=?", now, now, listId);
    cancelDeferredPush(listId);
  }

  // ---- Items -----------------------------------------------------------------------------------

  /** A list's open items (needed today first, then oldest first) and what was bought today. */
  @Transactional
  public BoardListItemsResponse items(
      UUID householdId, UUID listId, Authentication authentication) {
    Actor actor = readActor(householdId, authentication);
    requireActiveList(householdId, listId, false);
    LocalDate today = today(actor.zone());
    List<BoardListItemResponse> open =
        jdbc.query(
            "SELECT "
                + ITEM_COLUMNS
                + """
                FROM board_list_items i WHERE i.list_id=? AND i.bought_at IS NULL
                ORDER BY (i.needed_today_on IS NOT DISTINCT FROM ?) DESC, i.created_at, i.id
                """,
            (rs, row) -> itemResponse(rs, actor, today),
            listId,
            today);
    List<BoardListItemResponse> bought =
        jdbc.query(
            "SELECT "
                + ITEM_COLUMNS
                + """
                FROM board_list_items i WHERE i.list_id=? AND i.bought_on=?
                ORDER BY i.bought_at DESC, i.id
                """,
            (rs, row) -> itemResponse(rs, actor, today),
            listId,
            today);
    return new BoardListItemsResponse(listResponse(householdId, listId, today), open, bought);
  }

  /**
   * Adds an item, or returns the open item with the same name (ignoring case) without adding one.
   */
  @Transactional
  public BoardListItemAddResponse addItem(
      UUID householdId, UUID listId, BoardListItemRequest request, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    requireActiveList(householdId, listId, true);
    String name = itemName(request);
    String note = itemNote(request);
    LocalDate today = today(actor.zone());
    UUID existing = openItemNamed(listId, name, null);
    if (existing != null) {
      return new BoardListItemAddResponse(item(existing, actor, today), true);
    }
    UUID id = UUID.randomUUID();
    OffsetDateTime now = now();
    jdbc.update(
        """
            INSERT INTO board_list_items
                (id, list_id, household_id, name, note, added_by_user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
        id,
        listId,
        householdId,
        name,
        note,
        actor.userId(),
        now,
        now);
    rememberName(householdId, name, now);
    return new BoardListItemAddResponse(item(id, actor, today), false);
  }

  @Transactional
  public BoardListItemResponse updateItem(
      UUID householdId, UUID itemId, BoardListItemRequest request, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ItemRef ref = lockItem(householdId, itemId);
    String name = itemName(request);
    String note = itemNote(request);
    if (ref.boughtAt() == null && openItemNamed(ref.listId(), name, itemId) != null) {
      throw new DuplicateResourceException(name + " is already on this list.");
    }
    OffsetDateTime now = now();
    jdbc.update(
        "UPDATE board_list_items SET name=?, note=?, updated_at=? WHERE id=?",
        name,
        note,
        now,
        itemId);
    rememberName(householdId, name, now);
    planTodayPush(ref.listId(), householdId, actor, null);
    return item(itemId, actor, today(actor.zone()));
  }

  @Transactional
  public void deleteItem(UUID householdId, UUID itemId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ItemRef ref = lockItem(householdId, itemId);
    jdbc.update("DELETE FROM board_list_items WHERE id=?", itemId);
    planTodayPush(ref.listId(), householdId, actor, null);
  }

  /** "I'll get it". Anyone can take over someone else's claim. */
  @Transactional
  public BoardListItemResponse claim(UUID householdId, UUID itemId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    requireOpen(lockItem(householdId, itemId));
    OffsetDateTime now = now();
    jdbc.update(
        """
            UPDATE board_list_items SET claimed_by_user_id=?, claimed_at=?, updated_at=?
            WHERE id=? AND claimed_by_user_id IS DISTINCT FROM ?
            """,
        actor.userId(),
        now,
        now,
        itemId,
        actor.userId());
    return item(itemId, actor, today(actor.zone()));
  }

  /** Anyone can release a claim. */
  @Transactional
  public BoardListItemResponse release(
      UUID householdId, UUID itemId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    lockItem(householdId, itemId);
    jdbc.update(
        """
            UPDATE board_list_items SET claimed_by_user_id=NULL, claimed_at=NULL, updated_at=?
            WHERE id=? AND claimed_by_user_id IS NOT NULL
            """,
        now(),
        itemId);
    return item(itemId, actor, today(actor.zone()));
  }

  /**
   * "Need it today" on or off. Turning it on notifies every other member at once, unless this list
   * already pushed in the last {@link #TODAY_PUSH_WINDOW}: then one push is scheduled for the end
   * of that window and carries every flag set meanwhile (see {@link #planTodayPush}).
   */
  @Transactional
  public BoardListItemResponse neededToday(
      UUID householdId, UUID itemId, boolean on, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ItemRef ref = lockItem(householdId, itemId);
    LocalDate today = today(actor.zone());
    OffsetDateTime now = now();
    if (!on) {
      jdbc.update(
          """
              UPDATE board_list_items
              SET needed_today_at=NULL, needed_today_by_user_id=NULL, needed_today_on=NULL,
                  today_notified_at=NULL, updated_at=?
              WHERE id=?
              """,
          now,
          itemId);
      planTodayPush(ref.listId(), householdId, actor, null);
      return item(itemId, actor, today);
    }
    requireOpen(ref);
    int flagged =
        jdbc.update(
            """
                UPDATE board_list_items
                SET needed_today_at=?, needed_today_by_user_id=?, needed_today_on=?,
                    today_notified_at=NULL, updated_at=?
                WHERE id=? AND needed_today_on IS DISTINCT FROM ?
                """,
            now,
            actor.userId(),
            today,
            now,
            itemId,
            today);
    if (flagged > 0) {
      planTodayPush(ref.listId(), householdId, actor, actor.userId());
    }
    return item(itemId, actor, today);
  }

  /** Marks it bought (by whom, when); a bought item is already in this state. */
  @Transactional
  public BoardListItemResponse buy(UUID householdId, UUID itemId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ItemRef ref = lockItem(householdId, itemId);
    LocalDate today = today(actor.zone());
    OffsetDateTime now = now();
    jdbc.update(
        """
            UPDATE board_list_items SET bought_at=?, bought_by_user_id=?, bought_on=?, updated_at=?
            WHERE id=? AND bought_at IS NULL
            """,
        now,
        actor.userId(),
        today,
        now,
        itemId);
    planTodayPush(ref.listId(), householdId, actor, null);
    return item(itemId, actor, today);
  }

  /**
   * Undo for Bought. If the same name was added again meanwhile, the bought copy goes and the open
   * one is returned.
   */
  @Transactional
  public BoardListItemResponse unbuy(UUID householdId, UUID itemId, Authentication authentication) {
    Actor actor = writeActor(householdId, authentication);
    ItemRef ref = lockItem(householdId, itemId);
    LocalDate today = today(actor.zone());
    if (ref.boughtAt() == null) {
      return item(itemId, actor, today);
    }
    String name =
        jdbc.queryForObject("SELECT name FROM board_list_items WHERE id=?", String.class, itemId);
    UUID open = openItemNamed(ref.listId(), name, itemId);
    if (open != null) {
      jdbc.update("DELETE FROM board_list_items WHERE id=?", itemId);
      planTodayPush(ref.listId(), householdId, actor, null);
      return item(open, actor, today);
    }
    jdbc.update(
        """
            UPDATE board_list_items SET bought_at=NULL, bought_by_user_id=NULL, bought_on=NULL,
                updated_at=?
            WHERE id=?
            """,
        now(),
        itemId);
    planTodayPush(ref.listId(), householdId, actor, null);
    return item(itemId, actor, today);
  }

  /** Names this household added, most recent first (for suggestions as someone types). */
  @Transactional
  public List<String> recentNames(UUID householdId, Authentication authentication) {
    readActor(householdId, authentication);
    return jdbc.queryForList(
        """
            SELECT name FROM board_list_item_names WHERE household_id=?
            ORDER BY last_added_at DESC, name_key LIMIT ?
            """,
        String.class,
        householdId,
        RECENT_NAME_LIMIT);
  }

  // ---- Retention -------------------------------------------------------------------------------

  /**
   * Nightly: deletes items bought more than {@link #BOUGHT_RETENTION} ago, clears Today flags whose
   * household day has ended, and keeps the most recent {@value #KEPT_NAMES_PER_HOUSEHOLD} names per
   * household. Households are locked in id order first, like every other household writer.
   */
  @Transactional
  public int runRetention() {
    OffsetDateTime now = now();
    OffsetDateTime purgeBefore = now.minus(BOUGHT_RETENTION);
    List<UUID> householdIds =
        jdbc.query(
            """
                SELECT DISTINCT i.household_id FROM board_list_items i
                JOIN households h ON h.id=i.household_id
                WHERE i.bought_at < ?
                   OR i.needed_today_on < (?::timestamptz AT TIME ZONE h.timezone)::date
                UNION
                SELECT household_id FROM board_list_item_names
                GROUP BY household_id HAVING COUNT(*) > ?
                ORDER BY 1
                """,
            (rs, row) -> rs.getObject(1, UUID.class),
            purgeBefore,
            now,
            KEPT_NAMES_PER_HOUSEHOLD);
    int purged = 0;
    for (UUID householdId : membershipLocks.lockExistingHouseholds(householdIds)) {
      purged +=
          jdbc.update(
              "DELETE FROM board_list_items WHERE household_id=? AND bought_at < ?",
              householdId,
              purgeBefore);
      jdbc.update(
          """
              UPDATE board_list_items i
              SET needed_today_at=NULL, needed_today_by_user_id=NULL, needed_today_on=NULL,
                  today_notified_at=NULL
              FROM households h
              WHERE h.id=i.household_id AND i.household_id=?
                AND i.needed_today_on < (?::timestamptz AT TIME ZONE h.timezone)::date
              """,
          householdId,
          now);
      jdbc.update(
          """
              DELETE FROM board_list_item_names WHERE household_id=? AND name_key NOT IN (
                  SELECT name_key FROM board_list_item_names WHERE household_id=?
                  ORDER BY last_added_at DESC, name_key LIMIT ?)
              """,
          householdId,
          householdId,
          KEPT_NAMES_PER_HOUSEHOLD);
    }
    return purged;
  }

  // ---- Needed today push -----------------------------------------------------------------------

  /**
   * Plans this list's "Need it today" push after any change to its flags (on, off, bought, undone,
   * edited, deleted). The flags no push has carried yet go out now when the list hasn't pushed in
   * the last {@link #TODAY_PUSH_WINDOW}; inside the window, one push is scheduled for the window's
   * end instead. Any earlier scheduled push for the list is replaced, so at most one is pending and
   * it lists exactly the flags still open; when none are left, nothing is scheduled.
   *
   * @param trigger whose flag asked for this push (left out of an immediate push), or null
   */
  private void planTodayPush(UUID listId, UUID householdId, Actor actor, UUID trigger) {
    cancelDeferredPush(listId);
    LocalDate today = today(actor.zone());
    OffsetDateTime now = now();
    List<Flag> flags = unpushedFlags(listId, today);
    if (flags.isEmpty()) {
      return;
    }
    ListPush list =
        jdbc.query(
                "SELECT name, last_today_push_at FROM board_lists WHERE id=?",
                (rs, row) ->
                    new ListPush(
                        rs.getString("name"),
                        rs.getObject("last_today_push_at", OffsetDateTime.class)),
                listId)
            .getFirst();
    OffsetDateTime windowEnd =
        list.lastPushAt() == null ? null : list.lastPushAt().plus(TODAY_PUSH_WINDOW);
    boolean deferred = windowEnd != null && now.isBefore(windowEnd);
    UUID exclude = trigger != null && !deferred ? trigger : soleFlagger(flags);
    String message = todayMessage(flags, list.name(), actor::nameOf);
    for (UUID recipient : actor.members().keySet()) {
      if (!recipient.equals(exclude)) {
        publish(
            actor.userId(),
            householdId,
            listId,
            recipient,
            list.name(),
            message,
            deferred ? windowEnd : null);
      }
    }
    if (!deferred) {
      markPushed(listId, today, now);
    }
  }

  /**
   * The scheduler asks this before sending a scheduled "Need it today" push: it goes only while at
   * least one flag it was planned for is still open on the list's current day, and those flags then
   * count as pushed (the list's window starts at {@code scheduledAt}). Called once per recipient;
   * the same {@code scheduledAt} keeps it idempotent.
   */
  @Transactional
  public boolean claimDeferredPush(UUID listId, OffsetDateTime scheduledAt) {
    List<String> zones =
        jdbc.queryForList(
            """
                SELECT h.timezone FROM board_lists l JOIN households h ON h.id=l.household_id
                WHERE l.id=? AND l.archived_at IS NULL
                """,
            String.class,
            listId);
    if (zones.isEmpty()) {
      return false;
    }
    LocalDate today = today(ZoneId.of(zones.getFirst() == null ? "UTC" : zones.getFirst()));
    OffsetDateTime at = scheduledAt.withOffsetSameInstant(ZoneOffset.UTC);
    int live =
        jdbc.update(
            """
                UPDATE board_list_items SET today_notified_at=?
                WHERE list_id=? AND bought_at IS NULL AND needed_today_on=?
                  AND (today_notified_at IS NULL OR today_notified_at=?)
                """,
            at,
            listId,
            today,
            at);
    if (live == 0) {
      return false;
    }
    jdbc.update(
        """
            UPDATE board_lists SET last_today_push_at=GREATEST(COALESCE(last_today_push_at, ?), ?)
            WHERE id=?
            """,
        at,
        at,
        listId);
    return true;
  }

  private List<Flag> unpushedFlags(UUID listId, LocalDate today) {
    return jdbc.query(
        """
            SELECT name, needed_today_by_user_id FROM board_list_items
            WHERE list_id=? AND bought_at IS NULL AND needed_today_on=?
              AND today_notified_at IS NULL
            ORDER BY needed_today_at, id
            """,
        (rs, row) ->
            new Flag(rs.getString("name"), rs.getObject("needed_today_by_user_id", UUID.class)),
        listId,
        today);
  }

  private void markPushed(UUID listId, LocalDate today, OffsetDateTime now) {
    jdbc.update(
        """
            UPDATE board_list_items SET today_notified_at=?
            WHERE list_id=? AND bought_at IS NULL AND needed_today_on=? AND today_notified_at IS NULL
            """,
        now,
        listId,
        today);
    jdbc.update("UPDATE board_lists SET last_today_push_at=? WHERE id=?", now, listId);
  }

  /** The one person who flagged every item in the bundle, or null when several people did. */
  private static UUID soleFlagger(List<Flag> flags) {
    UUID first = flags.getFirst().flaggedBy();
    return first != null && flags.stream().allMatch(flag -> first.equals(flag.flaggedBy()))
        ? first
        : null;
  }

  /** "Ana needs Toilet paper today", or "Needed today on Shopping: Milk, Eggs, Rice +2 more". */
  static String todayMessage(
      List<Flag> flags, String listName, java.util.function.Function<UUID, String> nameOf) {
    if (flags.size() == 1) {
      return nameOf.apply(flags.getFirst().flaggedBy())
          + " needs "
          + flags.getFirst().name()
          + " today";
    }
    List<String> names = flags.stream().map(Flag::name).toList();
    String more = names.size() > 3 ? " +" + (names.size() - 3) + " more" : "";
    return "Needed today on "
        + listName
        + ": "
        + String.join(", ", names.subList(0, Math.min(3, names.size())))
        + more;
  }

  /** Cancels this list's scheduled (not yet due) "Need it today" push and its deliveries. */
  private void cancelDeferredPush(UUID listId) {
    String scheduled =
        """
        n.reference_type=? AND n.reference_id=? AND n.type=?
        AND n.deduplication_key NOT LIKE '%:event%'
        """;
    jdbc.update(
        "UPDATE notifications n SET status='CANCELLED' WHERE n.status='PENDING' AND " + scheduled,
        REFERENCE_TYPE,
        listId,
        NEEDED_TODAY);
    jdbc.update(
        "UPDATE notification_deliveries d SET status='CANCELLED' FROM notifications n"
            + " WHERE d.notification_id=n.id AND n.status='CANCELLED'"
            + " AND d.status IN ('PENDING','FAILED') AND "
            + scheduled,
        REFERENCE_TYPE,
        listId,
        NEEDED_TODAY);
    jdbc.update(
        "UPDATE notification_push_delivery_targets t"
            + " SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()"
            + " FROM notifications n WHERE t.notification_id=n.id AND n.status='CANCELLED'"
            + " AND t.status IN ('PENDING','FAILED') AND "
            + scheduled,
        REFERENCE_TYPE,
        listId,
        NEEDED_TODAY);
  }

  /** A later push for the same list and recipient gets a new deduplication revision. */
  private void publish(
      UUID actorId,
      UUID householdId,
      UUID listId,
      UUID recipient,
      String listName,
      String message,
      OffsetDateTime scheduledAt) {
    Integer earlier =
        jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM notifications
                WHERE reference_type=? AND reference_id=? AND recipient_user_id=? AND type=?
                """,
            Integer.class,
            REFERENCE_TYPE,
            listId,
            recipient,
            NEEDED_TODAY);
    Map<String, String> variables = new HashMap<>();
    variables.put("list_name", listName);
    variables.put("notification_title", listName);
    variables.put("notification_message", message);
    if (scheduledAt != null) {
      variables.put("scheduled_at", scheduledAt.withOffsetSameInstant(ZoneOffset.UTC).toString());
    }
    if (earlier != null && earlier > 0) {
      variables.put(DefaultNotificationGenerator.DEDUPLICATION_REVISION, "r" + (earlier + 1));
    }
    notificationEventService.publish(
        new NotificationEvent(
            NEEDED_TODAY,
            actorId,
            householdId,
            REFERENCE_TYPE,
            listId,
            CATEGORY,
            Map.copyOf(variables),
            List.of(recipient)));
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  /** Creates the household's Shopping list once; a concurrent first use is a no-op. */
  private void ensureDefaultList(UUID householdId, UUID creatorId) {
    jdbc.update(
        """
            INSERT INTO board_lists (household_id, name, is_default, created_by_user_id)
            SELECT ?, ?, TRUE, ?
            WHERE NOT EXISTS (SELECT 1 FROM board_lists WHERE household_id=? AND is_default)
            ON CONFLICT DO NOTHING
            """,
        householdId,
        DEFAULT_LIST_NAME,
        creatorId,
        householdId);
  }

  private List<BoardListResponse> activeLists(UUID householdId, LocalDate today) {
    return jdbc.query(
        """
            SELECT l.id, l.name, l.is_default, l.created_at,
                   COUNT(i.id) FILTER (WHERE i.bought_at IS NULL) open_count,
                   COUNT(i.id) FILTER (WHERE i.bought_at IS NULL AND i.needed_today_on=?) today_count
            FROM board_lists l LEFT JOIN board_list_items i ON i.list_id=l.id
            WHERE l.household_id=? AND l.archived_at IS NULL
            GROUP BY l.id
            ORDER BY l.is_default DESC, l.created_at, l.id
            """,
        (rs, row) -> listResponse(rs),
        today,
        householdId);
  }

  private BoardListResponse listResponse(UUID householdId, UUID listId, LocalDate today) {
    return jdbc.query(
            """
                SELECT l.id, l.name, l.is_default, l.created_at,
                       COUNT(i.id) FILTER (WHERE i.bought_at IS NULL) open_count,
                       COUNT(i.id) FILTER (WHERE i.bought_at IS NULL AND i.needed_today_on=?)
                           today_count
                FROM board_lists l LEFT JOIN board_list_items i ON i.list_id=l.id
                WHERE l.id=? AND l.household_id=?
                GROUP BY l.id
                """,
            (rs, row) -> listResponse(rs),
            today,
            listId,
            householdId)
        .getFirst();
  }

  private static BoardListResponse listResponse(ResultSet rs) throws SQLException {
    return new BoardListResponse(
        rs.getObject("id", UUID.class),
        rs.getString("name"),
        rs.getBoolean("is_default"),
        rs.getInt("open_count"),
        rs.getInt("today_count"),
        rs.getObject("created_at", OffsetDateTime.class));
  }

  private ListRow requireActiveList(UUID householdId, UUID listId, boolean forUpdate) {
    List<ListRow> rows =
        jdbc.query(
            "SELECT id, is_default FROM board_lists"
                + " WHERE id=? AND household_id=? AND archived_at IS NULL"
                + (forUpdate ? " FOR UPDATE" : ""),
            (rs, row) -> new ListRow(rs.getObject("id", UUID.class), rs.getBoolean("is_default")),
            listId,
            householdId);
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException("This list is no longer on the board.");
    }
    return rows.getFirst();
  }

  /** Locks the item's list, then the item (the lock order), and checks the list is active. */
  private ItemRef lockItem(UUID householdId, UUID itemId) {
    List<UUID> listIds =
        jdbc.queryForList(
            "SELECT list_id FROM board_list_items WHERE id=? AND household_id=?",
            UUID.class,
            itemId,
            householdId);
    if (listIds.isEmpty()) {
      throw new ResourceNotFoundException("This item is no longer on the list.");
    }
    List<UUID> activeList =
        jdbc.queryForList(
            "SELECT id FROM board_lists WHERE id=? AND archived_at IS NULL FOR UPDATE",
            UUID.class,
            listIds.getFirst());
    List<ItemRef> rows =
        jdbc.query(
            "SELECT id, list_id, bought_at FROM board_list_items WHERE id=? FOR UPDATE",
            (rs, row) ->
                new ItemRef(
                    rs.getObject("id", UUID.class),
                    rs.getObject("list_id", UUID.class),
                    rs.getObject("bought_at", OffsetDateTime.class)),
            itemId);
    if (activeList.isEmpty() || rows.isEmpty()) {
      throw new ResourceNotFoundException("This item is no longer on the list.");
    }
    return rows.getFirst();
  }

  private static void requireOpen(ItemRef ref) {
    if (ref.boughtAt() != null) {
      throw new DuplicateResourceException("This item is already bought.");
    }
  }

  private UUID openItemNamed(UUID listId, String name, UUID exceptId) {
    List<UUID> ids =
        jdbc.queryForList(
            """
                SELECT id FROM board_list_items
                WHERE list_id=? AND bought_at IS NULL AND lower(btrim(name))=lower(btrim(?))
                  AND id IS DISTINCT FROM ?
                """,
            UUID.class,
            listId,
            name,
            exceptId);
    return ids.isEmpty() ? null : ids.getFirst();
  }

  private void requireFreeListName(UUID householdId, String name, UUID exceptId) {
    List<String> taken =
        jdbc.queryForList(
            """
                SELECT name FROM board_lists
                WHERE household_id=? AND archived_at IS NULL
                  AND lower(btrim(name))=lower(btrim(?)) AND id IS DISTINCT FROM ?
                """,
            String.class,
            householdId,
            name,
            exceptId);
    if (!taken.isEmpty()) {
      throw new DuplicateResourceException(
          "There's already a list called " + taken.getFirst() + ".");
    }
  }

  private void rememberName(UUID householdId, String name, OffsetDateTime at) {
    jdbc.update(
        """
            INSERT INTO board_list_item_names (household_id, name_key, name, last_added_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (household_id, name_key)
            DO UPDATE SET name=EXCLUDED.name, last_added_at=EXCLUDED.last_added_at
            """,
        householdId,
        name.toLowerCase(Locale.ROOT),
        name,
        at);
  }

  private static String listName(BoardListRequest request) {
    String name = request == null || request.name() == null ? "" : request.name().strip();
    if (name.isEmpty()) {
      throw new InvalidHouseholdException("Enter a name for the list.");
    }
    if (name.length() > MAX_LIST_NAME_LENGTH) {
      throw new InvalidHouseholdException(
          "Keep list names to " + MAX_LIST_NAME_LENGTH + " characters.");
    }
    return name;
  }

  private static String itemName(BoardListItemRequest request) {
    String name = request == null || request.name() == null ? "" : request.name().strip();
    if (name.isEmpty()) {
      throw new InvalidHouseholdException("Enter an item.");
    }
    if (name.length() > MAX_ITEM_NAME_LENGTH) {
      throw new InvalidHouseholdException("Keep items to " + MAX_ITEM_NAME_LENGTH + " characters.");
    }
    return name;
  }

  private static String itemNote(BoardListItemRequest request) {
    String note = request == null || request.note() == null ? "" : request.note().strip();
    if (note.length() > MAX_NOTE_LENGTH) {
      throw new InvalidHouseholdException("Keep the note to " + MAX_NOTE_LENGTH + " characters.");
    }
    return note.isEmpty() ? null : note;
  }

  private BoardListItemResponse item(UUID itemId, Actor actor, LocalDate today) {
    return jdbc.query(
            "SELECT " + ITEM_COLUMNS + " FROM board_list_items i WHERE i.id=?",
            (rs, row) -> itemResponse(rs, actor, today),
            itemId)
        .getFirst();
  }

  private BoardListItemResponse itemResponse(ResultSet rs, Actor actor, LocalDate today)
      throws SQLException {
    UUID addedBy = rs.getObject("added_by_user_id", UUID.class);
    UUID claimedBy = rs.getObject("claimed_by_user_id", UUID.class);
    UUID boughtBy = rs.getObject("bought_by_user_id", UUID.class);
    LocalDate todayOn = rs.getObject("needed_today_on", LocalDate.class);
    boolean neededToday = today.equals(todayOn) && rs.getObject("bought_at") == null;
    return new BoardListItemResponse(
        rs.getObject("id", UUID.class),
        rs.getObject("list_id", UUID.class),
        rs.getString("name"),
        rs.getString("note"),
        addedBy,
        actor.nameOf(addedBy),
        claimedBy,
        claimedBy == null ? null : actor.nameOf(claimedBy),
        neededToday,
        neededToday ? actor.nameOf(rs.getObject("needed_today_by_user_id", UUID.class)) : null,
        rs.getObject("bought_at", OffsetDateTime.class),
        boughtBy,
        rs.getObject("bought_at") == null ? null : actor.nameOf(boughtBy),
        rs.getObject("created_at", OffsetDateTime.class));
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
        jdbc.queryForList(
            "SELECT id FROM households WHERE id=? FOR SHARE", UUID.class, householdId);
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
    Map<UUID, String> members = new LinkedHashMap<>();
    jdbc.query(
        """
            SELECT m.user_id, u.display_name FROM household_memberships m
            JOIN users u ON u.id=m.user_id
            WHERE m.household_id=? AND m.status='ACTIVE'
            ORDER BY m.joined_at, m.user_id
            """,
        rs -> {
          members.put(rs.getObject("user_id", UUID.class), rs.getString("display_name"));
        },
        householdId);
    if (!members.containsKey(user.getId())) {
      throw new ResourceNotFoundException("Household was not found.");
    }
    String timezone =
        jdbc.queryForObject(
            "SELECT timezone FROM households WHERE id=?", String.class, householdId);
    return new Actor(user.getId(), ZoneId.of(timezone == null ? "UTC" : timezone), members);
  }

  private record Actor(UUID userId, ZoneId zone, Map<UUID, String> members) {
    String nameOf(UUID userId) {
      String name = userId == null ? null : members.get(userId);
      return name == null ? FORMER_MEMBER : name;
    }
  }

  private record ListRow(UUID id, boolean isDefault) {}

  private record ItemRef(UUID id, UUID listId, OffsetDateTime boughtAt) {}

  private record ListPush(String name, OffsetDateTime lastPushAt) {}

  record Flag(String name, UUID flaggedBy) {}
}
