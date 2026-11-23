package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.dto.board.BoardPostRequest;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.service.BoardPostService;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Quiet hours on real PostgreSQL: pushes held in the recipient's window (household time zone,
 * windows crossing midnight or inside a day, DST), the in-app row created right away, and the
 * morning release (stale pushes dropped, same-subject pushes collapsed, one or two sent as
 * themselves 5 minutes apart, more grouped into named pushes). Urgent posts bypass, at most one an
 * hour. The quiet-hours clock is pinned per test.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class QuietHoursIntegrationTest {
  private static final ZoneId TORONTO = ZoneId.of("America/Toronto");

  @Autowired private JdbcTemplate jdbc;
  @Autowired private NotificationEventService events;
  @Autowired private QuietHoursService quietHours;
  @Autowired private QuietHoursRelease release;
  @Autowired private BoardPostService board;
  @Autowired private com.dirtyduty.app.service.ChoreService choreService;
  @Autowired private com.dirtyduty.app.service.OccurrenceService occurrenceService;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private final List<UUID> householdIds = new ArrayList<>();
  private UUID householdId;
  private UUID ana;
  private UUID ben;

  @BeforeEach
  void setUp() throws Exception {
    when(webPushClient.send(
            anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), any()))
        .thenReturn(201);
    ana = createUser("Ana");
    ben = createUser("Ben");
    householdId = createHousehold("America/Toronto", ana, ben);
  }

  @AfterEach
  void cleanUp() {
    quietHours.useClock(null);
    for (UUID id : householdIds) {
      jdbc.update(
          "DELETE FROM notifications WHERE event_id IN"
              + " (SELECT id FROM notification_events WHERE household_id=?)",
          id);
      jdbc.update("DELETE FROM notification_events WHERE household_id=?", id);
      jdbc.update("DELETE FROM activity_events WHERE household_id=?", id);
      jdbc.update("DELETE FROM board_posts WHERE household_id=?", id);
      jdbc.update("DELETE FROM board_lists WHERE household_id=?", id);
      jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", id);
      jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", id);
      jdbc.update(
          "DELETE FROM recurring_chore_assignment_announcements WHERE schedule_id IN"
              + " (SELECT id FROM chore_schedules WHERE household_id=?)",
          id);
      jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", id);
      jdbc.update("DELETE FROM chores WHERE household_id=?", id);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", id);
      jdbc.update("DELETE FROM households WHERE id=?", id);
    }
    for (UUID id : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", id);
      jdbc.update("DELETE FROM users WHERE id=?", id);
    }
  }

  // ---- Holding ---------------------------------------------------------------------------------

  @Test
  void offByDefaultThePushGoesAtOnce() {
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID chore = assignment("Dishes", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", chore, ana);

    assertThat(delivery(chore, ana)).containsEntry("status", "SENT");
    assertThat(delivery(chore, ana).get("quiet_held_until")).isNull();
    assertThat(pushesSent()).isEqualTo(1);
  }

  @Test
  void aPushAtElevenAtNightWaitsUntilEightInHouseholdTimeAndTheInAppRowIsThereAtOnce() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID chore = assignment("Dishes", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", chore, ana);

    assertThat(inApp(chore, ana)).isEqualTo("SENT");
    Map<String, Object> push = delivery(chore, ana);
    assertThat(push).containsEntry("status", "PENDING");
    assertThat(heldUntil(push)).isEqualTo(local(2030, 3, 14, 8, 0, TORONTO));
    assertThat(pushesSent()).isZero();

    // After midnight, still inside the window: the same morning.
    at(LocalDateTime.of(2030, 3, 14, 1, 30), TORONTO);
    UUID late = assignment("Bins", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", late, ana);
    assertThat(heldUntil(delivery(late, ana))).isEqualTo(local(2030, 3, 14, 8, 0, TORONTO));
  }

  @Test
  void aWindowInsideOneDayHoldsOnlyDuringIt() {
    quiet(ana, "13:00", "15:00");
    at(LocalDateTime.of(2030, 3, 13, 14, 0), TORONTO);
    UUID nap = assignment("Laundry", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", nap, ana);
    assertThat(heldUntil(delivery(nap, ana))).isEqualTo(local(2030, 3, 13, 15, 0, TORONTO));

    at(LocalDateTime.of(2030, 3, 13, 16, 0), TORONTO);
    UUID after = assignment("Floors", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", after, ana);
    assertThat(delivery(after, ana)).containsEntry("status", "SENT");
  }

  @Test
  void theWindowEndFollowsTheWallClockAcrossADaylightSavingChange() {
    jdbc.update("UPDATE households SET timezone='America/Halifax' WHERE id=?", householdId);
    ZoneId halifax = ZoneId.of("America/Halifax");
    quiet(ana, "22:00", "08:00");
    // Clocks spring forward in Halifax at 2 AM on Sunday, March 14 2027.
    at(LocalDateTime.of(2027, 3, 13, 23, 30), halifax);
    UUID chore = assignment("Dishes", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", chore, ana);

    OffsetDateTime until = heldUntil(delivery(chore, ana));
    assertThat(until.atZoneSameInstant(halifax).toLocalDateTime())
        .isEqualTo(LocalDateTime.of(2027, 3, 14, 8, 0));
    // 8 AM ADT is 11:00 UTC (it would be 12:00 before the change).
    assertThat(until.toInstant()).isEqualTo(Instant.parse("2027-03-14T11:00:00Z"));
  }

  @Test
  void eachRecipientIsJudgedOnTheirOwnQuietHours() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID post = board.create(householdId, headsUp("Guests tonight"), auth(ben)).id();
    UUID owen = createUser("Owen");
    addMember(householdId, owen);
    UUID second = board.create(householdId, headsUp("Pizza in the fridge"), auth(ben)).id();

    assertThat(delivery(post, ana)).containsEntry("status", "PENDING");
    assertThat(delivery(second, owen)).containsEntry("status", "SENT");
  }

  // ---- Urgent posts ----------------------------------------------------------------------------

  @Test
  void anUrgentPostNotifiesDuringQuietHoursAndOnlyOneAnHour() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID urgent = board.create(householdId, urgent("Water leak in the hall"), auth(ben)).id();
    assertThat(delivery(urgent, ana)).containsEntry("status", "SENT");
    assertThat(board.get(householdId, urgent, auth(ana)).urgent()).isTrue();

    UUID normal = board.create(householdId, headsUp("Recycling is out"), auth(ben)).id();
    assertThat(delivery(normal, ana)).containsEntry("status", "PENDING");

    assertThatThrownBy(() -> board.create(householdId, urgent("Smoke alarm"), auth(ben)))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessageMatching("You can post one urgent post an hour\\. Try again at .+\\.");
    // Others may still post one.
    assertThat(board.create(householdId, urgent("Front door stuck"), auth(ana)).urgent()).isTrue();
  }

  @Test
  void aSubscriptionWithAnInvalidKeyNeverFailsThePostThatPushed() throws Exception {
    when(webPushClient.send(
            anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), any()))
        .thenThrow(new IllegalArgumentException("Last unit does not have enough valid bits"));
    at(LocalDateTime.of(2030, 3, 13, 12, 0), TORONTO);
    UUID post = board.create(householdId, urgent("Water leak in the hall"), auth(ben)).id();

    assertThat(delivery(post, ana)).containsEntry("status", "CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT active FROM push_subscriptions WHERE user_id=?", Boolean.class, ana))
        .isFalse();
  }

  // ---- Morning release -------------------------------------------------------------------------

  @Test
  void oneHeldPushGoesAsItselfAtTheEndOfTheWindow() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID chore = assignment("Dishes", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", chore, ana);

    morning();
    // Sent at the end of the window, in the same run.
    Map<String, Object> push = delivery(chore, ana);
    assertThat(push).containsEntry("status", "SENT");
    assertThat(push.get("quiet_held_until")).isNull();
    assertThat(pushesSent()).isEqualTo(1);
    assertThat(digests(ana)).isEmpty();
  }

  @Test
  void twoHeldPushesGoMostImportantFirstThenFiveMinutesLater() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID post = board.create(householdId, headsUp("Guests Saturday"), auth(ben)).id();
    UUID chore = assignment("Take out organic", ana, null);
    publish("CHORE_OVERDUE", "CHORE_ASSIGNMENT", chore, ana);

    morning();
    // The overdue chore goes at the window end; the post 5 minutes after it.
    assertThat(delivery(chore, ana)).containsEntry("status", "SENT");
    assertThat(delivery(post, ana)).containsEntry("status", "PENDING");
    assertThat(delivery(post, ana).get("quiet_held_until")).isNull();
    assertThat(nextAttempt(delivery(post, ana))).isEqualTo(local(2030, 3, 14, 8, 5, TORONTO));
    assertThat(digests(ana)).isEmpty();
  }

  @Test
  void moreThanTwoBecomeAChoresGroupAndAnotherGroupFiveMinutesLaterNamingThem() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID organic = assignment("Take out organic", ana, null);
    UUID dishes = assignment("Dishes", ana, local(2030, 3, 14, 18, 0, TORONTO));
    publish("CHORE_DUE_SOON", "CHORE_ASSIGNMENT", dishes, ana);
    publish("CHORE_OVERDUE", "CHORE_ASSIGNMENT", organic, ana);
    UUID pest =
        board
            .create(
                householdId,
                new BoardPostRequest(
                    "EVENT",
                    "Pest control",
                    null,
                    LocalDate.of(2030, 3, 14),
                    LocalTime.of(10, 0),
                    null,
                    null,
                    null,
                    null),
                auth(ben))
            .id();
    UUID pkg =
        board
            .create(
                householdId,
                new BoardPostRequest(
                    "HEADS_UP",
                    "Package for you",
                    null,
                    null,
                    null,
                    null,
                    null,
                    "PICKED",
                    List.of(ana)),
                auth(ben))
            .id();

    morning();
    List<Map<String, Object>> digests = digests(ana);
    assertThat(digests).hasSize(2);
    assertThat(digests.getFirst())
        .containsEntry("kind", "CHORES")
        .containsEntry("message", "Take out organic is overdue · Dishes due by 6 PM")
        .containsEntry("target_path", "/?screen=my-chores");
    assertThat(sendAt(digests.getFirst())).isEqualTo(local(2030, 3, 14, 8, 0, TORONTO));
    assertThat(digests.get(1))
        .containsEntry("kind", "OTHER")
        .containsEntry("message", "Package for you · Pest control Thu 10 AM")
        .containsEntry("target_path", "/?screen=board");
    assertThat(sendAt(digests.get(1))).isEqualTo(local(2030, 3, 14, 8, 5, TORONTO));
    // The held pushes themselves never go; the in-app rows stay.
    for (UUID subject : List.of(organic, dishes, pest, pkg)) {
      assertThat(delivery(subject, ana)).containsEntry("status", "CANCELLED");
      assertThat(inApp(subject, ana)).isEqualTo("SENT");
    }

    // The grouped pushes go when due.
    release.sendDue(List.of(ana));
    assertThat(digests(ana))
        .extracting(row -> row.get("status"))
        .containsExactly("SENT", "PENDING");
    at(LocalDateTime.of(2030, 3, 14, 8, 5), TORONTO);
    release.sendDue(List.of(ana));
    assertThat(digests(ana)).extracting(row -> row.get("status")).containsExactly("SENT", "SENT");
  }

  @Test
  void manyChoresAreSummedUpAndAnEmptyGroupIsLeftOut() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    publish("CHORE_OVERDUE", "CHORE_ASSIGNMENT", assignment("Take out organic", ana, null), ana);
    publish("CHORE_DUE_NOW", "CHORE_ASSIGNMENT", assignment("Dishes", ana, null), ana);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", assignment("Vacuum", ana, null), ana);

    morning();
    List<Map<String, Object>> digests = digests(ana);
    assertThat(digests).hasSize(1);
    assertThat(digests.getFirst())
        .containsEntry("kind", "CHORES")
        .containsEntry("message", "Take out organic is overdue, plus 2 more chores today");
    assertThat(sendAt(digests.getFirst())).isEqualTo(local(2030, 3, 14, 8, 0, TORONTO));
  }

  @Test
  void aChoresDueSoonAndOverdueCollapseToOverdueAndStalePushesAreDropped() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID organic = assignment("Take out organic", ana, null);
    publish("CHORE_DUE_SOON", "CHORE_ASSIGNMENT", organic, ana);
    publish("CHORE_OVERDUE", "CHORE_ASSIGNMENT", organic, ana);
    UUID done = assignment("Dishes", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", done, ana);
    jdbc.update("UPDATE chore_assignments SET status='COMPLETED' WHERE id=?", done);

    morning();
    // One left: the overdue reminder, as itself.
    assertThat(deliveries(organic, ana))
        .containsEntry("CHORE_OVERDUE", "SENT")
        .containsEntry("CHORE_DUE_SOON", "CANCELLED");
    assertThat(delivery(done, ana))
        .containsEntry("status", "CANCELLED")
        .containsEntry("last_error", "No longer applies after quiet hours.");
    assertThat(digests(ana)).isEmpty();
  }

  @Test
  void aNewJobAndItsNeedsDoingCollapseToNeedsDoing() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    jdbc.update(
        "UPDATE household_memberships SET role='ADMIN' WHERE household_id=? AND user_id=?",
        householdId,
        ben);
    UUID chore =
        choreService
            .createChore(
                householdId,
                new com.dirtyduty.app.dto.chore.ChoreRequest(
                    "Towels",
                    null,
                    null,
                    null,
                    null,
                    null,
                    false,
                    new com.dirtyduty.app.dto.chore.ChoreScheduleRequest(
                        null,
                        null,
                        null,
                        null,
                        null,
                        com.dirtyduty.app.entity.enums.AssignmentStrategy.ROUND_ROBIN,
                        null,
                        List.of(ana),
                        1,
                        com.dirtyduty.app.entity.enums.ScheduleKind.AS_NEEDED,
                        null,
                        null,
                        false,
                        null)),
                auth(ben))
            .id();
    UUID open =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE chore_id=? AND status='PENDING'",
            UUID.class,
            chore);
    occurrenceService.flag(householdId, open, auth(ben));
    UUID schedule =
        jdbc.queryForObject("SELECT id FROM chore_schedules WHERE chore_id=?", UUID.class, chore);
    assertThat(delivery(schedule, ana)).containsEntry("status", "PENDING");
    assertThat(delivery(open, ana)).containsEntry("status", "PENDING");

    morning();
    // One job, one push: "needs doing" goes as itself; "New shared job" is replaced by it.
    assertThat(delivery(open, ana)).containsEntry("status", "SENT");
    assertThat(delivery(open, ana).get("quiet_held_until")).isNull();
    assertThat(delivery(schedule, ana))
        .containsEntry("status", "CANCELLED")
        .containsEntry("last_error", "Replaced by a newer push after quiet hours.");
    assertThat(digests(ana)).isEmpty();
  }

  @Test
  void aHeldPushWhoseInAppRowIsntLiveYetGoesBackToTheNormalFlowInsteadOfBeingDropped() {
    quiet(ana, "22:00", "08:00");
    at(LocalDateTime.of(2030, 3, 13, 23, 0), TORONTO);
    UUID chore = assignment("Dishes", ana, null);
    publish("CHORE_ASSIGNED", "CHORE_ASSIGNMENT", chore, ana);
    // As if a reminder cooldown had kept the in-app row back while its push was held.
    jdbc.update(
        "UPDATE notifications SET status='PENDING', sent_at=NULL WHERE reference_id=?", chore);

    morning();
    Map<String, Object> push = delivery(chore, ana);
    assertThat(push).containsEntry("status", "PENDING");
    assertThat(push.get("quiet_held_until")).isNull();
    assertThat(push.get("next_attempt_at")).isNull();
    assertThat(push.get("last_error")).isNull();
    assertThat(digests(ana)).isEmpty();
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private void at(LocalDateTime local, ZoneId zone) {
    quietHours.useClock(Clock.fixed(local.atZone(zone).toInstant(), ZoneOffset.UTC));
  }

  /** The end of the window, as the scheduler would release it. */
  private void morning() {
    at(LocalDateTime.of(2030, 3, 14, 8, 0), TORONTO);
    release.releaseDue(List.of(ana, ben));
  }

  private static OffsetDateTime local(int y, int m, int d, int h, int min, ZoneId zone) {
    return LocalDateTime.of(y, m, d, h, min).atZone(zone).toOffsetDateTime();
  }

  private void quiet(UUID user, String start, String end) {
    jdbc.update(
        """
            UPDATE notification_preferences
            SET quiet_hours_enabled=TRUE, quiet_hours_start=?::time, quiet_hours_end=?::time
            WHERE user_id=?
            """,
        start,
        end,
        user);
  }

  private void publish(String type, String referenceType, UUID referenceId, UUID recipient) {
    events.publish(
        new NotificationEvent(
            type,
            null,
            householdId,
            referenceType,
            referenceId,
            "CHORE_REMINDER",
            Map.of(
                "chore_name",
                "a chore",
                "due_time",
                "6 PM",
                "hours_late",
                "1",
                "due_date",
                "today"),
            List.of(recipient)));
  }

  private Map<String, Object> delivery(UUID referenceId, UUID recipient) {
    return jdbc.queryForMap(
        """
            SELECT d.status, d.quiet_held_until, d.next_attempt_at, d.last_error
            FROM notifications n
            JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='WEB_PUSH'
            WHERE n.reference_id=? AND n.recipient_user_id=?
            ORDER BY n.created_at DESC LIMIT 1
            """,
        referenceId,
        recipient);
  }

  private Map<String, Object> deliveries(UUID referenceId, UUID recipient) {
    Map<String, Object> byType = new java.util.HashMap<>();
    jdbc.query(
        """
            SELECT n.type, d.status FROM notifications n
            JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='WEB_PUSH'
            WHERE n.reference_id=? AND n.recipient_user_id=?
            """,
        rs -> {
          byType.put(rs.getString("type"), rs.getString("status"));
        },
        referenceId,
        recipient);
    return byType;
  }

  private String inApp(UUID referenceId, UUID recipient) {
    return jdbc.queryForObject(
        "SELECT status FROM notifications WHERE reference_id=? AND recipient_user_id=?"
            + " ORDER BY created_at DESC LIMIT 1",
        String.class,
        referenceId,
        recipient);
  }

  private static OffsetDateTime heldUntil(Map<String, Object> delivery) {
    return offset(delivery.get("quiet_held_until"));
  }

  private static OffsetDateTime nextAttempt(Map<String, Object> delivery) {
    return offset(delivery.get("next_attempt_at"));
  }

  private static OffsetDateTime sendAt(Map<String, Object> digest) {
    return offset(digest.get("send_at"));
  }

  private static OffsetDateTime offset(Object value) {
    if (value == null) {
      return null;
    }
    Instant instant =
        value instanceof java.sql.Timestamp timestamp
            ? timestamp.toInstant()
            : ((OffsetDateTime) value).toInstant();
    return instant.atZone(TORONTO).toOffsetDateTime();
  }

  private List<Map<String, Object>> digests(UUID recipient) {
    return jdbc.queryForList(
        """
            SELECT kind, message, target_path, send_at, status FROM notification_push_digests
            WHERE recipient_user_id=? ORDER BY send_at, kind
            """,
        recipient);
  }

  private int pushesSent() {
    return (int)
        mockingDetails(webPushClient).getInvocations().stream()
            .filter(invocation -> invocation.getMethod().getName().equals("send"))
            .count();
  }

  private UUID assignment(String title, UUID assignee, OffsetDateTime dueAt) {
    UUID chore = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO chores (id, household_id, title, created_by_user_id) VALUES (?, ?, ?, ?)",
        chore,
        householdId,
        title,
        assignee);
    UUID id = UUID.randomUUID();
    LocalDate day = dueAt == null ? LocalDate.of(2030, 3, 14) : dueAt.toLocalDate();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, assigned_to_user_id, scheduled_for, planned_for, due_at,
                 status, title_snapshot, priority_snapshot, difficulty_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'NORMAL', 1)
            """,
        id,
        householdId,
        chore,
        assignee,
        day,
        day,
        dueAt,
        title);
    jdbc.update(
        "INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)"
            + " VALUES (?, ?, ?)",
        householdId,
        id,
        assignee);
    return id;
  }

  private static BoardPostRequest headsUp(String title) {
    return new BoardPostRequest("HEADS_UP", title, null, null, null, null, null, null, null);
  }

  private static BoardPostRequest urgent(String title) {
    return new BoardPostRequest("HEADS_UP", title, null, null, null, null, null, null, null, true);
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "quiet-" + name.toLowerCase() + "-" + id + "@example.test",
        name);
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled) VALUES (?, TRUE)", id);
    jdbc.update(
        """
            INSERT INTO push_subscriptions (user_id, endpoint, public_key, auth_secret)
            VALUES (?, ?, 'key', 'secret')
            """,
        id,
        "https://push.example.test/" + id);
    clearInvocations(webPushClient);
    return id;
  }

  private UUID createHousehold(String timezone, UUID owner, UUID... members) {
    UUID id = UUID.randomUUID();
    householdIds.add(id);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Quiet', ?, ?)",
        id,
        timezone,
        owner);
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
            """,
        id,
        owner);
    for (UUID member : members) {
      addMember(id, member);
    }
    return id;
  }

  private void addMember(UUID household, UUID userId) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, 'MEMBER', 'ACTIVE', NOW() + INTERVAL '1 second')
            """,
        household,
        userId);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
