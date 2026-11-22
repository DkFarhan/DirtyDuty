package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.board.BoardListItemAddResponse;
import com.dirtyduty.app.dto.board.BoardListItemRequest;
import com.dirtyduty.app.dto.board.BoardListItemResponse;
import com.dirtyduty.app.dto.board.BoardListItemsResponse;
import com.dirtyduty.app.dto.board.BoardListRequest;
import com.dirtyduty.app.dto.board.BoardListResponse;
import com.dirtyduty.app.dto.board.BoardListsResponse;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Board lists on real PostgreSQL: the default Shopping list, list names and the cap, adding with
 * dedupe, claims, the "Need it today" push and its 30-minute bundling, bought items' day and purge,
 * member exit, and 404 for non-members.
 *
 * <p>The lists' clock is pinned to Wednesday 2030-03-13 12:00 UTC (the household's zone).
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class BoardListIntegrationTest {
  private static final Instant START = Instant.parse("2030-03-13T12:00:00Z");

  @Autowired private JdbcTemplate jdbc;
  @Autowired private BoardListService lists;
  @Autowired private BoardPostService board;
  @Autowired private HouseholdService householdService;
  @Autowired private com.dirtyduty.app.notification.NotificationScheduler notificationScheduler;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> householdIds = new ArrayList<>();
  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private int joinOrder;

  @BeforeEach
  void setUp() {
    pinClock(START);
    owner = createUser("Owen");
    ana = createUser("Ana");
    ben = createUser("Ben");
    householdId = createHousehold(owner);
    addMember(householdId, ana, "MEMBER");
    addMember(householdId, ben, "MEMBER");
  }

  @AfterEach
  void cleanUp() {
    lists.useClock(null);
    for (UUID id : householdIds) {
      String scoped =
          "SELECT n.id FROM notifications n WHERE n.event_id IN"
              + " (SELECT id FROM notification_events WHERE household_id=?)";
      jdbc.update(
          "DELETE FROM notification_push_delivery_targets WHERE notification_id IN ("
              + scoped
              + ")",
          id);
      jdbc.update(
          "DELETE FROM notification_deliveries WHERE notification_id IN (" + scoped + ")", id);
      jdbc.update("DELETE FROM notifications WHERE id IN (" + scoped + ")", id);
      jdbc.update("DELETE FROM notification_events WHERE household_id=?", id);
      jdbc.update("DELETE FROM activity_events WHERE household_id=?", id);
      jdbc.update("DELETE FROM board_lists WHERE household_id=?", id);
      jdbc.update("DELETE FROM board_list_item_names WHERE household_id=?", id);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", id);
      jdbc.update("DELETE FROM households WHERE id=?", id);
    }
    for (UUID id : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", id);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", id);
      jdbc.update("DELETE FROM users WHERE id=?", id);
    }
  }

  // ---- Lists -----------------------------------------------------------------------------------

  @Test
  void shoppingIsCreatedOnceOnFirstUseAndCantBeRenamedOrArchived() {
    // The board's summary doesn't create it.
    assertThat(board.board(householdId, auth(ana)).shopping().listId()).isNull();
    assertThat(count("SELECT COUNT(*) FROM board_lists WHERE household_id=?", householdId))
        .isZero();

    BoardListsResponse first = lists.lists(householdId, auth(ana));
    lists.lists(householdId, auth(ben));
    lists.createList(householdId, new BoardListRequest("Party"), auth(owner));
    assertThat(
            count(
                "SELECT COUNT(*) FROM board_lists WHERE household_id=? AND is_default",
                householdId))
        .isEqualTo(1);
    BoardListResponse shopping = first.lists().getFirst();
    assertThat(shopping.name()).isEqualTo("Shopping");
    assertThat(shopping.defaultList()).isTrue();
    assertThat(lists.lists(householdId, auth(owner)).lists())
        .extracting(BoardListResponse::name)
        .containsExactly("Shopping", "Party");

    assertThatThrownBy(
            () ->
                lists.renameList(
                    householdId, shopping.id(), new BoardListRequest("Food"), auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Shopping can't be renamed.");
    assertThatThrownBy(() -> lists.archiveList(householdId, shopping.id(), auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Shopping can't be archived.");
  }

  @Test
  void listNamesAreUniqueIgnoringCaseAmongActiveListsAndCappedAtTwenty() {
    BoardListResponse party =
        lists.createList(householdId, new BoardListRequest("  Party Saturday "), auth(ana));
    assertThat(party.name()).isEqualTo("Party Saturday");
    assertThatThrownBy(
            () -> lists.createList(householdId, new BoardListRequest("party saturday"), auth(ben)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("There's already a list called Party Saturday.");
    assertThatThrownBy(
            () -> lists.createList(householdId, new BoardListRequest("SHOPPING"), auth(ben)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("There's already a list called Shopping.");
    assertThatThrownBy(() -> lists.createList(householdId, new BoardListRequest(" "), auth(ben)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Enter a name for the list.");
    assertThatThrownBy(
            () -> lists.createList(householdId, new BoardListRequest("x".repeat(41)), auth(ben)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Keep list names to 40 characters.");

    // Any member renames or archives; an archived name is free again.
    assertThat(
            lists
                .renameList(householdId, party.id(), new BoardListRequest("Party"), auth(ben))
                .name())
        .isEqualTo("Party");
    lists.archiveList(householdId, party.id(), auth(ben));
    assertThatThrownBy(() -> lists.items(householdId, party.id(), auth(ben)))
        .isInstanceOf(ResourceNotFoundException.class)
        .hasMessage("This list is no longer on the board.");
    lists.createList(householdId, new BoardListRequest("Party"), auth(ana));

    // Shopping and Party are 2 of 20.
    for (int i = 0; i < 18; i++) {
      lists.createList(householdId, new BoardListRequest("List " + i), auth(ana));
    }
    assertThatThrownBy(
            () -> lists.createList(householdId, new BoardListRequest("One more"), auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("You can have at most 20 lists. Archive one to make room.");
  }

  // ---- Items -----------------------------------------------------------------------------------

  @Test
  void addingAnOpenNameAgainReturnsTheExistingItemAndCountsFollow() {
    UUID shopping = shoppingId();
    BoardListItemAddResponse milk =
        lists.addItem(householdId, shopping, item("Milk", "2%, 2L"), auth(ana));
    assertThat(milk.existing()).isFalse();
    assertThat(milk.item().note()).isEqualTo("2%, 2L");
    assertThat(milk.item().addedByDisplayName()).isEqualTo("Ana");

    BoardListItemAddResponse again =
        lists.addItem(householdId, shopping, item("  milk ", null), auth(ben));
    assertThat(again.existing()).isTrue();
    assertThat(again.item().id()).isEqualTo(milk.item().id());
    assertThat(again.item().note()).isEqualTo("2%, 2L");

    lists.addItem(householdId, shopping, item("Eggs", null), auth(ben));
    UUID party = lists.createList(householdId, new BoardListRequest("Party"), auth(ana)).id();
    lists.addItem(householdId, party, item("Milk", null), auth(ana));
    assertThat(lists.lists(householdId, auth(owner)).toBuyCount()).isEqualTo(3);
    assertThat(board.board(householdId, auth(owner)).toBuyCount()).isEqualTo(3);
    assertThat(board.board(householdId, auth(owner)).shopping().openCount()).isEqualTo(2);

    // Edits keep names unique among open items; suggestions remember what was added.
    UUID eggs = idOf(shopping, "Eggs");
    assertThatThrownBy(() -> lists.updateItem(householdId, eggs, item("MILK", null), auth(owner)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("MILK is already on this list.");
    assertThat(lists.updateItem(householdId, eggs, item("Eggs", "Dozen"), auth(owner)).note())
        .isEqualTo("Dozen");
    assertThat(lists.recentNames(householdId, auth(ben))).startsWith("Eggs", "Milk");
    assertThatThrownBy(
            () -> lists.addItem(householdId, shopping, item("x".repeat(81), null), auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Keep items to 80 characters.");
    assertThatThrownBy(
            () -> lists.addItem(householdId, shopping, item("Rice", "x".repeat(61)), auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Keep the note to 60 characters.");

    lists.deleteItem(householdId, eggs, auth(ana));
    assertThat(lists.items(householdId, shopping, auth(ana)).items())
        .extracting(BoardListItemResponse::name)
        .containsExactly("Milk");
  }

  @Test
  void anyoneClaimsTakesOverAndReleases() {
    UUID shopping = shoppingId();
    UUID oil =
        lists.addItem(householdId, shopping, item("Olive oil", null), auth(owner)).item().id();

    BoardListItemResponse claimed = lists.claim(householdId, oil, auth(ana));
    assertThat(claimed.claimedByUserId()).isEqualTo(ana);
    assertThat(claimed.claimedByDisplayName()).isEqualTo("Ana");

    BoardListItemResponse takenOver = lists.claim(householdId, oil, auth(ben));
    assertThat(takenOver.claimedByUserId()).isEqualTo(ben);

    BoardListItemResponse released = lists.release(householdId, oil, auth(ana));
    assertThat(released.claimedByUserId()).isNull();
    assertThat(released.claimedByDisplayName()).isNull();
    // Nothing on a list notifies except "Need it today".
    assertThat(count("SELECT COUNT(*) FROM notifications WHERE reference_type='BOARD_LIST'"))
        .isZero();
  }

  @Test
  void neededTodayPushesAtOnceToEveryoneButTheSetterAndOnlyOncePerDay() {
    UUID shopping = shoppingId();
    UUID paper = add(shopping, "Toilet paper");

    BoardListItemResponse flagged = lists.neededToday(householdId, paper, true, auth(ana));
    assertThat(flagged.neededToday()).isTrue();
    assertThat(flagged.neededTodayByDisplayName()).isEqualTo("Ana");
    assertThat(pushes()).containsExactlyInAnyOrder(owner, ben);
    assertThat(messages(owner)).containsExactly("Ana needs Toilet paper today");
    assertThat(titles(owner)).containsExactly("Shopping");
    assertThat(scheduled(shopping)).isEmpty();

    // Flagging it again the same day (by anyone) doesn't push again.
    lists.neededToday(householdId, paper, true, auth(ben));
    pinClock(START.plus(Duration.ofHours(2)));
    lists.neededToday(householdId, paper, true, auth(ana));
    assertThat(pushes()).hasSize(2);
    assertThat(scheduled(shopping)).isEmpty();

    // Flags clear when the household's day ends.
    pinClock(Instant.parse("2030-03-14T00:01:00Z"));
    assertThat(lists.items(householdId, shopping, auth(owner)).items())
        .noneMatch(BoardListItemResponse::neededToday);
    assertThat(lists.runRetention()).isZero();
    assertThat(
            count(
                "SELECT COUNT(*) FROM board_list_items WHERE list_id=? AND needed_today_on IS NOT NULL",
                shopping))
        .isZero();
  }

  @Test
  void flagsInsideTheWindowGetOneDeferredPushAtItsEnd() {
    UUID shopping = shoppingId();
    UUID paper = add(shopping, "Toilet paper");
    UUID milk = add(shopping, "Milk");
    UUID eggs = add(shopping, "Eggs");
    lists.neededToday(householdId, paper, true, auth(ana));
    assertThat(pushes()).hasSize(2);

    // Ten minutes later: nothing now, one push planned for the end of the window.
    pinClock(START.plus(Duration.ofMinutes(10)));
    lists.neededToday(householdId, milk, true, auth(ben));
    assertThat(sent(shopping)).hasSize(2);
    List<Pending> planned = scheduled(shopping);
    assertThat(planned)
        .extracting(Pending::recipient)
        .containsExactlyInAnyOrder(owner, ana); // not Ben, who flagged it
    assertThat(planned)
        .allSatisfy(
            push -> {
              assertThat(push.at()).isEqualTo(START.plus(Duration.ofMinutes(30)));
              assertThat(push.message()).isEqualTo("Ben needs Milk today");
            });

    // A second flag in the window replaces it: still one push per recipient, listing both.
    pinClock(START.plus(Duration.ofMinutes(20)));
    lists.neededToday(householdId, eggs, true, auth(owner));
    planned = scheduled(shopping);
    assertThat(planned)
        .extracting(Pending::recipient)
        .containsExactlyInAnyOrder(owner, ana, ben); // Ben and Owen each flagged only one
    assertThat(planned)
        .allSatisfy(
            push -> {
              assertThat(push.at()).isEqualTo(START.plus(Duration.ofMinutes(30)));
              assertThat(push.message()).isEqualTo("Needed today on Shopping: Milk, Eggs");
            });

    // At the window's end the scheduler sends it and the flags count as pushed.
    jdbc.update(
        "UPDATE notifications SET scheduled_at=NOW() - INTERVAL '1 minute' WHERE reference_id=?"
            + " AND status='PENDING'",
        shopping);
    pinClock(START.plus(Duration.ofMinutes(30)));
    notificationScheduler.run();
    assertThat(scheduled(shopping)).isEmpty();
    assertThat(sent(shopping)).hasSize(5);
    assertThat(
            count(
                "SELECT COUNT(*) FROM board_list_items WHERE list_id=? AND today_notified_at IS NULL"
                    + " AND needed_today_on IS NOT NULL",
                shopping))
        .isZero();
  }

  @Test
  void flagsResolvedBeforeTheWindowEndsSendNothing() {
    UUID shopping = shoppingId();
    UUID paper = add(shopping, "Toilet paper");
    UUID milk = add(shopping, "Milk");
    UUID eggs = add(shopping, "Eggs");
    lists.neededToday(householdId, paper, true, auth(ana));

    pinClock(START.plus(Duration.ofMinutes(5)));
    lists.neededToday(householdId, milk, true, auth(ben));
    pinClock(START.plus(Duration.ofMinutes(6)));
    lists.neededToday(householdId, eggs, true, auth(ben));
    assertThat(scheduled(shopping))
        .extracting(Pending::message)
        .containsOnly("Needed today on Shopping: Milk, Eggs");

    // Bought, then switched off: the planned push shrinks, then goes.
    lists.buy(householdId, milk, auth(owner));
    assertThat(scheduled(shopping))
        .extracting(Pending::message)
        .containsOnly("Ben needs Eggs today");
    lists.neededToday(householdId, eggs, false, auth(ana));
    assertThat(scheduled(shopping)).isEmpty();

    // Even a push that was due goes nowhere once nothing it carried is still needed.
    lists.neededToday(householdId, eggs, true, auth(ben));
    jdbc.update(
        "UPDATE notifications SET scheduled_at=NOW() - INTERVAL '1 minute' WHERE reference_id=?"
            + " AND status='PENDING'",
        shopping);
    jdbc.update(
        "UPDATE board_list_items SET bought_at=NOW(), bought_on=? WHERE id=?",
        LocalDate.of(2030, 3, 13),
        eggs);
    notificationScheduler.run();
    assertThat(sent(shopping)).hasSize(2);
    assertThat(
            count(
                "SELECT COUNT(*) FROM notifications WHERE reference_id=? AND status='PENDING'",
                shopping))
        .isZero();
  }

  @Test
  void bundledPushesNameUpToThreeItems() {
    UUID shopping = shoppingId();
    lists.neededToday(householdId, add(shopping, "Toilet paper"), true, auth(ana));
    List<String> names = List.of("Milk", "Eggs", "Rice", "Bread", "Butter");
    for (int i = 0; i < names.size(); i++) {
      pinClock(START.plus(Duration.ofMinutes(1 + i)));
      lists.neededToday(householdId, add(shopping, names.get(i)), true, auth(owner));
    }
    // Owen flagged every item in the bundle, so it goes to the others.
    assertThat(scheduled(shopping))
        .extracting(Pending::recipient)
        .containsExactlyInAnyOrder(ana, ben);
    assertThat(scheduled(shopping))
        .extracting(Pending::message)
        .containsOnly("Needed today on Shopping: Milk, Eggs, Rice +2 more");
    assertThat(
            BoardListService.todayMessage(
                List.of(new BoardListService.Flag("Milk", null)),
                "Shopping",
                userId -> "Former member"))
        .isEqualTo("Former member needs Milk today");
  }

  @Test
  void boughtItemsShowForTheRestOfTheDayAndArePurgedADayLater() {
    UUID shopping = shoppingId();
    UUID rice = lists.addItem(householdId, shopping, item("Rice", null), auth(owner)).item().id();
    UUID towels =
        lists.addItem(householdId, shopping, item("Paper towels", null), auth(owner)).item().id();

    BoardListItemResponse bought = lists.buy(householdId, rice, auth(ana));
    assertThat(bought.boughtByDisplayName()).isEqualTo("Ana");
    BoardListItemsResponse view = lists.items(householdId, shopping, auth(ben));
    assertThat(view.items())
        .extracting(BoardListItemResponse::name)
        .containsExactly("Paper towels");
    assertThat(view.boughtToday()).extracting(BoardListItemResponse::name).containsExactly("Rice");
    assertThat(view.list().openCount()).isEqualTo(1);

    // Undo puts it back; buying again is fine.
    assertThat(lists.unbuy(householdId, rice, auth(ana)).boughtAt()).isNull();
    lists.buy(householdId, rice, auth(ana));
    lists.buy(householdId, towels, auth(ben));
    // Re-adding a bought name makes a new open item; undo then keeps the open one.
    UUID riceAgain =
        lists.addItem(householdId, shopping, item("Rice", null), auth(owner)).item().id();
    assertThat(riceAgain).isNotEqualTo(rice);
    assertThat(lists.unbuy(householdId, rice, auth(ana)).id()).isEqualTo(riceAgain);
    assertThat(count("SELECT COUNT(*) FROM board_list_items WHERE id=?", rice)).isZero();

    // The next household day: hidden; 24 hours after buying: deleted by the nightly job.
    pinClock(Instant.parse("2030-03-14T08:00:00Z"));
    assertThat(lists.items(householdId, shopping, auth(ben)).boughtToday()).isEmpty();
    assertThat(lists.runRetention()).isZero();
    assertThat(count("SELECT COUNT(*) FROM board_list_items WHERE id=?", towels)).isEqualTo(1);
    pinClock(Instant.parse("2030-03-14T12:01:00Z"));
    assertThat(lists.runRetention()).isEqualTo(1);
    assertThat(count("SELECT COUNT(*) FROM board_list_items WHERE id=?", towels)).isZero();
    // The names stay for suggestions.
    assertThat(lists.recentNames(householdId, auth(ben))).contains("Rice", "Paper towels");
  }

  // ---- People ----------------------------------------------------------------------------------

  @Test
  void memberExitReleasesTheirClaimsAndKeepsTheirItems() {
    UUID shopping = shoppingId();
    UUID bags =
        lists.addItem(householdId, shopping, item("Garbage bags", null), auth(ana)).item().id();
    lists.claim(householdId, bags, auth(ana));

    householdService.removeMember(householdId, ana, auth(owner));

    BoardListItemResponse after =
        lists.items(householdId, shopping, auth(owner)).items().getFirst();
    assertThat(after.id()).isEqualTo(bags);
    assertThat(after.claimedByUserId()).isNull();
    assertThat(after.addedByDisplayName()).isEqualTo("Former member");
  }

  @Test
  void nonMembersGetNotFound() {
    UUID shopping = shoppingId();
    UUID item = lists.addItem(householdId, shopping, item("Milk", null), auth(ana)).item().id();
    UUID stranger = createUser("Stranger");
    createHousehold(stranger);

    assertThatThrownBy(() -> lists.lists(householdId, auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThatThrownBy(() -> lists.items(householdId, shopping, auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThatThrownBy(
            () -> lists.addItem(householdId, shopping, item("Eggs", null), auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThatThrownBy(() -> lists.claim(householdId, item, auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThatThrownBy(() -> lists.recentNames(householdId, auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private void pinClock(Instant instant) {
    lists.useClock(Clock.fixed(instant, ZoneOffset.UTC));
  }

  private UUID shoppingId() {
    return lists.lists(householdId, auth(owner)).lists().getFirst().id();
  }

  private UUID idOf(UUID listId, String name) {
    return jdbc.queryForObject(
        "SELECT id FROM board_list_items WHERE list_id=? AND name=? AND bought_at IS NULL",
        UUID.class,
        listId,
        name);
  }

  private static BoardListItemRequest item(String name, String note) {
    return new BoardListItemRequest(name, note);
  }

  private UUID add(UUID listId, String name) {
    return lists.addItem(householdId, listId, item(name, null), auth(owner)).item().id();
  }

  private record Pending(UUID recipient, Instant at, String message) {}

  /** Scheduled (deferred) pushes still pending for the list. */
  private List<Pending> scheduled(UUID listId) {
    return jdbc.query(
        """
            SELECT recipient_user_id, scheduled_at, message FROM notifications
            WHERE reference_id=? AND status='PENDING' AND deduplication_key NOT LIKE '%:event%'
            """,
        (rs, row) ->
            new Pending(
                rs.getObject("recipient_user_id", UUID.class),
                rs.getObject("scheduled_at", OffsetDateTime.class).toInstant(),
                rs.getString("message")),
        listId);
  }

  /** Pushes that went out (immediately, or delivered by the scheduler). */
  private List<UUID> sent(UUID listId) {
    return jdbc.queryForList(
        """
            SELECT recipient_user_id FROM notifications WHERE reference_id=?
              AND (deduplication_key LIKE '%:event%' OR status='SENT')
              AND status<>'CANCELLED'
            """,
        UUID.class, listId);
  }

  private List<String> titles(UUID recipient) {
    return jdbc.queryForList(
        "SELECT title FROM notifications WHERE reference_type='BOARD_LIST' AND recipient_user_id=?",
        String.class,
        recipient);
  }

  private List<UUID> pushes() {
    return jdbc.queryForList(
        """
            SELECT recipient_user_id FROM notifications
            WHERE reference_type='BOARD_LIST' AND type='BOARD_LIST_NEEDED_TODAY'
            ORDER BY created_at, id
            """,
        UUID.class);
  }

  private List<String> messages(UUID recipient) {
    return jdbc.queryForList(
        """
            SELECT message FROM notifications
            WHERE reference_type='BOARD_LIST' AND recipient_user_id=? ORDER BY created_at, id
            """,
        String.class,
        recipient);
  }

  private int count(String query, Object... args) {
    Integer value = jdbc.queryForObject(query, Integer.class, args);
    return value == null ? 0 : value;
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "lists-" + name.toLowerCase() + "-" + id + "@example.test",
        name);
    return id;
  }

  private UUID createHousehold(UUID ownerId) {
    UUID id = UUID.randomUUID();
    householdIds.add(id);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Lists', 'UTC', ?)",
        id,
        ownerId);
    addMember(id, ownerId, "OWNER");
    return id;
  }

  private void addMember(UUID household, UUID userId, String role) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', NOW() + make_interval(secs => ?))
            """,
        household,
        userId,
        role,
        joinOrder++);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
