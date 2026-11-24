package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreRequestCreate;
import com.dirtyduty.app.dto.chore.ChoreRequestResponse;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.chore.RequestCandidatesResponse;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.QuietHoursService;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Hand-off and swap requests (E11) on real PostgreSQL. The household is in UTC; chores start
 * tomorrow at 6 PM so their deadlines are always ahead of the pinned clock, which is taken from the
 * system clock because generation reads the system date.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class ChoreRequestIntegrationTest {
  private static final LocalTime SIX_PM = LocalTime.of(18, 0);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private ChoreRequestService requests;
  @Autowired private MembershipExitCleanupService exitCleanup;
  @Autowired private QuietHoursService quietHours;
  @Autowired private EffortLedger effortLedger;
  @Autowired private TransactionTemplate transactions;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private UUID cy;
  private LocalDate today;
  private LocalDate tomorrow;
  private OffsetDateTime now;

  @BeforeEach
  void setUp() {
    now = OffsetDateTime.ofInstant(Instant.now().truncatedTo(ChronoUnit.SECONDS), ZoneOffset.UTC);
    today = now.toLocalDate();
    tomorrow = today.plusDays(1);
    pinClocks(now);
    owner = createUser("Oli");
    ana = createUser("Ana");
    ben = createUser("Ben");
    cy = createUser("Cy");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Requests', 'UTC', ?)",
        householdId,
        owner);
    addMember(owner, "OWNER");
    addMember(ana, "MEMBER");
    addMember(ben, "MEMBER");
    addMember(cy, "MEMBER");
  }

  @AfterEach
  void cleanFixtures() {
    requests.useClock(null);
    occurrenceService.useClock(null);
    quietHours.useClock(null);
    String notificationIds =
        """
        SELECT n.id FROM notifications n
        WHERE n.recipient_user_id IN (SELECT user_id FROM household_memberships
                                      WHERE household_id=?)
           OR n.event_id IN (SELECT id FROM notification_events WHERE household_id=?)
        """;
    jdbc.update(
        "DELETE FROM notification_push_delivery_targets WHERE notification_id IN ("
            + notificationIds
            + ")",
        householdId,
        householdId);
    jdbc.update(
        "DELETE FROM notification_deliveries WHERE notification_id IN (" + notificationIds + ")",
        householdId,
        householdId);
    jdbc.update(
        "DELETE FROM notifications WHERE id IN (" + notificationIds + ")",
        householdId,
        householdId);
    jdbc.update("DELETE FROM notification_events WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM activity_events WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM chore_requests WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM member_away_periods WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM chore_completions WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", householdId);
    jdbc.update(
        "DELETE FROM recurring_chore_assignment_announcements WHERE schedule_id IN "
            + "(SELECT id FROM chore_schedules WHERE household_id=?)",
        householdId);
    jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM households WHERE id=?", householdId);
    for (UUID userId : userIds) {
      jdbc.update("DELETE FROM push_subscriptions WHERE user_id=?", userId);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    userIds.clear();
  }

  // ---- Hand-off
  // ----------------------------------------------------------------------------------

  @Test
  void aHandOffToOnePersonMovesItToThemAndGenerationNeverMovesItBack() {
    UUID chore = weekly("Bins", AssignmentStrategy.ROUND_ROBIN, null, List.of(ana, ben), 1);
    UUID occurrence = occurrenceOn(chore, tomorrow);
    UUID asker = people(occurrence).getFirst();

    ChoreRequestResponse request = handOff(asker, occurrence, cy);
    assertThat(notified("REQUEST_HANDOFF_ASK", request.id())).containsExactly(cy);
    assertThat(card(occurrence, asker).requests().open())
        .satisfies(
            open -> {
              assertThat(open.mine()).isTrue();
              assertThat(open.waitingFor().userId()).isEqualTo(cy);
            });

    requests.accept(householdId, request.id(), auth(cy));

    assertThat(people(occurrence)).containsExactly(cy);
    assertThat(column(occurrence, "assignees_overridden", Boolean.class)).isTrue();
    AssignmentResponse.Note note = card(occurrence, cy).requests().note();
    assertThat(note.type()).isEqualTo("TAKEN_OVER");
    assertThat(note.with().userId()).isEqualTo(asker);
    assertThat(statusOf(request.id())).isEqualTo("ACCEPTED");
    assertThat(notified("REQUEST_ACCEPTED", request.id())).containsExactly(asker);

    // Generation, and a Who edit that re-plans future turns, both leave it with Cy.
    occurrenceService.generateHousehold(householdId);
    updateWho(chore, List.of(ben, ana));
    assertThat(people(occurrence)).containsExactly(cy);
  }

  @Test
  void anyoneFirstAcceptWinsAndADeclineClosesItOnlyForThatPerson() throws Exception {
    UUID chore = weekly("Dishes", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID occurrence = occurrenceOn(chore, tomorrow);
    ChoreRequestResponse request = handOff(ana, occurrence, null);
    assertThat(notified("REQUEST_HANDOFF_ASK", request.id()))
        .containsExactlyInAnyOrder(owner, ben, cy);

    requests.decline(householdId, request.id(), auth(ben));
    assertThat(statusOf(request.id())).isEqualTo("OPEN");
    assertThat(requests.list(householdId, auth(ben)).forMe()).isEmpty();
    assertThat(requests.list(householdId, auth(cy)).forMe()).hasSize(1);
    assertThat(liveAsks(request.id(), ben)).isZero();
    assertThatThrownBy(() -> requests.accept(householdId, request.id(), auth(ben)))
        .isInstanceOf(HouseholdAccessDeniedException.class);

    // Cy and the owner accept at the same moment: exactly one gets it.
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    List<Future<String>> results = new ArrayList<>();
    for (UUID taker : List.of(cy, owner)) {
      results.add(
          pool.submit(
              () -> {
                start.await();
                try {
                  requests.accept(householdId, request.id(), auth(taker));
                  return "OK";
                } catch (DuplicateResourceException conflict) {
                  return conflict.getMessage();
                }
              }));
    }
    start.countDown();
    List<String> outcomes = new ArrayList<>();
    for (Future<String> result : results) {
      outcomes.add(result.get(30, TimeUnit.SECONDS));
    }
    pool.shutdown();
    assertThat(outcomes).containsOnlyOnce("OK");
    UUID winner = people(occurrence).getFirst();
    String winnerName = winner.equals(cy) ? "Cy" : "Oli";
    assertThat(outcomes).contains(ChoreRequestService.TAKEN_PREFIX + winnerName + ".");
    assertThat(people(occurrence)).containsExactly(winner);
  }

  // ---- Swap and groups
  // ---------------------------------------------------------------------------

  @Test
  void aSwapExchangesBothAndAGroupHandsOnlyTheRequestersSlot() {
    UUID group = weekly("Garage", AssignmentStrategy.FIXED, ana, List.of(ana, ben), 2);
    UUID cyChore = weekly("Laundry", AssignmentStrategy.FIXED, cy, List.of(cy), 1);
    UUID mine = occurrenceOn(group, tomorrow);
    UUID theirs = occurrenceOn(cyChore, tomorrow);

    RequestCandidatesResponse candidates = requests.candidates(householdId, mine, auth(ana));
    // Ben is already on it, so only Oli and Cy are listed; Cy's laundry is offered.
    assertThat(candidates.members())
        .extracting(RequestCandidatesResponse.Member::userId)
        .containsExactlyInAnyOrder(owner, cy);
    assertThat(candidates.swaps())
        .singleElement()
        .satisfies(
            person -> {
              assertThat(person.userId()).isEqualTo(cy);
              assertThat(person.occurrences())
                  .extracting(ChoreRequestResponse.Occurrence::id)
                  .contains(theirs);
            });
    assertThatThrownBy(() -> handOff(ana, mine, ben))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("They already do this chore.");

    ChoreRequestResponse swap =
        requests.create(householdId, new ChoreRequestCreate("SWAP", mine, cy, theirs), auth(ana));
    assertThat(notified("REQUEST_SWAP_ASK", swap.id())).containsExactly(cy);
    // The swap holds both chores: neither can be in another request.
    assertThatThrownBy(() -> handOff(cy, theirs, owner))
        .isInstanceOf(DuplicateResourceException.class);

    requests.accept(householdId, swap.id(), auth(cy));

    assertThat(people(mine)).containsExactlyInAnyOrder(ben, cy);
    assertThat(people(theirs)).containsExactly(ana);
    assertThat(column(mine, "assignees_overridden", Boolean.class)).isTrue();
    assertThat(column(theirs, "assignees_overridden", Boolean.class)).isTrue();
    assertThat(card(mine, cy).requests().note().with().userId()).isEqualTo(ana);
    assertThat(card(theirs, ana).requests().note().with().userId()).isEqualTo(cy);
    assertThat(card(theirs, ana).requests().note().type()).isEqualTo("SWAPPED");
  }

  @Test
  void passMyTurnHandsTheWhenNeededTurnOnWithoutChangingTheRotation() {
    UUID chore = whenNeeded("Toilet paper", List.of(ana, ben, cy));
    UUID open = openOf(chore);
    UUID holder = people(open).getFirst();
    UUID next = holder.equals(ben) ? cy : ben;
    Object configBefore =
        jdbc.queryForObject(
            "SELECT strategy_config::text FROM chore_schedules WHERE chore_id=?",
            String.class,
            chore);
    assertThat(card(open, holder).requests().passTurn()).isTrue();
    assertThat(card(open, holder).requests().canSwap()).isFalse();
    assertThatThrownBy(
            () ->
                requests.create(
                    householdId,
                    new ChoreRequestCreate("SWAP", open, next, UUID.randomUUID()),
                    auth(holder)))
        .hasMessage(ChoreRequestService.NO_SWAP_AS_NEEDED);
    // The owner isn't in the rotation, so the turn can't go to them.
    assertThatThrownBy(() -> handOff(holder, open, owner))
        .hasMessage("Choose someone in this chore's rotation.");

    ChoreRequestResponse request = handOff(holder, open, next);
    requests.accept(householdId, request.id(), auth(next));

    assertThat(people(open)).containsExactly(next);
    occurrenceService.generateHousehold(householdId);
    assertThat(people(openOf(chore))).containsExactly(next);
    assertThat(
            jdbc.queryForObject(
                "SELECT strategy_config::text FROM chore_schedules WHERE chore_id=?",
                String.class,
                chore))
        .isEqualTo(configBefore);
  }

  // ---- Eligibility
  // -------------------------------------------------------------------------------

  @Test
  void onlyAnAssigneeAsksAwayPeopleCantBeAskedAndOneOpenRequestPerChore() {
    UUID chore = weekly("Floors", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID occurrence = occurrenceOn(chore, tomorrow);
    jdbc.update(
        "INSERT INTO member_away_periods (household_id, user_id, starts_on, ends_on)"
            + " VALUES (?, ?, ?, ?)",
        householdId,
        cy,
        tomorrow,
        tomorrow.plusDays(2));

    assertThatThrownBy(() -> handOff(ben, occurrence, cy))
        .isInstanceOf(HouseholdAccessDeniedException.class)
        .hasMessage(ChoreRequestService.NOT_YOURS);
    assertThatThrownBy(() -> handOff(ana, occurrence, cy))
        .hasMessage("They're away that day, so they can't be asked.");
    RequestCandidatesResponse.Member away =
        requests.candidates(householdId, occurrence, auth(ana)).members().stream()
            .filter(member -> member.userId().equals(cy))
            .findFirst()
            .orElseThrow();
    assertThat(away.eligible()).isFalse();
    assertThat(away.awayUntil()).isEqualTo(tomorrow.plusDays(2));

    ChoreRequestResponse anyone = handOff(ana, occurrence, null);
    // Cy is away that day: not asked.
    assertThat(notified("REQUEST_HANDOFF_ASK", anyone.id())).containsExactlyInAnyOrder(owner, ben);
    assertThatThrownBy(() -> handOff(ana, occurrence, ben))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage(ChoreRequestService.ALREADY_OPEN);

    requests.cancel(householdId, anyone.id(), auth(ana));
    assertThat(statusOf(anyone.id())).isEqualTo("CANCELLED");
    assertThat(liveAsks(anyone.id(), null)).isZero();
  }

  // ---- Closing
  // -----------------------------------------------------------------------------------

  @Test
  void itClosesWhenTheChoreIsCompletedMovedOrReassignedAndHeldAsksAreCancelled() {
    // Ben is in quiet hours, so his ask push is held for the morning.
    quietAroundNow(ben);
    UUID chore = weekly("Sweep", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID first = occurrenceOn(chore, tomorrow);
    UUID second = occurrenceOn(chore, tomorrow.plusWeeks(1));
    UUID third = occurrenceOn(chore, tomorrow.plusWeeks(2));

    ChoreRequestResponse completed = handOff(ana, first, ben);
    assertThat(heldPushes(completed.id(), ben)).isEqualTo(1);
    occurrenceService.complete(householdId, first, auth(ana));
    assertThat(statusOf(completed.id())).isEqualTo("EXPIRED");
    assertThat(heldPushes(completed.id(), ben)).isZero();
    assertThat(liveAsks(completed.id(), null)).isZero();
    // Ana did it herself: no push to her about it.
    assertThat(notified("REQUEST_EXPIRED", completed.id())).isEmpty();

    ChoreRequestResponse moved = handOff(ana, second, ben);
    occurrenceService.move(householdId, second, tomorrow.plusWeeks(1).plusDays(1), null, auth(ana));
    assertThat(statusOf(moved.id())).isEqualTo("EXPIRED");

    // An admin gives it to someone else: Ana hears her request closed.
    ChoreRequestResponse reassigned = handOff(ana, third, ben);
    occurrenceService.reassign(householdId, third, List.of(cy), auth(owner));
    assertThat(statusOf(reassigned.id())).isEqualTo("EXPIRED");
    assertThat(notified("REQUEST_EXPIRED", reassigned.id())).containsExactly(ana);
  }

  @Test
  void itExpiresAtTheDeadlineWithOneHeadsUpTwoHoursBefore() {
    UUID chore = weekly("Oven", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID occurrence = occurrenceOn(chore, tomorrow);
    OffsetDateTime due = tomorrow.atTime(SIX_PM).atOffset(ZoneOffset.UTC);

    ChoreRequestResponse request = handOff(ana, occurrence, null);
    assertThat(request.expiresAt()).isEqualTo(due);
    List<Map<String, Object>> headsUp =
        jdbc.queryForList(
            "SELECT recipient_user_id, scheduled_at, status FROM notifications"
                + " WHERE reference_id=? AND type='REQUEST_UNCLAIMED'",
            request.id());
    assertThat(headsUp).singleElement();
    assertThat(headsUp.getFirst().get("recipient_user_id")).isEqualTo(ana);
    assertThat(((java.sql.Timestamp) headsUp.getFirst().get("scheduled_at")).toInstant())
        .isEqualTo(due.minusHours(2).toInstant());

    // The scheduler's pass before the deadline changes nothing; at the deadline it expires, and
    // the heads-up (still waiting) goes with it.
    requests.maintain();
    assertThat(statusOf(request.id())).isEqualTo("OPEN");
    requests.useClock(Clock.fixed(due.plusMinutes(1).toInstant(), ZoneOffset.UTC));
    requests.maintain();
    requests.maintain();
    assertThat(statusOf(request.id())).isEqualTo("EXPIRED");
    assertThat(liveAsks(request.id(), null)).isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE reference_id=? AND type='REQUEST_UNCLAIMED'",
                Integer.class,
                request.id()))
        .isEqualTo(1);

    // Under two hours from the deadline: no heads-up at all.
    requests.useClock(Clock.fixed(due.minusMinutes(90).toInstant(), ZoneOffset.UTC));
    ChoreRequestResponse late = handOff(ana, occurrence, null);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE reference_id=? AND type='REQUEST_UNCLAIMED'",
                Integer.class,
                late.id()))
        .isZero();
  }

  @Test
  void asksGoToTheRightPeopleAndRespectQuietHours() {
    quietAroundNow(ben);
    UUID chore = weekly("Windows", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    ChoreRequestResponse request = handOff(ana, occurrenceOn(chore, tomorrow), null);

    assertThat(notified("REQUEST_HANDOFF_ASK", request.id()))
        .containsExactlyInAnyOrder(owner, ben, cy);
    assertThat(notified("REQUEST_HANDOFF_ASK", request.id())).doesNotContain(ana);
    // Ben's push waits for the end of his quiet hours; Cy's isn't held.
    assertThat(heldPushes(request.id(), ben)).isEqualTo(1);
    assertThat(heldPushes(request.id(), cy)).isZero();
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT n.title FROM notifications n
                    WHERE n.reference_id=? AND n.recipient_user_id=? AND n.type='REQUEST_HANDOFF_ASK'
                    """,
                String.class,
                request.id(),
                cy))
        .isEqualTo("Ana asks for a hand");
  }

  @Test
  void aMemberLeavingClosesTheirRequests() {
    UUID chore = weekly("Dusting", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID other = weekly("Plants", AssignmentStrategy.FIXED, cy, List.of(cy), 1);
    ChoreRequestResponse toBen = handOff(ana, occurrenceOn(chore, tomorrow), ben);
    ChoreRequestResponse byCy = handOff(cy, occurrenceOn(other, tomorrow), null);

    leave(ben);
    leave(cy);

    assertThat(statusOf(toBen.id())).isEqualTo("CANCELLED");
    assertThat(statusOf(byCy.id())).isIn("CANCELLED", "EXPIRED");
  }

  // ---- Fairness
  // ----------------------------------------------------------------------------------

  @Test
  void fairnessNeedsNoBookkeepingRotationCountsWhoHadItAndBalancedWhoDidIt() {
    UUID chore = weekly("Trash", AssignmentStrategy.ROUND_ROBIN, null, List.of(ana, ben), 1);
    UUID occurrence = occurrenceOn(chore, tomorrow);
    UUID asker = people(occurrence).getFirst();
    UUID taker = asker.equals(ana) ? ben : ana;
    Map<UUID, Integer> before = turns(chore);

    requests.accept(householdId, handOff(asker, occurrence, taker).id(), auth(taker));

    // The rotation counts who has each turn, so the taker now has one more and the asker one fewer,
    // and the next new turn goes back to the asker.
    Map<UUID, Integer> after = turns(chore);
    assertThat(after.get(taker)).isEqualTo(before.getOrDefault(taker, 0) + 1);
    assertThat(after.getOrDefault(asker, 0)).isEqualTo(before.get(asker) - 1);
    jdbc.update(
        "DELETE FROM chore_assignment_assignees WHERE assignment_id IN (SELECT id FROM"
            + " chore_assignments WHERE chore_id=? AND planned_for>?)",
        chore,
        tomorrow);
    jdbc.update(
        "DELETE FROM chore_assignments WHERE chore_id=? AND planned_for>?", chore, tomorrow);
    occurrenceService.generateHousehold(householdId);
    assertThat(people(occurrenceOn(chore, tomorrow.plusWeeks(1)))).containsExactly(asker);

    // Balanced counts completed effort, credited to whoever completed it.
    occurrenceService.complete(householdId, occurrence, auth(taker));
    Map<UUID, Integer> effort =
        effortLedger.completedEffort(householdId, now.minusDays(1), now.plusDays(1));
    assertThat(effort).containsKey(taker).doesNotContainKey(asker);
  }

  // ---- Fixtures
  // ----------------------------------------------------------------------------------

  private ChoreRequestResponse handOff(UUID asker, UUID occurrence, UUID target) {
    return requests.create(
        householdId, new ChoreRequestCreate("HANDOFF", occurrence, target, null), auth(asker));
  }

  private UUID weekly(
      String title, AssignmentStrategy strategy, UUID fixed, List<UUID> people, int needed) {
    String day = tomorrow.getDayOfWeek().name().substring(0, 2);
    ChoreScheduleRequest schedule =
        new ChoreScheduleRequest(
            "FREQ=WEEKLY;BYDAY=" + day,
            null,
            tomorrow,
            null,
            SIX_PM,
            strategy,
            fixed,
            people,
            needed);
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, 2, null, false, schedule),
            auth(owner))
        .id();
  }

  private UUID whenNeeded(String title, List<UUID> people) {
    ChoreScheduleRequest schedule =
        new ChoreScheduleRequest(
            null,
            null,
            null,
            null,
            null,
            AssignmentStrategy.ROUND_ROBIN,
            null,
            people,
            1,
            ScheduleKind.AS_NEEDED,
            null,
            null,
            false,
            null);
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, 1, null, false, schedule),
            auth(owner))
        .id();
  }

  private void updateWho(UUID chore, List<UUID> people) {
    String title = jdbc.queryForObject("SELECT title FROM chores WHERE id=?", String.class, chore);
    String day = tomorrow.getDayOfWeek().name().substring(0, 2);
    choreService.updateChore(
        householdId,
        chore,
        new ChoreRequest(
            title,
            null,
            null,
            null,
            2,
            null,
            false,
            new ChoreScheduleRequest(
                "FREQ=WEEKLY;BYDAY=" + day,
                null,
                tomorrow,
                null,
                SIX_PM,
                AssignmentStrategy.ROUND_ROBIN,
                null,
                people,
                1)),
        auth(owner));
  }

  private void leave(UUID user) {
    transactions.executeWithoutResult(
        status -> {
          jdbc.update(
              "UPDATE household_memberships SET status='LEFT', left_at=NOW()"
                  + " WHERE household_id=? AND user_id=?",
              householdId,
              user);
          exitCleanup.cleanupMembershipExit(householdId, user);
        });
  }

  private void quietAroundNow(UUID user) {
    LocalTime start = now.minusHours(1).toLocalTime().truncatedTo(ChronoUnit.MINUTES);
    LocalTime end = now.plusHours(1).toLocalTime().truncatedTo(ChronoUnit.MINUTES);
    jdbc.update(
        """
            UPDATE notification_preferences
            SET quiet_hours_enabled=TRUE, quiet_hours_start=?, quiet_hours_end=?
            WHERE user_id=?
            """,
        start,
        end,
        user);
  }

  private void pinClocks(OffsetDateTime at) {
    Clock clock = Clock.fixed(at.toInstant(), ZoneOffset.UTC);
    requests.useClock(clock);
    occurrenceService.useClock(clock);
    quietHours.useClock(clock);
  }

  private AssignmentResponse card(UUID occurrence, UUID viewer) {
    return occurrenceService.occurrence(householdId, occurrence, auth(viewer));
  }

  private List<UUID> notified(String type, UUID requestId) {
    return jdbc.queryForList(
        "SELECT recipient_user_id FROM notifications WHERE reference_type='CHORE_REQUEST'"
            + " AND reference_id=? AND type=? AND status<>'CANCELLED'",
        UUID.class,
        requestId,
        type);
  }

  /** Unsent pushes about the request (asks and the heads-up) still waiting to go. */
  private int liveAsks(UUID requestId, UUID recipient) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notification_deliveries d
            JOIN notifications n ON n.id=d.notification_id
            WHERE n.reference_id=? AND d.channel='WEB_PUSH' AND d.status IN ('PENDING','FAILED')
              AND (?::uuid IS NULL OR n.recipient_user_id=?)
            """,
        Integer.class,
        requestId,
        recipient,
        recipient);
  }

  private int heldPushes(UUID requestId, UUID recipient) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notification_deliveries d
            JOIN notifications n ON n.id=d.notification_id
            WHERE n.reference_id=? AND n.recipient_user_id=? AND d.channel='WEB_PUSH'
              AND d.status='PENDING' AND d.quiet_held_until IS NOT NULL
            """,
        Integer.class,
        requestId,
        recipient);
  }

  private String statusOf(UUID requestId) {
    return jdbc.queryForObject(
        "SELECT status FROM chore_requests WHERE id=?", String.class, requestId);
  }

  private Map<UUID, Integer> turns(UUID chore) {
    Map<UUID, Integer> turns = new java.util.HashMap<>();
    jdbc.query(
        """
            SELECT aa.user_id, COUNT(*) FROM chore_assignment_assignees aa
            JOIN chore_assignments a ON a.id=aa.assignment_id
            WHERE a.chore_id=? AND a.status<>'CANCELLED' AND a.planned_for<=?
            GROUP BY aa.user_id
            """,
        rs -> {
          turns.put(rs.getObject(1, UUID.class), rs.getInt(2));
        },
        chore,
        tomorrow);
    return turns;
  }

  private UUID occurrenceOn(UUID chore, LocalDate day) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for=? AND status='PENDING'",
        UUID.class,
        chore,
        day);
  }

  private UUID openOf(UUID chore) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND status='PENDING'",
        UUID.class,
        chore);
  }

  private List<UUID> people(UUID occurrence) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=?"
            + " ORDER BY created_at, user_id",
        UUID.class,
        occurrence);
  }

  private <T> T column(UUID occurrence, String name, Class<T> type) {
    return jdbc.queryForObject(
        "SELECT " + name + " FROM chore_assignments WHERE id=?", type, occurrence);
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "requests-" + name.toLowerCase() + "-" + id + "@example.test",
        name);
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled) VALUES (?, TRUE)", id);
    jdbc.update(
        "INSERT INTO push_subscriptions (user_id, endpoint, public_key, auth_secret)"
            + " VALUES (?, ?, 'key', 'secret')",
        id,
        "https://push.example.test/" + id);
    return id;
  }

  private void addMember(UUID userId, String role) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', NOW())
            """,
        householdId,
        userId,
        role);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
