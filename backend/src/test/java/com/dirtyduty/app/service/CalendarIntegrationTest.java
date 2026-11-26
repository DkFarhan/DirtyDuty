package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.AssigneeResponse;
import com.dirtyduty.app.dto.chore.CalendarResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.household.AwayPeriodRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
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
 * The household calendar (6c): stored occurrences for a range, projections past the generated
 * horizon (checked against what generation later stores), the undated list and access rules. The
 * clocks are pinned to Wednesday, March 3, 2027 in Halifax (the 30-day horizon ends on April 1).
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class CalendarIntegrationTest {
  private static final LocalTime NINE_PM = LocalTime.of(21, 0);
  private static final LocalDate WED = LocalDate.of(2027, 3, 3);

  /** The first day past the horizon generated on {@link #WED}. */
  private static final LocalDate PAST_HORIZON = WED.plusDays(30);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private CalendarService calendarService;
  @Autowired private AwayModeService awayModeService;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private int joined;

  @BeforeEach
  void setUp() {
    pin(WED.atTime(14, 0).atOffset(ZoneOffset.UTC));
    owner = createUser("Oli");
    ana = createUser("Ana");
    ben = createUser("Ben");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Calendar', 'America/Halifax', ?)",
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

  @Test
  void storedOccurrencesHaveTheirPeopleAndDoneStateAndSkippedOnesAreLeftOut() {
    UUID chore =
        create("Dishes", "FREQ=DAILY", AssignmentStrategy.ROUND_ROBIN, List.of(ana, ben), 1, null);
    UUID today = occurrenceOn(chore, WED);
    UUID tomorrow = occurrenceOn(chore, WED.plusDays(1));
    occurrenceService.complete(householdId, today, auth(ana));
    occurrenceService.skip(householdId, tomorrow, auth(owner));

    CalendarResponse calendar = calendar(WED, WED.plusDays(6), owner);

    assertThat(calendar.days()).hasSize(7);
    assertThat(calendar.today()).isEqualTo(WED);
    assertThat(calendar.viewerRole()).isEqualTo("OWNER");
    assertThat(calendar.members())
        .extracting(CalendarResponse.Member::userId, CalendarResponse.Member::colorIndex)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(owner, 0),
            org.assertj.core.groups.Tuple.tuple(ana, 1),
            org.assertj.core.groups.Tuple.tuple(ben, 2));
    CalendarResponse.Item done = only(calendar, WED);
    assertThat(done.id()).isEqualTo(today);
    assertThat(done.status()).isEqualTo("COMPLETED");
    assertThat(done.projected()).isFalse();
    assertThat(done.assignees()).extracting(AssigneeResponse::userId).containsExactly(ana);
    assertThat(done.dueAt().toInstant())
        .isEqualTo(
            OccurrenceService.dueAt(WED, NINE_PM, java.time.ZoneId.of("America/Halifax"))
                .toInstant());
    assertThat(day(calendar, WED.plusDays(1))).isEmpty();
    CalendarResponse.Item friday = only(calendar, WED.plusDays(2));
    assertThat(friday.status()).isEqualTo("PENDING");
    assertThat(friday.assignees()).hasSize(1);
    // Each person's count over the shown days (done ones included, the skipped one not).
    assertThat(counts(calendar))
        .containsEntry(owner, 0)
        .containsEntry(ana, 4)
        .containsEntry(ben, 2);
  }

  @Test
  void projectionsMatchWhatGenerationLaterStoresIncludingAwayDays() {
    // Ben is away for part of the projected weeks; projections and generation both cover for him.
    awayModeService.set(
        householdId,
        ben,
        new AwayPeriodRequest(PAST_HORIZON.plusDays(1), PAST_HORIZON.plusDays(6), false, false),
        auth(ben));
    UUID weekly =
        create(
            "Bins",
            "FREQ=WEEKLY;BYDAY=MO,TH",
            AssignmentStrategy.ROUND_ROBIN,
            List.of(owner, ana, ben),
            1,
            null);
    UUID fortnightly =
        create(
            "Windows",
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
            AssignmentStrategy.FIXED,
            List.of(ana, ben),
            2,
            null);
    UUID weekByWeek =
        create(
            "Kitchen",
            "FREQ=DAILY",
            AssignmentStrategy.ROUND_ROBIN,
            List.of(ana, ben, owner),
            1,
            1);
    UUID takeTurns =
        create(
            "Dishes",
            "FREQ=DAILY",
            AssignmentStrategy.ROUND_ROBIN,
            List.of(owner, ana, ben),
            2,
            null);
    LocalDate until = PAST_HORIZON.plusDays(13);
    assertThat(occurrenceOnOrNull(takeTurns, PAST_HORIZON)).isNull();

    CalendarResponse calendar = calendar(PAST_HORIZON, until, owner);
    Map<UUID, Map<LocalDate, Set<UUID>>> projected = new HashMap<>();
    for (CalendarResponse.Day day : calendar.days()) {
      for (CalendarResponse.Item item : day.items()) {
        assertThat(item.projected()).isTrue();
        assertThat(item.toBeDecided()).isFalse();
        assertThat(item.id()).isNull();
        projected
            .computeIfAbsent(item.choreId(), id -> new TreeMap<>())
            .put(
                item.date(),
                item.assignees().stream()
                    .map(AssigneeResponse::userId)
                    .collect(Collectors.toSet()));
      }
    }
    // Nothing is stored by looking.
    assertThat(occurrenceOnOrNull(takeTurns, PAST_HORIZON)).isNull();

    // Two weeks later generation reaches the same days.
    pin(WED.plusDays(14).atTime(14, 0).atOffset(ZoneOffset.UTC));
    occurrenceService.generateHousehold(householdId);

    for (UUID chore : List.of(weekly, fortnightly, weekByWeek, takeTurns)) {
      assertThat(projected.get(chore))
          .as("projection of %s", chore)
          .isEqualTo(stored(chore, until));
    }
    // The fixed pair goes on without Ben while he's away; the rotations cover for him.
    LocalDate awaySaturday = LocalDate.of(2027, 4, 3);
    assertThat(projected.get(fortnightly)).containsEntry(awaySaturday, Set.of(ana));
    assertThat(projected.get(takeTurns).get(PAST_HORIZON.plusDays(4))).doesNotContain(ben);
    assertThat(projected.get(weekByWeek).values()).allSatisfy(p -> assertThat(p).hasSize(1));
  }

  @Test
  void balancedAndMixItUpAreProjectedWithoutAPerson() {
    UUID balanced =
        create("Laundry", "FREQ=DAILY", AssignmentStrategy.BALANCED, List.of(ana, ben), 1, null);
    UUID random =
        create("Mop", "FREQ=DAILY", AssignmentStrategy.RANDOM, List.of(ana, ben), 1, null);

    CalendarResponse calendar = calendar(PAST_HORIZON, PAST_HORIZON.plusDays(2), owner);

    List<CalendarResponse.Item> items =
        calendar.days().stream().flatMap(day -> day.items().stream()).toList();
    assertThat(items).hasSize(6);
    assertThat(items).extracting(CalendarResponse.Item::choreId).contains(balanced, random);
    assertThat(items)
        .allSatisfy(
            item -> {
              assertThat(item.projected()).isTrue();
              assertThat(item.toBeDecided()).isTrue();
              assertThat(item.assignees()).isEmpty();
            });
    assertThat(counts(calendar).values()).containsOnly(0);
  }

  @Test
  void aFixedChoreWhosePersonIsAwayIsNotProjectedOnThoseDays() {
    awayModeService.set(
        householdId,
        ana,
        new AwayPeriodRequest(PAST_HORIZON, PAST_HORIZON.plusDays(1), false, false),
        auth(ana));
    UUID plants = create("Plants", "FREQ=DAILY", AssignmentStrategy.FIXED, List.of(ana), 1, null);

    CalendarResponse calendar = calendar(PAST_HORIZON, PAST_HORIZON.plusDays(2), owner);

    assertThat(day(calendar, PAST_HORIZON)).isEmpty();
    assertThat(day(calendar, PAST_HORIZON.plusDays(1))).isEmpty();
    assertThat(only(calendar, PAST_HORIZON.plusDays(2)).choreId()).isEqualTo(plants);
  }

  @Test
  void whenNeededChoresWithNoDeadlineAreListedUndated() {
    UUID chore =
        choreService
            .createChore(
                householdId,
                new ChoreRequest(
                    "Restock paper",
                    null,
                    null,
                    null,
                    null,
                    null,
                    false,
                    new ChoreScheduleRequest(
                        null,
                        null,
                        null,
                        null,
                        null,
                        AssignmentStrategy.ROUND_ROBIN,
                        null,
                        List.of(ana, ben),
                        1,
                        ScheduleKind.AS_NEEDED,
                        null,
                        null,
                        false,
                        null)),
                auth(owner))
            .id();

    CalendarResponse calendar = calendar(WED, WED.plusDays(6), ana);
    assertThat(calendar.undated()).hasSize(1);
    CalendarResponse.Undated undated = calendar.undated().getFirst();
    assertThat(undated.choreId()).isEqualTo(chore);
    assertThat(undated.flagged()).isFalse();
    assertThat(undated.turn()).extracting(AssigneeResponse::userId).containsExactly(ana);
    assertThat(calendar.days()).allSatisfy(day -> assertThat(day.items()).isEmpty());
    assertThat(calendar.viewerRole()).isEqualTo("MEMBER");

    // Flagged, it still has no set date: it stays below the days rather than on today.
    occurrenceService.flag(householdId, undated.id(), auth(ben));
    CalendarResponse flagged = calendar(WED, WED, ana);
    assertThat(flagged.undated().getFirst().flagged()).isTrue();
    assertThat(day(flagged, WED)).isEmpty();
  }

  @Test
  void nonMembersGetNotFoundAndRangesAreLimited() {
    UUID outsider = createUser("Out");
    assertThatThrownBy(() -> calendar(WED, WED.plusDays(6), outsider))
        .isInstanceOf(ResourceNotFoundException.class);

    assertThat(calendar(WED, WED.plusDays(44), ana).days()).hasSize(45);
    assertThatThrownBy(() -> calendar(WED, WED.plusDays(45), ana))
        .isInstanceOf(InvalidHouseholdException.class);
    assertThatThrownBy(() -> calendar(WED, WED.minusDays(1), ana))
        .isInstanceOf(InvalidHouseholdException.class);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private CalendarResponse calendar(LocalDate from, LocalDate to, UUID viewer) {
    return calendarService.calendar(householdId, from, to, auth(viewer));
  }

  private static List<CalendarResponse.Item> day(CalendarResponse calendar, LocalDate date) {
    return calendar.days().stream()
        .filter(day -> day.date().equals(date))
        .findFirst()
        .orElseThrow()
        .items();
  }

  private static CalendarResponse.Item only(CalendarResponse calendar, LocalDate date) {
    List<CalendarResponse.Item> items = day(calendar, date);
    assertThat(items).hasSize(1);
    return items.getFirst();
  }

  private static Map<UUID, Integer> counts(CalendarResponse calendar) {
    return calendar.counts().stream()
        .collect(
            Collectors.toMap(
                CalendarResponse.MemberCount::userId, CalendarResponse.MemberCount::count));
  }

  /** Stored, shown occurrences of {@code chore} from {@link #PAST_HORIZON} to {@code until}. */
  private Map<LocalDate, Set<UUID>> stored(UUID chore, LocalDate until) {
    Map<LocalDate, Set<UUID>> plan = new TreeMap<>();
    jdbc.query(
        """
            SELECT a.planned_for, aa.user_id FROM chore_assignments a
            LEFT JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id
            WHERE a.chore_id=? AND a.planned_for>=? AND a.planned_for<=?
              AND a.status='PENDING'
            """,
        rs -> {
          Set<UUID> people =
              plan.computeIfAbsent(
                  rs.getObject("planned_for", LocalDate.class), day -> new java.util.HashSet<>());
          UUID userId = rs.getObject("user_id", UUID.class);
          if (userId != null) {
            people.add(userId);
          }
        },
        chore,
        PAST_HORIZON,
        until);
    return plan;
  }

  private UUID create(
      String title,
      String rule,
      AssignmentStrategy strategy,
      List<UUID> people,
      int needed,
      Integer weeks) {
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(
                title,
                null,
                null,
                null,
                null,
                null,
                false,
                new ChoreScheduleRequest(
                    rule,
                    null,
                    WED,
                    null,
                    NINE_PM,
                    strategy,
                    null,
                    people,
                    needed,
                    ScheduleKind.CALENDAR,
                    null,
                    null,
                    null,
                    null,
                    false,
                    weeks)),
            auth(owner))
        .id();
  }

  private UUID occurrenceOn(UUID chore, LocalDate day) {
    UUID id = occurrenceOnOrNull(chore, day);
    assertThat(id).isNotNull();
    return id;
  }

  private UUID occurrenceOnOrNull(UUID chore, LocalDate day) {
    return jdbc.query(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for=?",
        rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
        chore,
        day);
  }

  private void pin(OffsetDateTime at) {
    occurrenceService.useClock(Clock.fixed(at.toInstant(), ZoneOffset.UTC));
    awayModeService.useClock(Clock.fixed(at.toInstant(), ZoneOffset.UTC));
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "calendar-" + name.toLowerCase() + "-" + id + "@example.test",
        "Calendar " + name);
    return id;
  }

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
