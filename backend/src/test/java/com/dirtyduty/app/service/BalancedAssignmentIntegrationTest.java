package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
 * Balanced assignment and fairness effort points (E8) on real PostgreSQL. The household is in UTC;
 * generation reads the system date, so the pinned clock is taken from it. Members joined 60 days
 * ago unless a test says otherwise, so they were present for the whole 28-day window.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class BalancedAssignmentIntegrationTest {
  private static final LocalTime SIX_PM = LocalTime.of(18, 0);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private EffortLedger effortLedger;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private UUID cy;
  private UUID historyChore;
  private LocalDate today;
  private OffsetDateTime now;

  @BeforeEach
  void setUp() {
    now = OffsetDateTime.ofInstant(Instant.now().truncatedTo(ChronoUnit.SECONDS), ZoneOffset.UTC);
    today = now.toLocalDate();
    occurrenceService.useClock(Clock.fixed(now.toInstant(), ZoneOffset.UTC));
    owner = createUser("Oli");
    ana = createUser("Ana");
    ben = createUser("Ben");
    cy = createUser("Cy");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Balanced', 'UTC', ?)",
        householdId,
        owner);
    addMember(owner, "OWNER", 60);
    addMember(ana, "MEMBER", 60);
    addMember(ben, "MEMBER", 60);
    addMember(cy, "MEMBER", 60);
    historyChore = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO chores (id, household_id, title, created_by_user_id)"
            + " VALUES (?, ?, 'Earlier work', ?)",
        historyChore,
        householdId,
        owner);
  }

  @AfterEach
  void cleanFixtures() {
    occurrenceService.useClock(null);
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

  // ---- Who gets it
  // -------------------------------------------------------------------------------

  @Test
  void picksTheLowestEffortPerPresentDay() {
    did(ana, 10, 3);
    did(ben, 4, 5);
    did(cy, 6, 2);

    UUID chore = weekly("Bathroom", List.of(ana, ben, cy), 1, 3);

    assertThat(assignees(occurrenceOn(chore, today))).containsExactly(ben);
  }

  @Test
  void pendingAssignedEffortCountsSoNobodyGetsThreeChoresInAWeek() {
    // Ana has done the least. Without counting what's already planned for her, she would get all
    // three of this week's chores; with it, each person gets one.
    did(ben, 1, 3);
    did(cy, 1, 3);

    UUID bathroom = weekly("Bathroom", List.of(ana, ben, cy), 1, 2);
    UUID kitchen = weekly("Kitchen", List.of(ana, ben, cy), 1, 2);
    UUID hallway = weekly("Hallway", List.of(ana, ben, cy), 1, 2);

    assertThat(assignees(occurrenceOn(bathroom, today))).containsExactly(ana);
    assertThat(
            List.of(
                assignees(occurrenceOn(bathroom, today)).getFirst(),
                assignees(occurrenceOn(kitchen, today)).getFirst(),
                assignees(occurrenceOn(hallway, today)).getFirst()))
        .containsExactlyInAnyOrder(ana, ben, cy);
  }

  @Test
  void aDailyChoreSpreadsOutAndNeverGoesToTheSamePersonTwoDaysRunning() {
    // Ben already has a heavy chore today (any chore counts): today goes to someone else.
    pending(ben, 5, today);

    UUID chore = daily("Dishes", List.of(ana, ben, cy), 3);

    Map<LocalDate, UUID> plan = singlePlan(chore);
    assertThat(plan.get(today)).isEqualTo(ana);
    for (int day = 0; day < 20; day++) {
      assertThat(plan.get(today.plusDays(day))).isNotEqualTo(plan.get(today.plusDays(day + 1)));
    }
  }

  @Test
  void aNewMemberCountsAtLeastSevenPresentDays() {
    // Ana and Ben: 14 points in 28 days (0.5 a day). Cy joined 2 days ago and did 2 points: 1 a
    // day over 2 days, but 2/7 with the minimum, so Cy is the lightest and gets it.
    jdbc.update(
        "UPDATE household_memberships SET joined_at=? WHERE household_id=? AND user_id=?",
        now.minusDays(2),
        householdId,
        cy);
    did(ana, 14, 10);
    did(ben, 14, 12);
    did(cy, 2, 1);

    UUID chore = weekly("Floors", List.of(ana, ben, cy), 1, 2);

    assertThat(assignees(occurrenceOn(chore, today))).containsExactly(cy);
    assertThat(effortLedger.presentDays(householdId, today.minusDays(28), today))
        .containsEntry(cy, 2)
        .containsEntry(ana, 28);
  }

  @Test
  void awayMembersAreSkippedAndTheirAwayDaysDontCountAgainstThem() {
    // Cy (no work at all) is away today: skipped. Ben was away for 14 of the last 28 days and did
    // 7 points in the 14 he was here (0.5 a day); Ana did 10 in 28 (about 0.36): Ana gets it. Over
    // all 28 days Ben would have looked lighter (0.25).
    awayPeriod(cy, today, today.plusDays(2));
    awayPeriod(ben, today.minusDays(16), today.minusDays(3));
    did(ben, 7, 2);
    did(ana, 10, 4);

    UUID chore = weekly("Laundry", List.of(ana, ben, cy), 1, 2);

    assertThat(assignees(occurrenceOn(chore, today))).containsExactly(ana);
    assertThat(effortLedger.presentDays(householdId, today.minusDays(28), today))
        .containsEntry(ben, 14);
  }

  @Test
  void tiesGoToWhoeverDidThisChoreLongestAgoThenParticipantOrder() {
    UUID chore = weekly("Bins", List.of(ana, ben, cy), 1, 3);
    UUID schedule = scheduleOf(chore);
    // Equal effort (3 each): Ana did these bins 2 days ago, Ben 10 days ago, Cy did other work.
    didThisChore(chore, schedule, ana, 2);
    didThisChore(chore, schedule, ben, 10);
    did(cy, 3, 5);

    replanFromScratch(chore);
    assertThat(assignees(occurrenceOn(chore, today))).containsExactly(cy);

    // Without Cy: Ana and Ben are equal, and Ben did it longer ago.
    awayPeriod(cy, today, today);
    replanFromScratch(chore);
    assertThat(assignees(occurrenceOn(chore, today))).containsExactly(ben);

    // Nothing done and nothing due today for either: the first participant.
    jdbc.update("DELETE FROM chore_completions WHERE household_id=?", householdId);
    UUID fresh = weekly("Mail", List.of(owner, ana), 1, 1);
    assertThat(assignees(occurrenceOn(fresh, today))).containsExactly(owner);
  }

  @Test
  void eachTimeTwoPicksTheTwoLightest() {
    did(ana, 10, 3);
    did(ben, 2, 3);
    did(cy, 4, 3);

    UUID chore = weekly("Yard", List.of(ana, ben, cy), 2, 3);

    assertThat(assignees(occurrenceOn(chore, today))).containsExactlyInAnyOrder(ben, cy);
  }

  // ---- Stability
  // ---------------------------------------------------------------------------------

  @Test
  void laterGenerationNeverReshufflesAndRunningItTwiceChangesNothing() {
    UUID chore = daily("Sweep", List.of(ana, ben), 2);
    Map<LocalDate, List<UUID>> planned = plan(chore);
    int notifications = notificationCount();

    // Ana's workload changes a lot after the plan was made: what's planned stays.
    did(ana, 20, 1);
    occurrenceService.generateHousehold(householdId);
    occurrenceService.generateHousehold(householdId);

    assertThat(plan(chore)).isEqualTo(planned);
    assertThat(notificationCount()).isEqualTo(notifications);
  }

  @Test
  void aWhoEditReplansFutureOccurrencesButNeverManualOverrides() {
    UUID chore = daily("Counters", List.of(ana, ben), 2);
    LocalDate overriddenDay = today.plusDays(3);
    UUID overridden = occurrenceOn(chore, overriddenDay);
    UUID other = assignees(overridden).contains(ana) ? ben : ana;
    occurrenceService.reassign(householdId, overridden, List.of(other), auth(owner));

    updateWho(chore, List.of(ana, ben, cy), 1, 2);

    Map<LocalDate, List<UUID>> plan = plan(chore);
    // Re-planned in date order: Cy (nothing done) is now in the spread.
    assertThat(plan.values().stream().filter(people -> people.contains(cy)).count())
        .isGreaterThan(5);
    assertThat(plan.get(overriddenDay)).containsExactly(other);
    // The re-plan is itself fair: nobody does it two days running (the override aside).
    for (int day = 0; day < 20; day++) {
      LocalDate first = today.plusDays(day);
      if (first.equals(overriddenDay) || first.plusDays(1).equals(overriddenDay)) {
        continue;
      }
      assertThat(plan.get(first)).isNotEqualTo(plan.get(first.plusDays(1)));
    }
  }

  // ---- Kinds
  // -------------------------------------------------------------------------------------

  @Test
  void afterItsDoneGoesToTheLightestAfterEachCompletion() {
    did(ana, 3, 4);
    did(cy, 5, 4);

    UUID chore = afterDone("Fridge", List.of(ana, ben, cy), 3);
    UUID first = openOf(chore);
    assertThat(assignees(first)).containsExactly(ben);

    occurrenceService.complete(householdId, first, auth(ben));

    // Ben now has 3 too; Ana and Ben tie, and Ben did this chore just now.
    assertThat(assignees(openOf(chore))).containsExactly(ana);
  }

  @Test
  void balancedIsRejectedForWhenNeededChores() {
    ChoreScheduleRequest schedule =
        new ChoreScheduleRequest(
            null,
            null,
            null,
            null,
            null,
            AssignmentStrategy.BALANCED,
            null,
            List.of(ana, ben),
            1,
            ScheduleKind.AS_NEEDED,
            null,
            null,
            true,
            2);
    assertThatThrownBy(
            () ->
                choreService.createChore(
                    householdId,
                    new ChoreRequest("Plants", null, null, null, 2, null, false, schedule),
                    auth(owner)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(ChoreService.BALANCED_NOT_FOR_AS_NEEDED);
  }

  // ---- Effort points
  // -----------------------------------------------------------------------------

  @Test
  void aCompletionSnapshotsTheChoresEffort() {
    UUID chore = weekly("Oven", List.of(ana, ben), 1, 4);
    UUID occurrence = occurrenceOn(chore, today);
    UUID doer = assignees(occurrence).getFirst();

    occurrenceService.complete(householdId, occurrence, auth(doer));

    assertThat(effortOf(occurrence)).isEqualTo(4);
    assertThat(effortLedger.completedEffort(householdId, now.minusDays(28), now))
        .containsEntry(doer, 4);
  }

  @Test
  void aLaterEffortChangeDoesNotAlterPastPoints() {
    UUID chore = weekly("Windows", List.of(ana, ben), 1, 4);
    UUID occurrence = occurrenceOn(chore, today);
    UUID doer = assignees(occurrence).getFirst();
    occurrenceService.complete(householdId, occurrence, auth(doer));

    updateWho(chore, List.of(ana, ben), 1, 1);

    assertThat(effortOf(occurrence)).isEqualTo(4);
    assertThat(effortLedger.completedEffort(householdId, now.minusDays(28), now))
        .containsEntry(doer, 4);
  }

  // ---- Fixtures
  // ----------------------------------------------------------------------------------

  private UUID weekly(String title, List<UUID> people, int eachTime, int effort) {
    String day = today.getDayOfWeek().name().substring(0, 2);
    return create(
        title,
        effort,
        new ChoreScheduleRequest(
            "FREQ=WEEKLY;BYDAY=" + day,
            null,
            today,
            null,
            SIX_PM,
            AssignmentStrategy.BALANCED,
            null,
            people,
            eachTime));
  }

  private UUID daily(String title, List<UUID> people, int effort) {
    return create(
        title,
        effort,
        new ChoreScheduleRequest(
            "FREQ=DAILY", null, today, null, SIX_PM, AssignmentStrategy.BALANCED, null, people, 1));
  }

  private UUID afterDone(String title, List<UUID> people, int effort) {
    return create(
        title,
        effort,
        new ChoreScheduleRequest(
            null,
            null,
            today,
            null,
            SIX_PM,
            AssignmentStrategy.BALANCED,
            null,
            people,
            1,
            ScheduleKind.AFTER_COMPLETION,
            3,
            IntervalUnit.DAY,
            null,
            null));
  }

  private UUID create(String title, int effort, ChoreScheduleRequest schedule) {
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, effort, null, false, schedule),
            auth(owner))
        .id();
  }

  /** The same daily or weekly schedule with new Who settings and effort. */
  private void updateWho(UUID chore, List<UUID> people, int eachTime, int effort) {
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT c.title, s.recurrence_rule FROM chores c JOIN chore_schedules s"
                + " ON s.chore_id=c.id WHERE c.id=?",
            chore);
    choreService.updateChore(
        householdId,
        chore,
        new ChoreRequest(
            (String) row.get("title"),
            null,
            null,
            null,
            effort,
            null,
            false,
            new ChoreScheduleRequest(
                (String) row.get("recurrence_rule"),
                null,
                today,
                null,
                SIX_PM,
                AssignmentStrategy.BALANCED,
                null,
                people,
                eachTime)),
        auth(owner));
  }

  /** Drops the chore's pending occurrences and generates them again, as for a new chore. */
  private void replanFromScratch(UUID chore) {
    jdbc.update(
        "DELETE FROM chore_assignment_assignees WHERE assignment_id IN"
            + " (SELECT id FROM chore_assignments WHERE chore_id=? AND status='PENDING')",
        chore);
    jdbc.update(
        "DELETE FROM notifications WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id IN"
            + " (SELECT id FROM chore_assignments WHERE chore_id=? AND status='PENDING')",
        chore);
    jdbc.update("DELETE FROM chore_assignments WHERE chore_id=? AND status='PENDING'", chore);
    occurrenceService.generateHousehold(householdId);
  }

  /** {@code points} of completed work, done {@code daysAgo} days ago. */
  private void did(UUID user, int points, int daysAgo) {
    // One completion is worth at most 5 points, so larger amounts are several completions.
    for (int left = points; left > 0; left -= 5) {
      int chunk = Math.min(5, left);
      UUID occurrence = UUID.randomUUID();
      jdbc.update(
          """
              INSERT INTO chore_assignments
                  (id, household_id, chore_id, scheduled_for, status, title_snapshot,
                   priority_snapshot, difficulty_snapshot)
              VALUES (?, ?, ?, ?, 'COMPLETED', 'Earlier work', 'NORMAL', ?)
              """,
          occurrence,
          householdId,
          historyChore,
          today.minusDays(daysAgo),
          chunk);
      complete(occurrence, user, chunk, daysAgo);
    }
  }

  /** {@code user} did this chore {@code daysAgo} days ago (effort 3). */
  private void didThisChore(UUID chore, UUID schedule, UUID user, int daysAgo) {
    UUID occurrence = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, schedule_id, scheduled_for, planned_for, status,
                 title_snapshot, priority_snapshot, difficulty_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 'Done', 'NORMAL', 3)
            """,
        occurrence,
        householdId,
        chore,
        schedule,
        today.minusDays(daysAgo),
        today.minusDays(daysAgo));
    complete(occurrence, user, 3, daysAgo);
  }

  private void complete(UUID occurrence, UUID user, int points, int daysAgo) {
    jdbc.update(
        """
            INSERT INTO chore_completions
                (household_id, assignment_id, completed_by_user_id, completed_at, effort_points)
            VALUES (?, ?, ?, ?, ?)
            """,
        householdId,
        occurrence,
        user,
        now.minusDays(daysAgo),
        points);
  }

  /** A pending occurrence of another chore, already given to {@code user}. */
  private void pending(UUID user, int effort, LocalDate day) {
    UUID occurrence = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, assigned_to_user_id, scheduled_for, status,
                 title_snapshot, priority_snapshot, difficulty_snapshot)
            VALUES (?, ?, ?, ?, ?, 'PENDING', 'Other', 'NORMAL', ?)
            """,
        occurrence,
        householdId,
        historyChore,
        user,
        day,
        effort);
    jdbc.update(
        "INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)"
            + " VALUES (?, ?, ?)",
        householdId,
        occurrence,
        user);
  }

  private void awayPeriod(UUID user, LocalDate from, LocalDate until) {
    jdbc.update(
        "INSERT INTO member_away_periods (household_id, user_id, starts_on, ends_on)"
            + " VALUES (?, ?, ?, ?)",
        householdId,
        user,
        from,
        until);
  }

  private UUID scheduleOf(UUID chore) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_schedules WHERE chore_id=?", UUID.class, chore);
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

  private List<UUID> assignees(UUID occurrence) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
        UUID.class,
        occurrence);
  }

  private Map<LocalDate, List<UUID>> plan(UUID chore) {
    Map<LocalDate, List<UUID>> plan = new LinkedHashMap<>();
    for (Map<String, Object> row :
        jdbc.queryForList(
            "SELECT id, planned_for FROM chore_assignments"
                + " WHERE chore_id=? AND status='PENDING' ORDER BY planned_for",
            chore)) {
      plan.put(
          ((java.sql.Date) row.get("planned_for")).toLocalDate(), assignees((UUID) row.get("id")));
    }
    return plan;
  }

  private Map<LocalDate, UUID> singlePlan(UUID chore) {
    Map<LocalDate, UUID> single = new LinkedHashMap<>();
    plan(chore).forEach((day, people) -> single.put(day, people.getFirst()));
    return single;
  }

  private int effortOf(UUID occurrence) {
    return jdbc.queryForObject(
        "SELECT effort_points FROM chore_completions WHERE assignment_id=?",
        Integer.class,
        occurrence);
  }

  private int notificationCount() {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM notification_events WHERE household_id=?",
        Integer.class,
        householdId);
  }

  private UUID createUser(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "balanced-" + name.toLowerCase() + "-" + id + "@example.test",
        "Balanced " + name);
    return id;
  }

  private void addMember(UUID userId, String role, int joinedDaysAgo) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', ?)
            """,
        householdId,
        userId,
        role,
        now.minusDays(joinedDaysAgo));
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
