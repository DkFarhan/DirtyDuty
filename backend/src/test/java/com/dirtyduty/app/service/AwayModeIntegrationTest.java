package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.board.BoardPostRequest;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.chore.HouseholdMemberStatsResponse;
import com.dirtyduty.app.dto.household.AwayPeriodRequest;
import com.dirtyduty.app.dto.household.AwayPreviewResponse;
import com.dirtyduty.app.dto.household.AwayStatusResponse;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.NotificationScheduler;
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
import java.util.function.Function;
import java.util.stream.Collectors;
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
 * Away mode (E10) on real PostgreSQL: who does what while a member is away, coming back level,
 * re-planning, notifications, week stats, permissions, validation and the Board heads-up. Dates are
 * relative to today in the household's zone (UTC); generation reads the system clock, so the pinned
 * clocks are taken from it.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class AwayModeIntegrationTest {
  private static final LocalTime EIGHT_PM = LocalTime.of(20, 0);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private AwayModeService awayModeService;
  @Autowired private BoardPostService boardPostService;
  @Autowired private NotificationScheduler notificationScheduler;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private UUID cy;
  private UUID outsider;
  private LocalDate today;
  private OffsetDateTime now;

  @BeforeEach
  void setUp() {
    now = OffsetDateTime.ofInstant(Instant.now().truncatedTo(ChronoUnit.SECONDS), ZoneOffset.UTC);
    today = now.toLocalDate();
    occurrenceService.useClock(Clock.fixed(now.toInstant(), ZoneOffset.UTC));
    awayModeService.useClock(Clock.fixed(now.toInstant(), ZoneOffset.UTC));
    owner = createUser("Oli");
    ana = createUser("Ana");
    ben = createUser("Ben");
    cy = createUser("Cy");
    outsider = createUser("Out");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Away', 'UTC', ?)",
        householdId,
        owner);
    addMember(owner, "OWNER");
    addMember(ana, "MEMBER");
    addMember(ben, "MEMBER");
    addMember(cy, "MEMBER");
  }

  @AfterEach
  void cleanFixtures() {
    occurrenceService.useClock(null);
    awayModeService.useClock(null);
    String notificationIds =
        """
        SELECT n.id FROM notifications n
        WHERE (n.reference_type='CHORE_ASSIGNMENT'
               AND n.reference_id IN (SELECT id FROM chore_assignments WHERE household_id=?))
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
    jdbc.update("DELETE FROM member_away_periods WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM board_posts WHERE household_id=?", householdId);
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
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", userId);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    userIds.clear();
  }

  // ---- Rotation
  // ----------------------------------------------------------------------------------

  @Test
  void aRotationSkipsTheAwayMemberAndTheyComeBackLevelNotBehind() {
    UUID chore = calendar("Bins", AssignmentStrategy.ROUND_ROBIN, null, List.of(ana, ben), 1);
    away(ana, ana, today, today.plusDays(3));
    LocalDate back = today.plusDays(4);

    for (int day = 0; day <= 3; day++) {
      UUID occurrence = occurrenceOn(chore, today.plusDays(day));
      assertThat(assignees(occurrence)).containsExactly(ben);
    }
    // Each of those days would have been Ana's (she had the fewest turns): Ben covers, and the
    // card can say so.
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=? AND away_from_user_id=?",
                Integer.class,
                chore,
                ana))
        .isEqualTo(4);
    // Back level, not behind: the four missed turns are written off, so the two alternate again
    // instead of Ana doing the next four in a row.
    List<UUID> afterReturn =
        List.of(
            assignees(occurrenceOn(chore, back)).getFirst(),
            assignees(occurrenceOn(chore, back.plusDays(1))).getFirst());
    assertThat(afterReturn).containsExactlyInAnyOrder(ana, ben);

    // On the return day the hourly pass stores the same credit; nothing planned moves.
    Map<LocalDate, List<UUID>> planned = plan(chore);
    awayModeService.useClock(
        Clock.fixed(back.atTime(10, 0).toInstant(ZoneOffset.UTC), ZoneOffset.UTC));
    awayModeService.maintain(householdId);
    assertThat(offsetOf(chore, ana)).isEqualTo(4);
    assertThat(plan(chore)).isEqualTo(planned);
    assertThat(
            jdbc.queryForObject(
                "SELECT levelled_at IS NOT NULL FROM member_away_periods WHERE user_id=?",
                Boolean.class,
                ana))
        .isTrue();
  }

  @Test
  void levellingRaisesTheStandingAndNeverLowersIt() {
    AwayPeriods.Period period =
        new AwayPeriods.Period(UUID.randomUUID(), ana, today, today.plusDays(2), false);
    List<UUID> people = List.of(ana, ben, cy);
    assertThat(
            OccurrenceService.levelCredit(
                period, List.of(period), people, Map.of(ana, 1, ben, 5, cy, 4)))
        .isEqualTo(3);
    // Already ahead of the others: never lowered.
    assertThat(
            OccurrenceService.levelCredit(
                period, List.of(period), people, Map.of(ana, 9, ben, 5, cy, 4)))
        .isZero();
  }

  // ---- Fixed chores
  // ------------------------------------------------------------------------------

  @Test
  void aFixedChoreIsPausedWhileItsPersonIsAwayAndResumesWhenTheDatesChange() {
    UUID chore = calendar("Plants", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    away(ana, ana, today, today.plusDays(1));

    UUID paused = occurrenceOn(chore, today);
    assertThat(status(paused)).isEqualTo("SKIPPED");
    assertThat(column(paused, "away_paused", Boolean.class)).isTrue();
    assertThat(assignees(paused)).isEmpty();
    assertThat(status(occurrenceOn(chore, today.plusDays(2)))).isEqualTo("PENDING");
    // Paused days don't show in Upcoming.
    assertThat(
            occurrenceService.dashboard(householdId, auth(ana)).today().stream()
                .map(assignment -> assignment.id())
                .toList())
        .doesNotContain(paused);

    awayModeService.update(
        householdId,
        ana,
        new AwayPeriodRequest(today.plusDays(1), today.plusDays(1), false, null),
        auth(ana));
    assertThat(status(paused)).isEqualTo("PENDING");
    assertThat(column(paused, "away_paused", Boolean.class)).isFalse();
    assertThat(assignees(paused)).containsExactly(ana);
    assertThat(status(occurrenceOn(chore, today.plusDays(1)))).isEqualTo("SKIPPED");
  }

  @Test
  void aFixedGroupCarriesOnWithoutTheAwayMemberAndPausesWhenNobodyIsLeft() {
    UUID chore = calendar("Dishes", AssignmentStrategy.FIXED, ana, List.of(ana, ben), 2);
    away(ana, ana, today.plusDays(1), today.plusDays(1));
    UUID occurrence = occurrenceOn(chore, today.plusDays(1));
    assertThat(assignees(occurrence)).containsExactly(ben);
    assertThat(column(occurrence, "away_from_user_id", UUID.class)).isEqualTo(ana);
    assertThat(occurrenceService.occurrence(householdId, occurrence, auth(ben)).awayFrom().userId())
        .isEqualTo(ana);

    // An admin sets Ben away too: nobody is left, so it waits.
    away(ben, owner, today.plusDays(1), today.plusDays(1));
    assertThat(status(occurrence)).isEqualTo("SKIPPED");
    assertThat(assignees(occurrence)).isEmpty();
    assertThat(assignees(occurrenceOn(chore, today.plusDays(2))))
        .containsExactlyInAnyOrder(ana, ben);
  }

  // ---- Open copies
  // -------------------------------------------------------------------------------

  @Test
  void aWhenNeededTurnPassesOnWithoutAPush() {
    UUID chore = whenNeeded("Recycling", List.of(ana, ben));
    UUID open = openOf(chore);
    UUID holder = assignees(open).getFirst();
    UUID other = holder.equals(ana) ? ben : ana;

    away(holder, holder, today, today.plusDays(2));

    assertThat(assignees(open)).containsExactly(other);
    assertThat(column(open, "away_from_user_id", UUID.class)).isEqualTo(holder);
    // The new holder hears in-app only; nothing goes to a push.
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications
                    WHERE reference_id=? AND recipient_user_id=? AND type='CHORE_TURN'
                    """,
                Integer.class,
                open,
                other))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notification_deliveries d
                    JOIN notifications n ON n.id=d.notification_id
                    WHERE n.reference_id=? AND d.channel='WEB_PUSH'
                    """,
                Integer.class,
                open))
        .isZero();

    // Back early: the turn stays with whoever has it, and the card stops saying they're away.
    awayModeService.endNow(householdId, holder, auth(holder));
    assertThat(assignees(open)).containsExactly(other);
    assertThat(column(open, "away_from_user_id", UUID.class)).isNull();
  }

  @Test
  void afterLevellingOnReturnTheNextWhenNeededTurnsNeverGoToTheSamePersonTwiceInARow() {
    // Ben is first in rotation order, so the old order-only tie-break gave him two in a row.
    UUID chore = whenNeeded("Recycling", List.of(ben, ana, cy));
    assertThat(assignees(openOf(chore))).containsExactly(ben);
    away(ben, ben, today, today.plusDays(2));
    OffsetDateTime at = now;
    for (int i = 0; i < 3; i++) {
      at = completeOpenTurn(chore, at.plusHours(1));
    }
    LocalDate back = today.plusDays(3);
    at = back.atTime(10, 0).atOffset(ZoneOffset.UTC);
    useClocks(at);
    awayModeService.maintain(householdId);
    assertThat(offsetOf(chore, ben)).isEqualTo(1);

    List<UUID> turns = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      turns.add(assignees(openOf(chore)).getFirst());
      at = completeOpenTurn(chore, at.plusHours(1));
    }
    for (int i = 1; i < turns.size(); i++) {
      assertThat(turns.get(i)).as("turn %d", i).isNotEqualTo(turns.get(i - 1));
    }
    assertThat(java.util.Collections.frequency(turns, ben))
        .as("Ben's turns in %s", turns)
        .isEqualTo(2);
    assertThat(java.util.Collections.frequency(turns, ana))
        .as("Ana's turns in %s", turns)
        .isEqualTo(2);
    assertThat(java.util.Collections.frequency(turns, cy))
        .as("Cy's turns in %s", turns)
        .isEqualTo(2);
  }

  @Test
  void whoeverJustCoveredATurnDoesntGetTheNextOneOnATie() {
    OffsetDateTime justNow = now;
    // Ana (first in order) just covered someone's turn and is now level with Ben, who did his
    // last turn two days ago: Ben goes next.
    assertThat(
            OccurrenceService.pickTurn(
                List.of(ana, ben, cy),
                Map.of(ana, 2, ben, 1, cy, 3),
                Map.of(ben, 1),
                Map.of(ana, justNow, ben, justNow.minusDays(2), cy, justNow.minusDays(1))))
        .isEqualTo(ben);
    // Never completed counts as longest ago.
    assertThat(
            OccurrenceService.pickTurn(
                List.of(ana, ben), Map.of(ana, 1), Map.of(ben, 1), Map.of(ana, justNow)))
        .isEqualTo(ben);
    // Equal on both: rotation order.
    assertThat(
            OccurrenceService.pickTurn(
                List.of(ana, ben),
                Map.of(ana, 1, ben, 1),
                Map.of(),
                Map.of(ana, justNow, ben, justNow)))
        .isEqualTo(ana);
    assertThat(OccurrenceService.pickTurn(List.of(ana, ben), Map.of(), Map.of(), Map.of()))
        .isEqualTo(ana);

    // End to end: Ben covers Ana's turn, Ana does the next one, and on the tie it's Ben's again,
    // not Ana's.
    UUID chore = whenNeeded("Towels", List.of(ana, ben));
    UUID first = openOf(chore);
    assertThat(assignees(first)).containsExactly(ana);
    useClocks(now.plusHours(1));
    occurrenceService.complete(householdId, first, auth(ben));
    assertThat(assignees(openOf(chore))).containsExactly(ana);
    completeOpenTurn(chore, now.plusHours(2));
    assertThat(assignees(openOf(chore))).containsExactly(ben);
  }

  /** Has the open copy's holder complete it at {@code at}; returns {@code at}. */
  private OffsetDateTime completeOpenTurn(UUID chore, OffsetDateTime at) {
    useClocks(at);
    UUID open = openOf(chore);
    occurrenceService.complete(householdId, open, auth(assignees(open).getFirst()));
    return at;
  }

  private void useClocks(OffsetDateTime at) {
    occurrenceService.useClock(Clock.fixed(at.toInstant(), ZoneOffset.UTC));
    awayModeService.useClock(Clock.fixed(at.toInstant(), ZoneOffset.UTC));
  }

  @Test
  void anAfterItsDoneChoreForOnlyThemWaitsForTheReturnDayAndEndingEarlyPutsItBack() {
    UUID chore = afterChore("Vacuum", ana, today.plusDays(1));
    UUID open = openOf(chore);
    OffsetDateTime planned = today.plusDays(1).atTime(EIGHT_PM).atOffset(ZoneOffset.UTC);
    assertThat(column(open, "due_at", OffsetDateTime.class)).isEqualTo(planned);

    away(ana, ana, today, today.plusDays(2));
    assertThat(column(open, "due_at", OffsetDateTime.class))
        .isEqualTo(today.plusDays(3).atTime(EIGHT_PM).atOffset(ZoneOffset.UTC));
    assertThat(assignees(open)).containsExactly(ana);

    // "I'm back now" on the first day removes the period and re-plans at once.
    awayModeService.endNow(householdId, ana, auth(ana));
    assertThat(column(open, "due_at", OffsetDateTime.class)).isEqualTo(planned);
    assertThat(column(open, "scheduled_for", LocalDate.class)).isEqualTo(today.plusDays(1));
  }

  // ---- Overrides, ending early, editing
  // ----------------------------------------------------------

  @Test
  void manualOverridesAndCompletedOccurrencesAreLeftAlone() {
    UUID chore = calendar("Floors", AssignmentStrategy.FIXED, ben, List.of(ben), 1);
    UUID overridden = occurrenceOn(chore, today.plusDays(1));
    occurrenceService.reassign(householdId, overridden, List.of(ana), auth(owner));
    UUID mine = calendar("Bath", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID completed = occurrenceOn(mine, today);
    jdbc.update(
        "INSERT INTO chore_completions (household_id, assignment_id, completed_by_user_id, "
            + "completed_at, attempt_number) VALUES (?, ?, ?, ?, 1)",
        householdId,
        completed,
        ana,
        now);
    jdbc.update("UPDATE chore_assignments SET status='COMPLETED' WHERE id=?", completed);

    away(ana, ana, today, today.plusDays(2));

    assertThat(status(overridden)).isEqualTo("PENDING");
    assertThat(assignees(overridden)).containsExactly(ana);
    assertThat(status(completed)).isEqualTo("COMPLETED");
    assertThat(assignees(completed)).containsExactly(ana);
    assertThat(status(occurrenceOn(mine, today.plusDays(1)))).isEqualTo("SKIPPED");
  }

  @Test
  void endingEarlyResumesTheRestAndBringsThemLevelAtOnce() {
    UUID plants = calendar("Plants", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID bins = calendar("Bins", AssignmentStrategy.ROUND_ROBIN, null, List.of(ana, ben), 1);
    // Away since two days ago (set back then), until the end of the week.
    jdbc.update(
        """
            INSERT INTO member_away_periods (household_id, user_id, starts_on, ends_on)
            VALUES (?, ?, ?, ?)
            """,
        householdId,
        ana,
        today.minusDays(2),
        today.plusDays(4));
    occurrenceService.replanForAway(householdId);
    assertThat(status(occurrenceOn(plants, today.plusDays(1)))).isEqualTo("SKIPPED");

    AwayStatusResponse status = awayModeService.endNow(householdId, ana, auth(ana));

    assertThat(status.period()).isNull();
    assertThat(
            jdbc.queryForObject(
                "SELECT ends_on FROM member_away_periods WHERE user_id=?", LocalDate.class, ana))
        .isEqualTo(today.minusDays(1));
    assertThat(status(occurrenceOn(plants, today))).isEqualTo("PENDING");
    assertThat(status(occurrenceOn(plants, today.plusDays(1)))).isEqualTo("PENDING");
    assertThat(assignees(occurrenceOn(plants, today.plusDays(1)))).containsExactly(ana);
    // Level now: the two alternate from today.
    assertThat(
            List.of(
                assignees(occurrenceOn(bins, today)).getFirst(),
                assignees(occurrenceOn(bins, today.plusDays(1))).getFirst()))
        .containsExactlyInAnyOrder(ana, ben);
  }

  @Test
  void editingTheDatesRePlansAndRunningItAgainChangesNothing() {
    UUID chore = calendar("Bins", AssignmentStrategy.ROUND_ROBIN, null, List.of(ana, ben, cy), 1);
    away(ana, ana, today.plusDays(1), today.plusDays(6));
    awayModeService.update(
        householdId,
        ana,
        new AwayPeriodRequest(today.plusDays(1), today.plusDays(2), false, null),
        auth(ana));
    Map<LocalDate, List<UUID>> once = plan(chore);
    for (int day = 1; day <= 2; day++) {
      assertThat(once.get(today.plusDays(day))).doesNotContain(ana);
    }

    awayModeService.update(
        householdId,
        ana,
        new AwayPeriodRequest(today.plusDays(1), today.plusDays(2), false, null),
        auth(ana));
    occurrenceService.generateHousehold(householdId);
    assertThat(plan(chore)).isEqualTo(once);
  }

  // ---- Notifications and stats
  // -------------------------------------------------------------------

  @Test
  void anAwayMemberGetsNoChoreRemindersButBoardPostsStillReachThem() {
    UUID chore = calendar("Floors", AssignmentStrategy.FIXED, ben, List.of(ben), 1);
    UUID kept = occurrenceOn(chore, today.plusDays(1));
    occurrenceService.reassign(householdId, kept, List.of(ana), auth(owner));
    notificationScheduler.run();
    assertThat(liveReminders(kept, ana)).isPositive();

    away(ana, ana, today.plusDays(1), today.plusDays(1));
    assertThat(liveReminders(kept, ana)).isZero();
    notificationScheduler.run();
    assertThat(liveReminders(kept, ana)).isZero();
    // Ben's own days still get theirs.
    assertThat(liveReminders(occurrenceOn(chore, today.plusDays(2)), ben)).isPositive();

    boardPostService.create(
        householdId,
        new BoardPostRequest("HEADS_UP", "Water off", null, null, null, null, false, null, null),
        auth(ben));
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE recipient_user_id=? AND type='BOARD_POST_NEW'",
                Integer.class,
                ana))
        .isEqualTo(1);
  }

  @Test
  void weekStatsDontCountAwayDaysForTheAwayMemberAndPausedOnesForNobody() {
    UUID mine = calendar("Bath", AssignmentStrategy.FIXED, ana, List.of(ana), 1);
    UUID floors = calendar("Floors", AssignmentStrategy.FIXED, ben, List.of(ben), 1);
    UUID kept = occurrenceOn(floors, today);
    occurrenceService.reassign(householdId, kept, List.of(ana), auth(owner));
    long anaBefore = stats().get(ana).assignedThisWeek();

    away(ana, ana, today, today);

    // Today's Bath is paused, and Floors (kept on Ana by hand) isn't hers on an away day.
    assertThat(status(occurrenceOn(mine, today))).isEqualTo("SKIPPED");
    assertThat(stats().get(ana).assignedThisWeek()).isEqualTo(anaBefore - 2);
    assertThat(stats().get(ben).assignedThisWeek())
        .isEqualTo(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM chore_assignments a
                    JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id AND aa.user_id=?
                    WHERE a.household_id=? AND a.status='PENDING'
                      AND a.scheduled_for>=date_trunc('week', ?::date)::date
                      AND a.scheduled_for<date_trunc('week', ?::date)::date + 7
                    """,
                Long.class,
                ben,
                householdId,
                today,
                today));
  }

  // ---- Permissions and validation
  // ----------------------------------------------------------------

  @Test
  void membersSetTheirOwnAdminsSetAnyonesOthersAreRefused() {
    away(ana, ana, today.plusDays(5), today.plusDays(6));
    away(ben, owner, today.plusDays(5), today.plusDays(6));
    AwayPeriodRequest dates =
        new AwayPeriodRequest(today.plusDays(5), today.plusDays(6), false, false);
    assertThatThrownBy(() -> awayModeService.set(householdId, cy, dates, auth(ana)))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    assertThatThrownBy(() -> awayModeService.status(householdId, ana, auth(outsider)))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThatThrownBy(() -> awayModeService.set(householdId, outsider, dates, auth(owner)))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThat(awayModeService.status(householdId, ben, auth(ben)).period().status())
        .isEqualTo("UPCOMING");
  }

  @Test
  void datesMustStartTodayOrLaterLastAtMost90DaysAndNotOverlap() {
    assertRejected(
        new AwayPeriodRequest(today.minusDays(1), today.plusDays(1), false, false),
        "Away mode can't start in the past.");
    assertRejected(
        new AwayPeriodRequest(today, today.plusDays(91), false, false),
        "Away mode can last up to 90 days.");
    assertRejected(
        new AwayPeriodRequest(today.plusDays(2), today.plusDays(1), false, false),
        "The end date can't be before the start date.");
    AwayPreviewResponse longest =
        awayModeService.preview(
            householdId, ana, new AwayPeriodRequest(today, null, true, null), auth(ana));
    assertThat(longest.endsOn()).isEqualTo(today.plusDays(90));

    away(ana, ana, today.plusDays(10), today.plusDays(12));
    assertRejected(
        new AwayPeriodRequest(today.plusDays(1), today.plusDays(2), false, false),
        "There are already away dates set. Change those instead.");
  }

  // ---- Ending reminder and the Board
  // -------------------------------------------------------------

  @Test
  void untilImBackRemindsThePersonTheDayBeforeItEndsOnce() {
    awayModeService.set(
        householdId, ana, new AwayPeriodRequest(today, null, true, false), auth(ana));
    LocalDate endsOn = today.plusDays(90);
    awayModeService.useClock(
        Clock.fixed(endsOn.minusDays(1).atTime(10, 0).toInstant(ZoneOffset.UTC), ZoneOffset.UTC));
    awayModeService.maintain(householdId);
    awayModeService.maintain(householdId);

    List<Map<String, Object>> reminders =
        jdbc.queryForList(
            "SELECT title, status FROM notifications WHERE recipient_user_id=? AND type=?",
            ana,
            AwayModeService.ENDING_REMINDER);
    assertThat(reminders).hasSize(1);
    assertThat(reminders.getFirst().get("title")).isEqualTo("Your away mode ends tomorrow");
  }

  @Test
  void theBoardHeadsUpIsPostedWithoutNotifyingAnyone() {
    away(ana, ana, today.plusDays(1), today.plusDays(3), true);
    Map<String, Object> post =
        jdbc.queryForMap(
            """
                SELECT p.author_user_id, p.title, p.details, p.notify_mode, p.active_until, p.type
                FROM board_posts p JOIN member_away_periods w ON w.board_post_id=p.id
                WHERE w.user_id=?
                """,
            ana);
    assertThat(post.get("author_user_id")).isEqualTo(ana);
    assertThat((String) post.get("title")).startsWith("Away Ana is away ");
    assertThat((String) post.get("details")).endsWith("My turns are covered by the app.");
    assertThat(post.get("notify_mode")).isEqualTo("NONE");
    assertThat(post.get("type")).isEqualTo("HEADS_UP");
    assertThat(((java.sql.Date) post.get("active_until")).toLocalDate())
        .isEqualTo(today.plusDays(3));
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications n JOIN notification_events e ON e.id=n.event_id
                    WHERE e.household_id=? AND n.type LIKE 'BOARD_%'
                    """,
                Integer.class, householdId))
        .isZero();

    // Set by an admin for someone else: the admin is the author, the title names the member.
    away(ben, owner, today.plusDays(1), today.plusDays(1), true);
    Map<String, Object> forBen =
        jdbc.queryForMap(
            """
                SELECT p.author_user_id, p.title FROM board_posts p
                JOIN member_away_periods w ON w.board_post_id=p.id WHERE w.user_id=?
                """,
            ben);
    assertThat(forBen.get("author_user_id")).isEqualTo(owner);
    assertThat((String) forBen.get("title")).startsWith("Away Ben is away ");
  }

  // ---- Helpers
  // -----------------------------------------------------------------------------------

  private void assertRejected(AwayPeriodRequest request, String message) {
    assertThatThrownBy(() -> awayModeService.set(householdId, ana, request, auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(message);
  }

  private void away(UUID member, UUID actor, LocalDate from, LocalDate until) {
    away(member, actor, from, until, false);
  }

  private void away(UUID member, UUID actor, LocalDate from, LocalDate until, boolean post) {
    awayModeService.set(
        householdId, member, new AwayPeriodRequest(from, until, false, post), auth(actor));
  }

  private UUID calendar(
      String title,
      AssignmentStrategy strategy,
      UUID fixed,
      List<UUID> participants,
      int peopleNeeded) {
    ChoreScheduleRequest schedule =
        new ChoreScheduleRequest(
            "FREQ=DAILY", null, today, null, EIGHT_PM, strategy, fixed, participants, peopleNeeded);
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, null, null, false, schedule),
            auth(owner))
        .id();
  }

  private UUID whenNeeded(String title, List<UUID> participants) {
    ChoreScheduleRequest schedule =
        new ChoreScheduleRequest(
            null,
            null,
            null,
            null,
            null,
            AssignmentStrategy.ROUND_ROBIN,
            null,
            participants,
            1,
            ScheduleKind.AS_NEEDED,
            null,
            null,
            true,
            2);
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, null, null, false, schedule),
            auth(owner))
        .id();
  }

  private UUID afterChore(String title, UUID person, LocalDate firstDue) {
    ChoreScheduleRequest schedule =
        new ChoreScheduleRequest(
            null,
            null,
            firstDue,
            null,
            EIGHT_PM,
            AssignmentStrategy.FIXED,
            person,
            List.of(person),
            1,
            ScheduleKind.AFTER_COMPLETION,
            3,
            IntervalUnit.DAY,
            null,
            null);
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, null, null, false, schedule),
            auth(owner))
        .id();
  }

  private UUID occurrenceOn(UUID chore, LocalDate day) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for=?",
        UUID.class,
        chore,
        day);
  }

  private UUID openOf(UUID chore) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND status IN ('PENDING','SUBMITTED')",
        UUID.class,
        chore);
  }

  private List<UUID> assignees(UUID occurrence) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
        UUID.class,
        occurrence);
  }

  /** Each pending day's people, in date order. */
  private Map<LocalDate, List<UUID>> plan(UUID chore) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, planned_for FROM chore_assignments WHERE chore_id=? ORDER BY planned_for",
            chore);
    Map<LocalDate, List<UUID>> plan = new java.util.TreeMap<>();
    for (Map<String, Object> row : rows) {
      plan.put(
          ((java.sql.Date) row.get("planned_for")).toLocalDate(), assignees((UUID) row.get("id")));
    }
    return plan;
  }

  private int offsetOf(UUID chore, UUID user) {
    Integer offset =
        jdbc.queryForObject(
            """
                SELECT (s.strategy_config->'turnOffsets'->>?)::int FROM chore_schedules s
                WHERE s.chore_id=?
                """,
            Integer.class,
            user.toString(),
            chore);
    return offset == null ? 0 : offset;
  }

  private int liveReminders(UUID occurrence, UUID user) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_id=? AND recipient_user_id=? AND status<>'CANCELLED'
              AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        Integer.class,
        occurrence,
        user);
  }

  private String status(UUID occurrence) {
    return column(occurrence, "status", String.class);
  }

  private <T> T column(UUID occurrence, String name, Class<T> type) {
    return jdbc.queryForObject(
        "SELECT " + name + " FROM chore_assignments WHERE id=?", type, occurrence);
  }

  private Map<UUID, HouseholdMemberStatsResponse> stats() {
    return occurrenceService.members(householdId, auth(owner)).stream()
        .collect(Collectors.toMap(HouseholdMemberStatsResponse::userId, Function.identity()));
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "away-" + name.toLowerCase() + "-" + id + "@example.test",
        "Away " + name);
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
