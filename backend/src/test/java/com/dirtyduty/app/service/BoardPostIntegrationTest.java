package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.board.BoardPostRequest;
import com.dirtyduty.app.dto.board.BoardPostResponse;
import com.dirtyduty.app.dto.board.BoardReaderResponse;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Household Board posts on real PostgreSQL: permissions, lifecycle and retention, notify modes,
 * event reminders, Remind's limit, seen batching, and cleanup when people leave.
 *
 * <p>The board's clock is pinned to Wednesday 2030-03-13 12:00 UTC (the household's zone), well in
 * the future so scheduled reminders stay pending.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class BoardPostIntegrationTest {
  private static final Instant START = Instant.parse("2030-03-13T12:00:00Z");
  private static final LocalDate TODAY = LocalDate.of(2030, 3, 13);
  private static final String PASSWORD = "Board-test-password-1";

  @Autowired private JdbcTemplate jdbc;
  @Autowired private BoardPostService board;
  @Autowired private HouseholdService householdService;
  @Autowired private AuthService authService;
  @Autowired private PasswordEncoder passwordEncoder;
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
    board.useClock(null);
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
      jdbc.update("DELETE FROM board_posts WHERE household_id=?", id);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", id);
      jdbc.update("DELETE FROM households WHERE id=?", id);
    }
    for (UUID id : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", id);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", id);
      jdbc.update("DELETE FROM users WHERE id=?", id);
    }
  }

  // ---- Permissions -----------------------------------------------------------------------------

  @Test
  void membersPostAndReactAuthorsEditTheirOwnAndOwnersAndAdminsManageEverything() {
    BoardPostResponse post = board.create(householdId, headsUp("Guests staying"), auth(ana));
    assertThat(post.viewer().canEdit()).isTrue();
    assertThat(board.get(householdId, post.id(), auth(ben)).viewer())
        .satisfies(
            viewer -> {
              assertThat(viewer.canEdit()).isFalse();
              assertThat(viewer.canDelete()).isFalse();
              assertThat(viewer.canRemind()).isFalse();
            });
    assertThat(board.get(householdId, post.id(), auth(owner)).viewer().canDelete()).isTrue();

    // Another member may not edit, delete or remind; the author may edit.
    assertThatThrownBy(() -> board.update(householdId, post.id(), headsUp("Changed"), auth(ben)))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    assertThatThrownBy(() -> board.delete(householdId, post.id(), auth(ben)))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    assertThatThrownBy(() -> board.remind(householdId, post.id(), auth(ben)))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    assertThat(board.update(householdId, post.id(), headsUp("Guests Fri–Sun"), auth(ana)))
        .satisfies(
            updated -> {
              assertThat(updated.title()).isEqualTo("Guests Fri–Sun");
              assertThat(updated.editedAt()).isNotNull();
            });

    // Only owners and admins pin, on create or edit.
    assertThatThrownBy(() -> board.create(householdId, pinned(headsUp("Wi-Fi")), auth(ben)))
        .isInstanceOf(HouseholdAccessDeniedException.class)
        .hasMessage("Only owners and admins can pin posts.");
    assertThatThrownBy(
            () -> board.update(householdId, post.id(), pinned(headsUp("Guests")), auth(ana)))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    jdbc.update(
        "UPDATE household_memberships SET role='ADMIN' WHERE household_id=? AND user_id=?",
        householdId,
        ben);
    assertThat(board.update(householdId, post.id(), pinned(headsUp("Guests")), auth(ben)).pinned())
        .isTrue();
    board.delete(householdId, post.id(), auth(owner));
    assertThat(board.board(householdId, auth(ana)).posts()).isEmpty();

    // Anyone outside the household gets 404, for the board and for a post.
    UUID stranger = createUser("Stranger");
    assertThatThrownBy(() -> board.board(householdId, auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
    UUID other = board.create(householdId, headsUp("Quiet please"), auth(ana)).id();
    assertThatThrownBy(() -> board.gotIt(householdId, other, auth(stranger)))
        .isInstanceOf(ResourceNotFoundException.class);
  }

  // ---- Lifecycle and retention -----------------------------------------------------------------

  @Test
  void postsMoveToPastWhenTheirTimeIsUpAndPinnedPostsNeverDo() {
    UUID event =
        board.create(householdId, event("Pest control", TODAY.plusDays(1)), auth(ana)).id();
    UUID headsUp = board.create(householdId, headsUp("Package"), auth(ana)).id();
    UUID problem = board.create(householdId, problem("Washing machine leaking"), auth(ana)).id();
    UUID wifi = board.create(householdId, pinned(headsUp("Wi-Fi: HomeNet")), auth(owner)).id();

    // A problem has one handler; anyone may release it, and fixing moves it to Past.
    board.handle(householdId, problem, auth(ben));
    assertThatThrownBy(() -> board.handle(householdId, problem, auth(ana)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("Ben is already handling it.");
    assertThat(board.release(householdId, problem, auth(ana)).handlerUserId()).isNull();
    assertThat(board.handle(householdId, problem, auth(ana)).handlerDisplayName()).isEqualTo("Ana");
    BoardPostResponse fixed = board.fix(householdId, problem, auth(ben));
    assertThat(fixed.pastAt()).isEqualTo(START.atOffset(ZoneOffset.UTC));
    assertThat(fixed.fixedByDisplayName()).isEqualTo("Ben");
    assertThatThrownBy(() -> board.fix(householdId, problem, auth(ana)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("Already fixed by Ben.");

    // The event is active through the end of its date (household time), then Past.
    pinClock(TODAY.plusDays(1).atTime(23, 59).toInstant(ZoneOffset.UTC));
    assertThat(activeIds()).contains(event);
    pinClock(TODAY.plusDays(2).atStartOfDay().toInstant(ZoneOffset.UTC));
    assertThat(activeIds()).doesNotContain(event).contains(headsUp);
    assertThat(pastAt(event)).isEqualTo(TODAY.plusDays(2).atStartOfDay().atOffset(ZoneOffset.UTC));

    // A heads-up lasts 7 days; pinned info never expires until unpinned.
    pinClock(START.plus(Duration.ofDays(7)));
    assertThat(activeIds()).containsExactly(wifi);
    assertThat(pastAt(headsUp)).isEqualTo(START.plus(Duration.ofDays(7)).atOffset(ZoneOffset.UTC));
    assertThat(board.past(householdId, auth(ben)))
        .extracting(BoardPostResponse::id)
        .containsExactly(headsUp, event, problem);
    pinClock(START.plus(Duration.ofDays(9)));
    board.update(householdId, wifi, headsUp("Wi-Fi: HomeNet"), auth(owner));
    assertThat(pastAt(wifi)).isNull();
    BoardPostRequest unpin =
        new BoardPostRequest(
            "HEADS_UP", "Wi-Fi: HomeNet", null, null, null, null, false, null, null);
    board.update(householdId, wifi, unpin, auth(owner));
    assertThat(pastAt(wifi)).isEqualTo(START.plus(Duration.ofDays(9)).atOffset(ZoneOffset.UTC));
    assertThat(board.board(householdId, auth(ana)).pastCount()).isEqualTo(4);
    assertThatThrownBy(() -> board.update(householdId, wifi, headsUp("Again"), auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class);
  }

  @Test
  void nightlyRetentionExpiresPostsAndDeletesThemThirtyDaysAfterTheyBecamePast() {
    UUID old = board.create(householdId, headsUp("Old news"), auth(ana)).id();
    pinClock(START.plus(Duration.ofDays(3)));
    UUID newer = board.create(householdId, headsUp("Newer news"), auth(ana)).id();
    board.seen(householdId, List.of(old, newer), auth(ben));

    // Nobody reads the board: the nightly job still moves both to Past on time...
    pinClock(START.plus(Duration.ofDays(11)));
    board.runRetention();
    assertThat(pastAt(old)).isEqualTo(START.plus(Duration.ofDays(7)).atOffset(ZoneOffset.UTC));
    assertThat(pastAt(newer)).isEqualTo(START.plus(Duration.ofDays(10)).atOffset(ZoneOffset.UTC));

    // ...and deletes each one (with its reads) 30 days after it became Past.
    pinClock(START.plus(Duration.ofDays(37)).plusSeconds(1));
    board.runRetention();
    assertThat(exists(old)).isFalse();
    assertThat(exists(newer)).isTrue();
    assertThat(count("SELECT COUNT(*) FROM board_post_reads WHERE post_id=?", old)).isZero();
    pinClock(START.plus(Duration.ofDays(40)).plusSeconds(1));
    board.runRetention();
    assertThat(exists(newer)).isFalse();
  }

  // ---- Notify modes and reminders --------------------------------------------------------------

  @Test
  void notifyModesDecideWhoHearsAboutAPostAndTheAuthorNeverDoes() {
    UUID everyone = board.create(householdId, headsUp("Quiet please"), auth(owner)).id();
    assertThat(recipients(everyone, "BOARD_POST_NEW")).containsExactlyInAnyOrder(ana, ben);

    BoardPostRequest picked =
        new BoardPostRequest(
            "HEADS_UP",
            "Package for Ben",
            null,
            null,
            null,
            null,
            null,
            "PICKED",
            List.of(ben, owner));
    BoardPostResponse forBen = board.create(householdId, picked, auth(owner));
    assertThat(recipients(forBen.id(), "BOARD_POST_NEW")).containsExactly(ben);
    assertThat(forBen.recipientUserIds()).containsExactly(ben);
    assertThat(board.get(householdId, forBen.id(), auth(ben)).viewer().forYou()).isTrue();
    // Everyone still sees it.
    assertThat(board.get(householdId, forBen.id(), auth(ana)).viewer().forYou()).isFalse();

    BoardPostRequest quiet =
        new BoardPostRequest(
            "EVENT", "Guests", null, TODAY.plusDays(2), null, null, null, "NONE", null);
    UUID none = board.create(householdId, quiet, auth(owner)).id();
    assertThat(recipients(none, null)).isEmpty();

    assertThatThrownBy(
            () ->
                board.create(
                    householdId,
                    new BoardPostRequest(
                        "HEADS_UP",
                        "Nobody",
                        null,
                        null,
                        null,
                        null,
                        null,
                        "PICKED",
                        List.of(owner)),
                    auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Pick at least one person to notify.");
  }

  @Test
  void eventRemindersArePlannedAndReplannedWhenTheDateMovesWhichAlsoResetsGotIt() {
    BoardPostRequest request =
        new BoardPostRequest(
            "EVENT",
            "Pest control visit",
            "Clear under the sinks.",
            TODAY.plusDays(2),
            LocalTime.of(10, 0),
            LocalTime.of(12, 0),
            null,
            null,
            null);
    UUID post = board.create(householdId, request, auth(owner)).id();
    assertThat(pendingReminders(post))
        .containsExactlyInAnyOrder(
            reminder(ana, "2030-03-14T19:00:00Z"),
            reminder(ben, "2030-03-14T19:00:00Z"),
            reminder(ana, "2030-03-15T08:00:00Z"),
            reminder(ben, "2030-03-15T08:00:00Z"));
    assertThat(
            jdbc.queryForObject(
                "SELECT message FROM notifications WHERE reference_id=? AND recipient_user_id=?"
                    + " AND type='BOARD_EVENT_REMINDER' ORDER BY scheduled_at LIMIT 1",
                String.class,
                post,
                ana))
        .isEqualTo("Pest control visit is tomorrow at 10 AM.");

    board.gotIt(householdId, post, auth(ana));
    board.seen(householdId, List.of(post), auth(ben));
    BoardPostRequest moved =
        new BoardPostRequest(
            "EVENT",
            "Pest control visit",
            "Clear under the sinks.",
            TODAY.plusDays(3),
            LocalTime.of(10, 0),
            LocalTime.of(12, 0),
            null,
            null,
            null);
    BoardPostResponse after = board.update(householdId, post, moved, auth(owner));

    assertThat(pendingReminders(post))
        .containsExactlyInAnyOrder(
            reminder(ana, "2030-03-15T19:00:00Z"),
            reminder(ben, "2030-03-15T19:00:00Z"),
            reminder(ana, "2030-03-16T08:00:00Z"),
            reminder(ben, "2030-03-16T08:00:00Z"));
    assertThat(
            count(
                "SELECT COUNT(*) FROM notifications WHERE reference_id=? AND status='CANCELLED'"
                    + " AND type='BOARD_EVENT_REMINDER'",
                post))
        .isEqualTo(4);
    assertThat(
            jdbc.queryForList(
                "SELECT message FROM notifications WHERE reference_id=? AND type='BOARD_POST_CHANGED'",
                String.class,
                post))
        .containsOnly("Pest control visit moved to Sat, Mar 16, 10 AM–12 PM")
        .hasSize(2);
    assertThat(after.gotItCount()).isZero();
    assertThat(after.seenCount()).isEqualTo(2);

    // Created the evening before after 7 PM: only the morning reminder is still ahead.
    pinClock(Instant.parse("2030-03-13T20:00:00Z"));
    UUID late =
        board
            .create(
                householdId,
                new BoardPostRequest(
                    "EVENT", "Plumber", null, TODAY.plusDays(1), null, null, null, null, null),
                auth(ana))
            .id();
    assertThat(pendingReminders(late))
        .containsExactlyInAnyOrder(
            reminder(owner, "2030-03-14T08:00:00Z"), reminder(ben, "2030-03-14T08:00:00Z"));
  }

  // ---- Remind and Seen -------------------------------------------------------------------------

  @Test
  void remindReachesWhoHasntSeenItOnceEveryTwoHours() {
    UUID post = board.create(householdId, problem("Fridge door broken"), auth(ana)).id();
    board.seen(householdId, List.of(post), auth(owner));

    BoardPostResponse reminded = board.remind(householdId, post, auth(ana));
    assertThat(recipients(post, "BOARD_POST_REMIND")).containsExactly(ben);
    assertThat(reminded.viewer().remindAgainAt())
        .isEqualTo(START.plus(Duration.ofHours(2)).atOffset(ZoneOffset.UTC));
    assertThatThrownBy(() -> board.remind(householdId, post, auth(owner)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("Already reminded at 12:00 PM.");

    pinClock(START.plus(Duration.ofHours(2)).plusSeconds(1));
    board.remind(householdId, post, auth(owner));
    assertThat(recipients(post, "BOARD_POST_REMIND")).containsExactly(ben, ben);

    pinClock(START.plus(Duration.ofHours(5)));
    board.seen(householdId, List.of(post), auth(ben));
    assertThatThrownBy(() -> board.remind(householdId, post, auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Everyone has seen this post.");
  }

  @Test
  void remindOnAPickedPostReachesOnlyThePickedPeopleWhoHaventSeenIt() {
    BoardPostRequest forBen =
        new BoardPostRequest(
            "HEADS_UP", "Package for Ben", null, null, null, null, null, "PICKED", List.of(ben));
    UUID picked = board.create(householdId, forBen, auth(ana)).id();
    // The owner hasn't seen it either, but wasn't picked.
    board.remind(householdId, picked, auth(ana));
    assertThat(recipients(picked, "BOARD_POST_REMIND")).containsExactly(ben);

    // NONE still reminds everyone who hasn't seen it.
    BoardPostRequest quiet =
        new BoardPostRequest(
            "HEADS_UP", "Quiet please", null, null, null, null, null, "NONE", null);
    UUID none = board.create(householdId, quiet, auth(ana)).id();
    board.remind(householdId, none, auth(ana));
    assertThat(recipients(none, "BOARD_POST_REMIND")).containsExactlyInAnyOrder(owner, ben);

    // Once the picked person has seen it, there is nobody left to remind.
    pinClock(START.plus(Duration.ofHours(3)));
    board.seen(householdId, List.of(picked), auth(ben));
    assertThatThrownBy(() -> board.remind(householdId, picked, auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Everyone has seen this post.");
  }

  @Test
  void seenIsBatchedIdempotentAndLeavesTheAuthorOut() {
    UUID first = board.create(householdId, headsUp("Bins out Monday"), auth(owner)).id();
    UUID second = board.create(householdId, headsUp("Quiet please"), auth(ana)).id();
    UUID otherHousehold = createHousehold(ben);
    UUID elsewhere = board.create(otherHousehold, headsUp("Not yours"), auth(ben)).id();
    assertThat(board.board(householdId, auth(ana)).unseenCount()).isEqualTo(1);

    board.seen(householdId, List.of(first, second, elsewhere), auth(ana));
    OffsetDateTime seenAt =
        jdbc.queryForObject(
            "SELECT seen_at FROM board_post_reads WHERE post_id=? AND user_id=?",
            OffsetDateTime.class,
            first,
            ana);
    pinClock(START.plusSeconds(60));
    board.seen(householdId, List.of(first, second), auth(ana));

    assertThat(count("SELECT COUNT(*) FROM board_post_reads WHERE user_id=?", ana)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT seen_at FROM board_post_reads WHERE post_id=? AND user_id=?",
                OffsetDateTime.class,
                first,
                ana))
        .isEqualTo(seenAt);
    assertThat(board.unseenCount(householdId, auth(ana))).isZero();
    BoardPostResponse view = board.get(householdId, first, auth(owner));
    assertThat(view.seenCount()).isEqualTo(1);
    assertThat(view.audienceCount()).isEqualTo(2);
    assertThat(view.readers())
        .extracting(BoardReaderResponse::displayName, BoardReaderResponse::author)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("Owen", true),
            org.assertj.core.groups.Tuple.tuple("Ana", false),
            org.assertj.core.groups.Tuple.tuple("Ben", false));
  }

  // ---- Leaving
  // -----------------------------------------------------------------------------------

  @Test
  void memberExitAndAccountDeletionKeepPostsAndCleanUpRecipientsReadsAndHandlers() {
    BoardPostRequest forAna =
        new BoardPostRequest(
            "HEADS_UP", "Package for Ana", null, null, null, null, null, "PICKED", List.of(ana));
    UUID picked = board.create(householdId, forAna, auth(owner)).id();
    UUID anasPost = board.create(householdId, problem("Shower drain slow"), auth(ana)).id();
    UUID bensPost = board.create(householdId, headsUp("Guests Saturday"), auth(ben)).id();
    board.handle(householdId, anasPost, auth(ana));
    board.seen(householdId, List.of(picked, bensPost), auth(ana));
    board.gotIt(householdId, picked, auth(ben));

    householdService.removeMember(householdId, ana, auth(owner));

    assertThat(count("SELECT COUNT(*) FROM board_post_recipients WHERE user_id=?", ana)).isZero();
    assertThat(count("SELECT COUNT(*) FROM board_post_reads WHERE user_id=?", ana)).isZero();
    BoardPostResponse problem = board.get(householdId, anasPost, auth(owner));
    assertThat(problem.handlerUserId()).isNull();
    assertThat(problem.authorDisplayName()).isEqualTo("Former member");
    assertThat(problem.viewer().canEdit()).isTrue();

    jdbc.update(
        "UPDATE users SET password_hash=? WHERE id=?", passwordEncoder.encode(PASSWORD), ben);
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, ben);
    authService.deleteAccount(email, PASSWORD, email, false);

    assertThat(exists(bensPost)).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT author_user_id FROM board_posts WHERE id=?", UUID.class, bensPost))
        .isNull();
    assertThat(count("SELECT COUNT(*) FROM board_post_reads WHERE user_id=?", ben)).isZero();
    assertThat(board.get(householdId, bensPost, auth(owner)).authorDisplayName())
        .isEqualTo("Former member");
    assertThat(board.board(householdId, auth(owner)).members()).hasSize(1);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private void pinClock(Instant instant) {
    board.useClock(Clock.fixed(instant, ZoneOffset.UTC));
  }

  private List<UUID> activeIds() {
    return board.board(householdId, auth(owner)).posts().stream()
        .map(BoardPostResponse::id)
        .toList();
  }

  private OffsetDateTime pastAt(UUID postId) {
    OffsetDateTime value =
        jdbc.queryForObject(
            "SELECT past_at FROM board_posts WHERE id=?", OffsetDateTime.class, postId);
    return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC);
  }

  private boolean exists(UUID postId) {
    return count("SELECT COUNT(*) FROM board_posts WHERE id=?", postId) == 1;
  }

  private int count(String query, Object... args) {
    Integer value = jdbc.queryForObject(query, Integer.class, args);
    return value == null ? 0 : value;
  }

  /** Recipients of this post's notifications of one type (any type when null), oldest first. */
  private List<UUID> recipients(UUID postId, String type) {
    return jdbc.queryForList(
        "SELECT recipient_user_id FROM notifications WHERE reference_type='BOARD_POST'"
            + " AND reference_id=? AND (?::text IS NULL OR type=?) ORDER BY created_at, id",
        UUID.class,
        postId,
        type,
        type);
  }

  private List<Map.Entry<UUID, Instant>> pendingReminders(UUID postId) {
    return jdbc.query(
        """
            SELECT recipient_user_id, scheduled_at FROM notifications
            WHERE reference_type='BOARD_POST' AND reference_id=? AND type='BOARD_EVENT_REMINDER'
              AND status='PENDING'
            """,
        (rs, row) ->
            Map.entry(
                rs.getObject("recipient_user_id", UUID.class),
                rs.getObject("scheduled_at", OffsetDateTime.class).toInstant()),
        postId);
  }

  private static Map.Entry<UUID, Instant> reminder(UUID userId, String at) {
    return Map.entry(userId, Instant.parse(at));
  }

  private static BoardPostRequest headsUp(String title) {
    return new BoardPostRequest("HEADS_UP", title, null, null, null, null, null, null, null);
  }

  private static BoardPostRequest problem(String title) {
    return new BoardPostRequest("PROBLEM", title, null, null, null, null, null, null, null);
  }

  private static BoardPostRequest event(String title, LocalDate date) {
    return new BoardPostRequest("EVENT", title, null, date, null, null, null, null, null);
  }

  private static BoardPostRequest pinned(BoardPostRequest request) {
    return new BoardPostRequest(
        request.type(),
        request.title(),
        request.details(),
        request.eventDate(),
        request.startTime(),
        request.endTime(),
        true,
        request.notifyMode(),
        request.recipientUserIds());
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "board-" + name.toLowerCase() + "-" + id + "@example.test",
        name);
    return id;
  }

  private UUID createHousehold(UUID ownerId) {
    UUID id = UUID.randomUUID();
    householdIds.add(id);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Board', 'UTC', ?)",
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
