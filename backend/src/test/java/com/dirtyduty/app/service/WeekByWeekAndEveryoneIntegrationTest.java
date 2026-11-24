package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreResponse;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.chore.DashboardResponse;
import com.dirtyduty.app.dto.household.AwayPeriodRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
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
 * "Everyone" rotations (people who join or leave), Week by week (one owner per period, Monday
 * boundaries in the household's zone) and the all-or-nothing batch create, on real PostgreSQL. The
 * clocks are pinned to Wednesday, March 3, 2027 in Halifax; the week of March 8 has the switch to
 * daylight time (Sunday, March 14).
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class WeekByWeekAndEveryoneIntegrationTest {
  private static final LocalTime NINE_PM = LocalTime.of(21, 0);
  private static final LocalDate WED = LocalDate.of(2027, 3, 3);
  private static final LocalDate MON_8 = LocalDate.of(2027, 3, 8);
  private static final LocalDate MON_15 = LocalDate.of(2027, 3, 15);
  private static final LocalDate MON_22 = LocalDate.of(2027, 3, 22);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private AwayModeService awayModeService;
  @Autowired private HouseholdService householdService;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private UUID cy;
  private int joined;

  @BeforeEach
  void setUp() {
    pin(WED.atTime(14, 0).atOffset(ZoneOffset.UTC));
    owner = createUser("Oli");
    ana = createUser("Ana");
    ben = createUser("Ben");
    cy = createUser("Cy");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Weeks', 'America/Halifax', ?)",
        householdId,
        owner);
    addMember(owner, "OWNER");
    addMember(ana, "MEMBER");
    addMember(ben, "MEMBER");
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

  // ---- "Everyone"
  // -------------------------------------------------------------------------------

  @Test
  void everyoneTakesInAJoinerLevelAndDropsSomeoneWhoLeavesWhileFixedListsStayAsTheyAre() {
    UUID shared = daily("Dishes", AssignmentStrategy.ROUND_ROBIN, null, true, null);
    UUID fixedList =
        daily("Bins", AssignmentStrategy.ROUND_ROBIN, List.of(owner, ana), false, null);
    assertThat(participants(shared)).containsExactly(owner, ana, ben);

    // Six days of turns go by, two each; then Cy joins.
    pin(WED.plusDays(6).atTime(14, 0).atOffset(ZoneOffset.UTC));
    addMember(cy, "MEMBER");
    occurrenceService.generateHousehold(householdId);

    assertThat(participants(shared)).containsExactly(owner, ana, ben, cy);
    assertThat(participants(fixedList)).containsExactly(owner, ana);
    // Level, not behind: Cy gets one turn in four from now on, not a run of catch-up turns.
    Map<UUID, Integer> nextEight = turns(shared, WED.plusDays(6), WED.plusDays(13));
    assertThat(nextEight).containsOnlyKeys(owner, ana, ben, cy);
    assertThat(nextEight.values()).containsOnly(2);
    // Days already done keep their people.
    assertThat(people(shared, WED)).containsExactly(owner);

    // Ben leaves: his turns go to the others, nothing is left without someone.
    householdService.removeMember(householdId, ben, auth(owner));
    occurrenceService.generateHousehold(householdId);
    assertThat(participants(shared)).containsExactly(owner, ana, cy);
    Map<LocalDate, List<UUID>> plan = plan(shared, WED.plusDays(7), WED.plusDays(25));
    assertThat(plan).hasSize(19);
    assertThat(plan.values()).allSatisfy(people -> assertThat(people).hasSize(1));
    assertThat(plan.values().stream().flatMap(List::stream)).doesNotContain(ben);
    assertThat(participants(fixedList)).containsExactly(owner, ana);
  }

  // ---- Week by week
  // -----------------------------------------------------------------------------

  @Test
  void oneAndTwoWeekOwnersChangeOnMondaysInTheHouseholdZoneThroughADaylightTimeWeek() {
    UUID oneWeek = daily("Dishes", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy0()), 1);
    UUID twoWeeks = daily("Kitchen", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy), 2);

    // One turn per period, whatever the number of days in it.
    assertOwner(oneWeek, WED, MON_8.minusDays(1), ana);
    assertOwner(oneWeek, MON_8, MON_15.minusDays(1), ben);
    assertOwner(oneWeek, MON_15, MON_22.minusDays(1), cy);
    assertOwner(oneWeek, MON_22, MON_22.plusDays(6), ana);
    assertOwner(twoWeeks, WED, MON_15.minusDays(1), ana);
    assertOwner(twoWeeks, MON_15, MON_15.plusDays(13), ben);

    ChoreResponse response = choreService.getChore(householdId, twoWeeks, auth(owner));
    assertThat(response.schedule().rotationWeeks()).isEqualTo(2);
    assertThat(response.schedule().assignmentStrategy()).isEqualTo(AssignmentStrategy.ROUND_ROBIN);

    // The card says whose period it is and when it ends.
    var card = occurrenceService.occurrence(householdId, occurrenceOn(twoWeeks, WED), auth(ana));
    assertThat(card.week().owner().userId()).isEqualTo(ana);
    assertThat(card.week().until()).isEqualTo(LocalDate.of(2027, 3, 14));
    // Home: the viewer's periods, with who takes over.
    DashboardResponse dashboard = occurrenceService.dashboard(householdId, auth(ana));
    assertThat(dashboard.myWeeks())
        .extracting(DashboardResponse.MyWeek::title, DashboardResponse.MyWeek::until)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("Dishes", LocalDate.of(2027, 3, 7)),
            org.assertj.core.groups.Tuple.tuple("Kitchen", LocalDate.of(2027, 3, 14)));
    assertThat(dashboard.myWeeks().getFirst().next().userId()).isEqualTo(ben);
  }

  @Test
  void awayDaysInsideAPeriodGoToTheNextPersonAndTheOwnerKeepsTheRest() {
    UUID chore = daily("Dishes", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy0()), 1);
    awayModeService.set(
        householdId,
        ana,
        new AwayPeriodRequest(WED.plusDays(2), WED.plusDays(3), false, false),
        auth(ana));

    assertThat(people(chore, WED)).containsExactly(ana);
    assertThat(people(chore, WED.plusDays(1))).containsExactly(ana);
    assertThat(people(chore, WED.plusDays(2))).containsExactly(ben);
    assertThat(people(chore, WED.plusDays(3))).containsExactly(ben);
    assertThat(people(chore, WED.plusDays(4))).containsExactly(ana);
    assertThat(
            jdbc.queryForObject(
                "SELECT away_from_user_id FROM chore_assignments WHERE id=?",
                UUID.class,
                occurrenceOn(chore, WED.plusDays(2))))
        .isEqualTo(ana);
    // Ana still had that week; the next one is Ben's as planned.
    assertOwner(chore, MON_8, MON_15.minusDays(1), ben);
  }

  @Test
  void changingTheLengthReplansFromTheNextBoundaryAndKeepsAHandMadeChange() {
    UUID chore = daily("Dishes", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy0()), 1);
    LocalDate tuesday = MON_8.plusDays(2);
    occurrenceService.reassign(householdId, occurrenceOn(chore, tuesday), List.of(cy), auth(owner));

    update(chore, AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy), 2);

    // Ana keeps this week; the first two-week period starts on the next Monday.
    assertOwner(chore, WED, MON_8.minusDays(1), ana);
    for (LocalDate day = MON_8; day.isBefore(MON_22); day = day.plusDays(1)) {
      assertThat(people(chore, day)).containsExactly(day.equals(tuesday) ? cy : ben);
    }
    assertOwner(chore, MON_22, MON_22.plusDays(8), cy);
  }

  @Test
  void switchingFromTakeTurnsKeepsThisWeekAndOneOwnerAWeekAfterIt() {
    UUID chore = daily("Dishes", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy0()), null);
    Map<LocalDate, List<UUID>> before = plan(chore, WED, MON_8.minusDays(1));
    assertThat(before.values())
        .containsExactly(List.of(ana), List.of(ben), List.of(cy), List.of(ana), List.of(ben));

    update(chore, AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy), 1);

    assertThat(plan(chore, WED, MON_8.minusDays(1))).isEqualTo(before);
    // This week isn't anyone's week yet: no chip, and nothing on Home.
    assertThat(
            occurrenceService.occurrence(householdId, occurrenceOn(chore, WED), auth(ana)).week())
        .isNull();
    assertThat(occurrenceService.dashboard(householdId, auth(ana)).myWeeks()).isEmpty();
    assertThat(
            occurrenceService.occurrence(householdId, occurrenceOn(chore, MON_8), auth(ana)).week())
        .isNotNull();
    List<UUID> owners = new ArrayList<>();
    for (LocalDate monday = MON_8;
        monday.isBefore(MON_22.plusDays(7));
        monday = monday.plusDays(7)) {
      Map<LocalDate, List<UUID>> week = plan(chore, monday, monday.plusDays(6));
      assertThat(week.values().stream().distinct()).hasSize(1);
      owners.add(week.values().iterator().next().getFirst());
    }
    assertThat(owners).doesNotHaveDuplicates();

    // And back: the current owner keeps this week, Take turns from the next Monday.
    update(chore, AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy), null);
    assertThat(plan(chore, WED, MON_8.minusDays(1))).isEqualTo(before);
    assertThat(plan(chore, MON_8, MON_8.plusDays(2)).values().stream().distinct()).hasSize(3);
  }

  @Test
  void takeTurnsAssignsExactlyAsBefore() {
    UUID chore = daily("Dishes", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben, cy0()), null);
    List<UUID> expected = new ArrayList<>();
    for (int day = 0; day < 9; day++) {
      expected.add(List.of(ana, ben, cy).get(day % 3));
    }
    assertThat(plan(chore, WED, WED.plusDays(8)).values().stream().map(List::getFirst).toList())
        .isEqualTo(expected);
    String config =
        jdbc.queryForObject(
            "SELECT strategy_config::text FROM chore_schedules WHERE chore_id=?",
            String.class,
            chore);
    assertThat(config).doesNotContain("rotationWeeks").doesNotContain("everyone");
    ChoreResponse response = choreService.getChore(householdId, chore, auth(owner));
    assertThat(response.schedule().everyone()).isFalse();
    assertThat(response.schedule().rotationWeeks()).isNull();
  }

  @Test
  void weekByWeekIsOnePersonAtATimeOnARepeatingScheduleOnly() {
    assertThatThrownBy(
            () ->
                choreService.createChore(
                    householdId,
                    request("Two", schedule("FREQ=DAILY", List.of(ana, ben, owner), 2, false, 1)),
                    auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(ChoreService.WEEK_BY_WEEK_ONE_PERSON);
    assertThatThrownBy(
            () ->
                choreService.createChore(
                    householdId,
                    request("Long", schedule("FREQ=DAILY", List.of(ana, ben), 1, false, 9)),
                    auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(ChoreService.WEEK_BY_WEEK_LENGTH);
  }

  // ---- Batch create
  // -----------------------------------------------------------------------------

  @Test
  void theBatchIsAllOrNothingAndForAdminsOnly() {
    ChoreRequest good = request("Wash dishes", schedule("FREQ=DAILY", List.of(), 1, true, null));
    ChoreRequest alsoGood =
        request("Vacuum", schedule("FREQ=WEEKLY;BYDAY=WE", List.of(), 1, true, null));
    ChoreRequest bad =
        request(
            "Garbage",
            new ChoreScheduleRequest(
                null,
                null,
                null,
                null,
                NINE_PM,
                AssignmentStrategy.ROUND_ROBIN,
                null,
                List.of(),
                1,
                ScheduleKind.AS_NEEDED,
                null,
                null,
                true,
                2,
                true,
                2));

    assertThatThrownBy(
            () -> choreService.createChores(householdId, List.of(good, alsoGood, bad), auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(ChoreService.WEEK_BY_WEEK_CALENDAR_ONLY);
    assertThat(choreCount()).isZero();

    assertThatThrownBy(
            () -> choreService.createChores(householdId, List.of(good, alsoGood), auth(ana)))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    assertThat(choreCount()).isZero();

    List<ChoreResponse> created =
        choreService.createChores(householdId, List.of(good, alsoGood), auth(owner));
    assertThat(created).hasSize(2);
    assertThat(created).allSatisfy(chore -> assertThat(chore.schedule().everyone()).isTrue());
    assertThat(choreCount()).isEqualTo(2);
  }

  // ---- Helpers
  // ----------------------------------------------------------------------------------

  /** Cy is not a member until a test adds them; this adds Cy and returns them. */
  private UUID cy0() {
    addMember(cy, "MEMBER");
    return cy;
  }

  private void pin(OffsetDateTime at) {
    occurrenceService.useClock(Clock.fixed(at.toInstant(), ZoneOffset.UTC));
    awayModeService.useClock(Clock.fixed(at.toInstant(), ZoneOffset.UTC));
  }

  private UUID daily(
      String title,
      AssignmentStrategy strategy,
      List<UUID> participants,
      boolean everyone,
      Integer weeks) {
    return choreService
        .createChore(
            householdId,
            request(
                title,
                schedule(
                    "FREQ=DAILY",
                    participants == null ? List.of() : participants,
                    1,
                    everyone,
                    weeks)),
            auth(owner))
        .id();
  }

  private UUID daily(String title, AssignmentStrategy strategy, List<UUID> people, Integer weeks) {
    return daily(title, strategy, people, false, weeks);
  }

  private void update(UUID chore, AssignmentStrategy strategy, List<UUID> people, Integer weeks) {
    choreService.updateChore(
        householdId,
        chore,
        request("Dishes", schedule("FREQ=DAILY", people, 1, false, weeks)),
        auth(owner));
  }

  private static ChoreScheduleRequest schedule(
      String rule, List<UUID> people, int needed, boolean everyone, Integer weeks) {
    return new ChoreScheduleRequest(
        rule,
        null,
        WED,
        null,
        NINE_PM,
        AssignmentStrategy.ROUND_ROBIN,
        null,
        people,
        needed,
        ScheduleKind.CALENDAR,
        null,
        null,
        null,
        null,
        everyone,
        weeks);
  }

  private static ChoreRequest request(String title, ChoreScheduleRequest schedule) {
    return new ChoreRequest(title, null, null, null, null, null, false, schedule);
  }

  private void assertOwner(UUID chore, LocalDate from, LocalDate until, UUID expected) {
    Map<LocalDate, List<UUID>> plan = plan(chore, from, until);
    assertThat(plan).hasSize((int) (until.toEpochDay() - from.toEpochDay()) + 1);
    assertThat(plan.values()).allSatisfy(people -> assertThat(people).containsExactly(expected));
  }

  private List<UUID> participants(UUID chore) {
    return jdbc.queryForList(
        """
            SELECT value::uuid FROM chore_schedules s,
                   jsonb_array_elements_text(s.strategy_config->'participantUserIds')
                   WITH ORDINALITY AS p(value, position)
            WHERE s.chore_id=? ORDER BY position
            """,
        UUID.class,
        chore);
  }

  private UUID occurrenceOn(UUID chore, LocalDate day) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for=?",
        UUID.class,
        chore,
        day);
  }

  private List<UUID> people(UUID chore, LocalDate day) {
    return jdbc.queryForList(
        "SELECT aa.user_id FROM chore_assignment_assignees aa"
            + " JOIN chore_assignments a ON a.id=aa.assignment_id"
            + " WHERE a.chore_id=? AND a.planned_for=? AND a.status<>'CANCELLED'"
            + " ORDER BY aa.user_id",
        UUID.class,
        chore,
        day);
  }

  /** Each day's people from {@code from} to {@code until} (inclusive), skipping cancelled days. */
  private Map<LocalDate, List<UUID>> plan(UUID chore, LocalDate from, LocalDate until) {
    Map<LocalDate, List<UUID>> plan = new TreeMap<>();
    for (LocalDate day = from; !day.isAfter(until); day = day.plusDays(1)) {
      List<UUID> people = people(chore, day);
      if (!people.isEmpty()) {
        plan.put(day, people);
      }
    }
    return plan;
  }

  private Map<UUID, Integer> turns(UUID chore, LocalDate from, LocalDate until) {
    Map<UUID, Integer> turns = new java.util.HashMap<>();
    plan(chore, from, until).values().stream()
        .flatMap(List::stream)
        .forEach(userId -> turns.merge(userId, 1, Integer::sum));
    return turns;
  }

  private int choreCount() {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM chores WHERE household_id=?", Integer.class, householdId);
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "weeks-" + name.toLowerCase() + "-" + id + "@example.test",
        "Weeks " + name);
    return id;
  }

  /** Members join one minute apart, in the order they are added (the "everyone" order). */
  private void addMember(UUID userId, String role) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', TIMESTAMPTZ '2027-01-01 00:00:00+00' + ? * INTERVAL '1 minute')
            """,
        householdId,
        userId,
        role,
        joined++);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
