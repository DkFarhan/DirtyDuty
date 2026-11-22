package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.chore.DashboardResponse;
import com.dirtyduty.app.dto.chore.HouseholdMemberStatsResponse;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.DayOfWeek;
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
 * Week credit on the Household bars, Home's week numbers and My Chores' Done list: completion
 * credit goes to whoever completed the chore, in the week they did it, and nobody's completed count
 * exceeds their assigned count.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class WeeklyStatsIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private OffsetDateTime now;
  private LocalDate today;
  private LocalDate monday;

  @BeforeEach
  void setUp() {
    // One pinned instant per test; stats, completions and the week window all read it. ("Needs
    // doing" and generation use the system clock, so the pin is taken from it.)
    now = OffsetDateTime.ofInstant(Instant.now().truncatedTo(ChronoUnit.SECONDS), ZoneOffset.UTC);
    occurrenceService.useClock(Clock.fixed(now.toInstant(), ZoneOffset.UTC));
    today = now.toLocalDate();
    monday = today.with(DayOfWeek.MONDAY);
    owner = createUser("owner");
    ana = createUser("ana");
    ben = createUser("ben");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Week', 'UTC', ?)",
        householdId,
        owner);
    addMember(owner, "OWNER");
    addMember(ana, "MEMBER");
    addMember(ben, "MEMBER");
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
  void completingSomeoneElsesCalendarChoreCreditsTheCompleter() {
    UUID dishes = calendarOccurrence("Dishes", today, "PENDING", ana);
    // Only assignees may complete a calendar chore in the app; the completion row can still name
    // someone else (assignees changed afterwards, older data). The stats must follow the row.
    markCompletedBy(dishes, ben, now);

    Map<UUID, HouseholdMemberStatsResponse> stats = stats();
    assertThat(stats.get(ben).completedThisWeek()).isEqualTo(1);
    assertThat(stats.get(ben).assignedThisWeek()).isEqualTo(1);
    assertThat(stats.get(ana).completedThisWeek()).isZero();
    assertThat(stats.get(ana).assignedThisWeek()).isEqualTo(1);
    assertNeverMoreCompletedThanAssigned(stats);

    assertThat(dashboard(ben).personalWeek()).isEqualTo(new DashboardResponse.PersonalWeek(1, 1));
    assertThat(dashboard(ana).personalWeek()).isEqualTo(new DashboardResponse.PersonalWeek(1, 0));
    assertThat(dashboard(ana).weekSummary().completedCount()).isEqualTo(1);
    assertThat(dashboard(ana).weekSummary().totalCount()).isEqualTo(1);
    // My Chores' Done lists it for Ben, who did it, not for Ana.
    assertThat(occurrenceService.myChores(householdId, "COMPLETED", auth(ben)))
        .extracting(AssignmentResponse::id)
        .containsExactly(dishes);
    assertThat(occurrenceService.myChores(householdId, "COMPLETED", auth(ana))).isEmpty();
  }

  @Test
  void aWhenNeededCopyPlannedForNextWeekCountsThisWeekForWhoeverDoesItToday() {
    UUID chore = whenNeeded("Recycling", 2, List.of(ana, ben));
    UUID open = openOf(chore);
    LocalDate nextTuesday = monday.plusDays(8);
    jdbc.update(
        "UPDATE chore_assignments SET scheduled_for=?, planned_for=?, due_at=? WHERE id=?",
        nextTuesday,
        nextTuesday,
        nextTuesday.atTime(LocalTime.of(20, 0)).atOffset(ZoneOffset.UTC),
        open);
    UUID turn = assignees(open).getFirst();
    UUID other = turn.equals(ana) ? ben : ana;

    Map<UUID, HouseholdMemberStatsResponse> before = stats();
    assertThat(before.get(turn).assignedThisWeek()).isZero();
    DashboardResponse.WeekSummary householdBefore = dashboard(owner).weekSummary();
    assertThat(householdBefore.totalCount()).isZero();

    occurrenceService.complete(householdId, open, auth(other));
    // The copy keeps its planned day next week; the credit still lands this week.
    assertThat(column(open, "scheduled_for", LocalDate.class)).isEqualTo(nextTuesday);
    // Keep the next copy out of this week whatever weekday the test runs on.
    jdbc.update(
        "UPDATE chore_assignments SET scheduled_for=?, planned_for=?, due_at=? WHERE id=?",
        nextTuesday,
        nextTuesday,
        nextTuesday.atTime(LocalTime.of(21, 0)).atOffset(ZoneOffset.UTC),
        openOf(chore));

    Map<UUID, HouseholdMemberStatsResponse> after = stats();
    assertThat(after.get(other).completedThisWeek()).isEqualTo(1);
    assertThat(after.get(other).assignedThisWeek()).isEqualTo(1);
    assertThat(after.get(turn).completedThisWeek()).isZero();
    assertThat(after.get(turn).assignedThisWeek()).isZero();
    assertNeverMoreCompletedThanAssigned(after);
    DashboardResponse.WeekSummary household = dashboard(owner).weekSummary();
    assertThat(household.completedCount()).isEqualTo(1);
    assertThat(household.totalCount()).isEqualTo(1);
    assertThat(dashboard(other).personalWeek()).isEqualTo(new DashboardResponse.PersonalWeek(1, 1));
  }

  @Test
  void needsDoingThenACompletionBySomeoneElseCreditsTheCompleter() {
    UUID chore = whenNeeded("Toilet paper", null, List.of(ana, ben));
    UUID open = openOf(chore);
    UUID turn = assignees(open).getFirst();
    UUID other = turn.equals(ana) ? ben : ana;

    occurrenceService.flag(householdId, open, auth(owner));
    occurrenceService.complete(householdId, open, auth(other));

    Map<UUID, HouseholdMemberStatsResponse> stats = stats();
    assertThat(stats.get(other).completedThisWeek()).isEqualTo(1);
    assertThat(stats.get(other).assignedThisWeek()).isEqualTo(1);
    // It was the turn-holder's for this week: assigned, not completed.
    assertThat(stats.get(turn).completedThisWeek()).isZero();
    assertThat(stats.get(turn).assignedThisWeek()).isEqualTo(1);
    assertNeverMoreCompletedThanAssigned(stats);
  }

  @Test
  void skippedOccurrencesAreNotAssigned() {
    calendarOccurrence("Windows", today, "SKIPPED", ana);
    UUID kept = calendarOccurrence("Floors", today, "PENDING", ana);
    calendarOccurrence("Oven", today, "CANCELLED", ana);

    Map<UUID, HouseholdMemberStatsResponse> stats = stats();
    assertThat(stats.get(ana).assignedThisWeek()).isEqualTo(1);
    assertThat(stats.get(ana).completedThisWeek()).isZero();
    assertThat(dashboard(ana).personalWeek()).isEqualTo(new DashboardResponse.PersonalWeek(1, 0));
    assertThat(dashboard(ana).weekSummary().totalCount()).isEqualTo(1);
    assertThat(kept).isNotNull();
  }

  @Test
  void aTwoPersonOccurrenceCompletedByOneCreditsOnlyThatOne() {
    UUID laundry = calendarOccurrence("Laundry", today, "PENDING", ana, ben);
    occurrenceService.complete(householdId, laundry, auth(ana));

    Map<UUID, HouseholdMemberStatsResponse> stats = stats();
    assertThat(stats.get(ana).completedThisWeek()).isEqualTo(1);
    assertThat(stats.get(ana).assignedThisWeek()).isEqualTo(1);
    assertThat(stats.get(ben).completedThisWeek()).isZero();
    assertThat(stats.get(ben).assignedThisWeek()).isEqualTo(1);
    assertNeverMoreCompletedThanAssigned(stats);
    assertThat(dashboard(ana).weekSummary().completedCount()).isEqualTo(1);
    assertThat(dashboard(ana).weekSummary().totalCount()).isEqualTo(1);
  }

  @Test
  void creditFollowsTheWeekOfTheCompletionAndCompletedNeverExceedsAssigned() {
    // Done late: planned last week, completed this week, counts this week.
    UUID late = calendarOccurrence("Bins", monday.minusDays(2), "PENDING", ana);
    markCompletedBy(late, ana, now);
    // Done early: planned this week, completed last week, counts in neither number this week.
    UUID early = calendarOccurrence("Fridge", today, "PENDING", ben);
    markCompletedBy(
        early, ben, monday.minusDays(1).atTime(LocalTime.NOON).atOffset(ZoneOffset.UTC));
    // A mix for everyone.
    UUID shared = calendarOccurrence("Garden", today, "PENDING", owner, ana);
    occurrenceService.complete(householdId, shared, auth(owner));
    calendarOccurrence("Bathroom", today, "PENDING", ben);
    UUID chore = whenNeeded("Soap", 3, List.of(owner, ana, ben));
    occurrenceService.complete(householdId, openOf(chore), auth(ben));

    Map<UUID, HouseholdMemberStatsResponse> stats = stats();
    assertThat(stats.get(ana).completedThisWeek()).isEqualTo(1);
    assertThat(stats.get(ben).completedThisWeek()).isEqualTo(1);
    assertThat(stats.get(owner).completedThisWeek()).isEqualTo(1);
    assertNeverMoreCompletedThanAssigned(stats);
    for (UUID member : List.of(owner, ana, ben)) {
      DashboardResponse dashboard = dashboard(member);
      assertThat(dashboard.personalWeek().assignedCount())
          .isEqualTo(stats.get(member).assignedThisWeek());
      assertThat(dashboard.personalWeek().completedCount())
          .isEqualTo(stats.get(member).completedThisWeek());
      assertThat(dashboard.weekSummary().completedCount())
          .isLessThanOrEqualTo(dashboard.weekSummary().totalCount());
    }
    assertThat(dashboard(owner).weekSummary().completedCount()).isEqualTo(3);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private static void assertNeverMoreCompletedThanAssigned(
      Map<UUID, HouseholdMemberStatsResponse> stats) {
    assertThat(stats.values())
        .allSatisfy(
            member ->
                assertThat(member.completedThisWeek())
                    .isLessThanOrEqualTo(member.assignedThisWeek()));
  }

  private Map<UUID, HouseholdMemberStatsResponse> stats() {
    return occurrenceService.members(householdId, auth(owner)).stream()
        .collect(Collectors.toMap(HouseholdMemberStatsResponse::userId, Function.identity()));
  }

  private DashboardResponse dashboard(UUID viewer) {
    return occurrenceService.dashboard(householdId, auth(viewer));
  }

  /** A one-off calendar occurrence (no schedule, so generation leaves it alone). */
  private UUID calendarOccurrence(String title, LocalDate day, String status, UUID... people) {
    UUID chore = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO chores (id, household_id, title, created_by_user_id) VALUES (?, ?, ?, ?)",
        chore,
        householdId,
        title,
        owner);
    UUID occurrence = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, assigned_to_user_id, scheduled_for, planned_for, due_at,
                 status, title_snapshot, priority_snapshot, difficulty_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NORMAL', 1)
            """,
        occurrence,
        householdId,
        chore,
        people[0],
        day,
        day,
        day.atTime(LocalTime.of(23, 59)).atOffset(ZoneOffset.UTC),
        status,
        title);
    for (UUID person : people) {
      jdbc.update(
          "INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id) "
              + "VALUES (?, ?, ?)",
          householdId,
          occurrence,
          person);
    }
    return occurrence;
  }

  private void markCompletedBy(UUID occurrence, UUID user, OffsetDateTime at) {
    jdbc.update(
        "INSERT INTO chore_completions (household_id, assignment_id, completed_by_user_id, "
            + "completed_at) VALUES (?, ?, ?, ?)",
        householdId,
        occurrence,
        user,
        at);
    jdbc.update("UPDATE chore_assignments SET status='COMPLETED' WHERE id=?", occurrence);
  }

  private UUID whenNeeded(String title, Integer backstopDays, List<UUID> participants) {
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
            backstopDays != null,
            backstopDays);
    return choreService
        .createChore(
            householdId,
            new ChoreRequest(title, null, null, null, null, null, false, schedule),
            auth(owner))
        .id();
  }

  private UUID openOf(UUID chore) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND status IN ('PENDING','SUBMITTED')",
        UUID.class,
        chore);
  }

  private List<UUID> assignees(UUID occurrence) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=?",
        UUID.class,
        occurrence);
  }

  private <T> T column(UUID occurrence, String name, Class<T> type) {
    return jdbc.queryForObject(
        "SELECT " + name + " FROM chore_assignments WHERE id=?", type, occurrence);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "week-" + label + "-" + id + "@example.test",
        "Week " + label);
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
