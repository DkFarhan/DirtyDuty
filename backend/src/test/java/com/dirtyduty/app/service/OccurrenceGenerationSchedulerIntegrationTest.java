package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreResponse;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key"
    })
class OccurrenceGenerationSchedulerIntegrationTest {
  private static final int HORIZON_DAYS = 30;

  @Autowired private JdbcTemplate jdbc;
  @Autowired private OccurrenceGenerationScheduler generationScheduler;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private ChoreService choreService;
  @MockitoBean private WebPushClient webPushClient;

  @Value("${app.chores.generation.enabled}")
  private boolean generationEnabledInTests;

  private final List<UUID> householdIds = new ArrayList<>();
  private final List<UUID> userIds = new ArrayList<>();

  @AfterEach
  void cleanFixtures() {
    for (UUID householdId : householdIds) {
      jdbc.update(
          """
              DELETE FROM notifications
              WHERE (reference_type='CHORE_ASSIGNMENT'
                     AND reference_id IN (SELECT id FROM chore_assignments WHERE household_id=?))
                 OR event_id IN (SELECT id FROM notification_events WHERE household_id=?)
              """,
          householdId,
          householdId);
      jdbc.update("DELETE FROM notification_events WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM activity_events WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_completions WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_categories WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM households WHERE id=?", householdId);
    }
    for (UUID userId : userIds) {
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    householdIds.clear();
    userIds.clear();
  }

  @Test
  void backgroundJobIsDisabledForTheTestSuite() {
    assertThat(generationEnabledInTests).isFalse();
  }

  @Test
  void fillsAnUnopenedHouseholdUpToTheHorizonAndRespectsEndsOn() {
    Fixture home = createHousehold("horizon");
    LocalDate today = today();
    UUID openEnded = createWeeklySchedule(home, today, null, null);
    UUID ending = createWeeklySchedule(home, today, today.plusDays(10), null);

    generationScheduler.run();

    assertThat(scheduledDates(openEnded))
        .containsExactly(
            today, today.plusDays(7), today.plusDays(14), today.plusDays(21), today.plusDays(28));
    assertThat(scheduledDates(openEnded))
        .allSatisfy(date -> assertThat(date).isBefore(today.plusDays(HORIZON_DAYS)));
    assertThat(scheduledDates(ending)).containsExactly(today, today.plusDays(7));
  }

  @Test
  void runningTwiceCreatesNoDuplicates() {
    Fixture home = createHousehold("idempotent");
    UUID scheduleId = createWeeklySchedule(home, today(), null, null);

    generationScheduler.run();
    List<Map<String, Object>> first = occurrenceRows(scheduleId);
    generationScheduler.run();

    assertThat(first).hasSize(5);
    assertThat(occurrenceRows(scheduleId)).containsExactlyElementsOf(first);
  }

  @Test
  void leavesPausedInactiveArchivedAndScheduleLessHouseholdsUntouched() {
    Fixture paused = createHousehold("paused");
    UUID pausedSchedule = createWeeklySchedule(paused, today(), null, null);
    jdbc.update("UPDATE chore_schedules SET is_active=FALSE WHERE id=?", pausedSchedule);

    Fixture inactive = createHousehold("inactive");
    UUID inactiveSchedule = createWeeklySchedule(inactive, today(), null, null);
    jdbc.update(
        "UPDATE chores SET is_active=FALSE WHERE id=(SELECT chore_id FROM chore_schedules WHERE id=?)",
        inactiveSchedule);

    Fixture archived = createHousehold("archived");
    UUID archivedSchedule = createWeeklySchedule(archived, today(), null, null);
    jdbc.update(
        """
            UPDATE chores SET is_active=FALSE, archived_at=NOW()
            WHERE id=(SELECT chore_id FROM chore_schedules WHERE id=?)
            """,
        archivedSchedule);

    Fixture empty = createHousehold("empty");

    generationScheduler.run();

    for (Fixture fixture : List.of(paused, inactive, archived, empty)) {
      assertThat(assignmentCount(fixture.householdId())).isZero();
      assertThat(choreAssignedEvents(fixture.householdId())).isZero();
    }
  }

  @Test
  void preservesExitCancelledSubmittedCompletedAndPendingAssignees() {
    Fixture home = createHousehold("preserve");
    UUID memberId = createUser("preserve-member");
    addMember(home.householdId(), memberId);
    LocalDate today = today();
    UUID scheduleId = createWeeklySchedule(home, today, null, null);
    generationScheduler.run();

    UUID completed = occurrenceOn(scheduleId, today);
    UUID submitted = occurrenceOn(scheduleId, today.plusDays(7));
    UUID exitCancelled = occurrenceOn(scheduleId, today.plusDays(14));
    UUID pending = occurrenceOn(scheduleId, today.plusDays(21));
    jdbc.update("UPDATE chore_assignments SET status='COMPLETED' WHERE id=?", completed);
    jdbc.update("UPDATE chore_assignments SET status='SUBMITTED' WHERE id=?", submitted);
    jdbc.update(
        """
            UPDATE chore_assignments SET status='CANCELLED', cancelled_by_membership_exit=TRUE
            WHERE id=?
            """,
        exitCancelled);
    // Point the schedule at another member: background generation must not reassign pending work.
    jdbc.update(
        "UPDATE chore_schedules SET fixed_assignee_user_id=? WHERE id=?", memberId, scheduleId);
    List<Map<String, Object>> before = occurrenceRows(scheduleId);
    List<UUID> pendingAssigneesBefore = assignees(pending);

    generationScheduler.run();

    assertThat(occurrenceRows(scheduleId)).containsExactlyElementsOf(before);
    assertThat(status(completed)).isEqualTo("COMPLETED");
    assertThat(status(submitted)).isEqualTo("SUBMITTED");
    assertThat(status(exitCancelled)).isEqualTo("CANCELLED");
    assertThat(assignees(pending)).containsExactlyElementsOf(pendingAssigneesBefore);
    assertThat(pendingAssigneesBefore).containsExactly(home.ownerId());
  }

  @Test
  void notificationSchedulerPlansRemindersForBackgroundGeneratedOccurrences() {
    Fixture home = createHousehold("reminders");
    LocalDate dueDate = today().plusDays(2);
    UUID scheduleId = createWeeklySchedule(home, dueDate, null, LocalTime.NOON);

    generationScheduler.run();
    UUID occurrenceId = occurrenceOn(scheduleId, dueDate);
    OffsetDateTime dueAt = OccurrenceService.dueAt(dueDate, LocalTime.NOON, ZoneOffset.UTC);
    assertThat(dueAt(occurrenceId).toInstant()).isEqualTo(dueAt.toInstant());
    assertThat(pendingReminders(occurrenceId)).isEmpty();

    notificationScheduler.run();

    List<Map<String, Object>> reminders = pendingReminders(occurrenceId);
    assertThat(reminders).isNotEmpty();
    assertThat(reminders)
        .extracting(row -> (String) row.get("type"))
        .contains("CHORE_DUE_SOON", "CHORE_DUE_NOW", "CHORE_OVERDUE");
    assertThat(reminders)
        .allSatisfy(
            row ->
                assertThat(instant(row.get("scheduled_at")))
                    .isAfter(OffsetDateTime.now(ZoneOffset.UTC).toInstant()));
  }

  @Test
  void farFutureOneTimeChoreIsCreatedAndAnnouncedOnceAtCreation() {
    Fixture home = createHousehold("one-time-far");
    LocalDate dueDate = today().plusDays(45);

    ChoreResponse created =
        choreService.createChore(
            home.householdId(),
            oneTimeRequest("Far future chore", dueDate, home.ownerId()),
            authentication(home.ownerId()));
    UUID scheduleId = scheduleIdForChore(created.id());

    List<Map<String, Object>> atCreation = occurrenceRows(scheduleId);
    assertThat(atCreation).hasSize(1);
    assertThat(localDate(atCreation.getFirst().get("scheduled_for"))).isEqualTo(dueDate);
    assertThat(atCreation.getFirst().get("status")).isEqualTo("PENDING");
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);

    generationScheduler.run();
    generationScheduler.run();

    assertThat(occurrenceRows(scheduleId)).containsExactlyElementsOf(atCreation);
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);
  }

  @Test
  void reschedulingOneTimeChoreAcrossTheHorizonKeepsOneOccurrenceAndReplansReminders() {
    Fixture home = createHousehold("one-time-move");
    LocalDate near = today().plusDays(10);
    LocalDate far = today().plusDays(45);
    UUID choreId =
        choreService
            .createChore(
                home.householdId(),
                oneTimeRequest("Movable chore", near, home.ownerId()),
                authentication(home.ownerId()))
            .id();
    UUID scheduleId = scheduleIdForChore(choreId);
    UUID occurrenceId = occurrenceOn(scheduleId, near);
    notificationScheduler.run();
    List<UUID> nearReminders = pendingReminderIds(occurrenceId);
    assertThat(nearReminders).isNotEmpty();

    choreService.updateChore(
        home.householdId(),
        choreId,
        oneTimeRequest("Movable chore", far, home.ownerId()),
        authentication(home.ownerId()));

    assertLiveOccurrence(scheduleId, occurrenceId, far);
    assertThat(pendingReminderIds(occurrenceId)).isEmpty();
    generationScheduler.run();
    assertLiveOccurrence(scheduleId, occurrenceId, far);
    notificationScheduler.run();
    List<UUID> farReminders = pendingReminderIds(occurrenceId);
    assertThat(farReminders).isNotEmpty().doesNotContainAnyElementsOf(nearReminders);
    assertRemindersBefore(occurrenceId, dueAtNoon(far));

    choreService.updateChore(
        home.householdId(),
        choreId,
        oneTimeRequest("Movable chore", near, home.ownerId()),
        authentication(home.ownerId()));
    generationScheduler.run();
    notificationScheduler.run();

    assertLiveOccurrence(scheduleId, occurrenceId, near);
    // Returning to an earlier deadline re-plans its reminders as fresh rows; the cancelled ones
    // from the first plan stay cancelled as history.
    List<UUID> restoredReminders = pendingReminderIds(occurrenceId);
    assertThat(restoredReminders)
        .hasSameSizeAs(nearReminders)
        .doesNotContainAnyElementsOf(farReminders)
        .doesNotContainAnyElementsOf(nearReminders);
    assertRemindersBefore(occurrenceId, dueAtNoon(near));
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);
  }

  @Test
  void existingFarFutureOneTimeScheduleWithoutOccurrenceIsCreatedOnceByTheFirstRun() {
    // Simulates a one-time chore saved before this change, when its date was beyond the horizon.
    Fixture home = createHousehold("one-time-backfill");
    LocalDate dueDate = today().plusDays(45);
    UUID scheduleId = createOneTimeSchedule(home, dueDate, LocalTime.NOON);
    assertThat(occurrenceRows(scheduleId)).isEmpty();

    generationScheduler.run();

    List<Map<String, Object>> created = occurrenceRows(scheduleId);
    assertThat(created).hasSize(1);
    assertThat(localDate(created.getFirst().get("scheduled_for"))).isEqualTo(dueDate);
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);

    generationScheduler.run();

    assertThat(occurrenceRows(scheduleId)).containsExactlyElementsOf(created);
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);
  }

  private void assertLiveOccurrence(UUID scheduleId, UUID occurrenceId, LocalDate date) {
    List<Map<String, Object>> live =
        jdbc.queryForList(
            """
                SELECT id, scheduled_for FROM chore_assignments
                WHERE schedule_id=? AND status IN ('PENDING','SUBMITTED')
                """,
            scheduleId);
    assertThat(live).hasSize(1);
    assertThat(live.getFirst().get("id")).isEqualTo(occurrenceId);
    assertThat(localDate(live.getFirst().get("scheduled_for"))).isEqualTo(date);
    assertThat(dueAt(occurrenceId).toInstant()).isEqualTo(dueAtNoon(date).toInstant());
  }

  private void assertRemindersBefore(UUID occurrenceId, OffsetDateTime dueAt) {
    List<Map<String, Object>> reminders = pendingReminders(occurrenceId);
    assertThat(reminders).isNotEmpty();
    assertThat(reminders)
        .filteredOn(row -> !"CHORE_OVERDUE".equals(row.get("type")))
        .allSatisfy(
            row ->
                assertThat(instant(row.get("scheduled_at")))
                    .isBeforeOrEqualTo(dueAt.toInstant())
                    .isAfter(dueAt.minusDays(2).toInstant()));
  }

  private static LocalDate localDate(Object value) {
    return value instanceof java.sql.Date date ? date.toLocalDate() : (LocalDate) value;
  }

  private static java.time.Instant instant(Object value) {
    return value instanceof java.sql.Timestamp timestamp
        ? timestamp.toInstant()
        : ((OffsetDateTime) value).toInstant();
  }

  private static OffsetDateTime dueAtNoon(LocalDate date) {
    return OccurrenceService.dueAt(date, LocalTime.NOON, ZoneOffset.UTC);
  }

  private static LocalDate today() {
    return LocalDate.now(ZoneOffset.UTC);
  }

  private ChoreRequest oneTimeRequest(String title, LocalDate dueDate, UUID assigneeId) {
    return new ChoreRequest(
        title,
        null,
        null,
        null,
        null,
        null,
        false,
        new ChoreScheduleRequest(
            "FREQ=ONCE",
            "UTC",
            dueDate,
            null,
            LocalTime.NOON,
            AssignmentStrategy.FIXED,
            assigneeId,
            null,
            null));
  }

  private Fixture createHousehold(String label) {
    UUID ownerId = createUser(label + "-owner");
    UUID householdId = UUID.randomUUID();
    householdIds.add(householdId);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Generation test', 'UTC', ?)",
        householdId,
        ownerId);
    addMember(householdId, ownerId, "OWNER");
    return new Fixture(householdId, ownerId);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', 'Generation test')",
        id,
        label + "-" + id + "@example.test");
    return id;
  }

  private void addMember(UUID householdId, UUID userId) {
    addMember(householdId, userId, "MEMBER");
  }

  private void addMember(UUID householdId, UUID userId, String role) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', NOW())
            """,
        householdId,
        userId,
        role);
  }

  private UUID createChore(Fixture home) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
            VALUES (?, ?, 'Generation test chore', 'NORMAL', 1, ?)
            """,
        id,
        home.householdId(),
        home.ownerId());
    return id;
  }

  private UUID createWeeklySchedule(
      Fixture home, LocalDate startsOn, LocalDate endsOn, LocalTime dueTime) {
    String day = startsOn.getDayOfWeek().name().substring(0, 2);
    return insertSchedule(home, "FREQ=WEEKLY;BYDAY=" + day, startsOn, endsOn, dueTime);
  }

  private UUID createOneTimeSchedule(Fixture home, LocalDate startsOn, LocalTime dueTime) {
    return insertSchedule(home, "FREQ=ONCE", startsOn, null, dueTime);
  }

  private UUID insertSchedule(
      Fixture home, String rule, LocalDate startsOn, LocalDate endsOn, LocalTime dueTime) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_schedules
                (id, household_id, chore_id, recurrence_rule, timezone, starts_on, ends_on,
                 due_time, assignment_strategy, fixed_assignee_user_id, strategy_config)
            VALUES (?, ?, ?, ?, 'UTC', ?, ?, ?, 'FIXED', ?, '{"peopleNeeded":1}'::jsonb)
            """,
        id,
        home.householdId(),
        createChore(home),
        rule,
        startsOn,
        endsOn,
        dueTime,
        home.ownerId());
    return id;
  }

  private List<LocalDate> scheduledDates(UUID scheduleId) {
    return jdbc.queryForList(
        """
            SELECT scheduled_for FROM chore_assignments
            WHERE schedule_id=? AND status<>'CANCELLED' ORDER BY scheduled_for
            """,
        LocalDate.class,
        scheduleId);
  }

  private List<Map<String, Object>> occurrenceRows(UUID scheduleId) {
    return jdbc.queryForList(
        """
            SELECT id, scheduled_for, due_at, status, assigned_to_user_id,
                   cancelled_by_membership_exit
            FROM chore_assignments WHERE schedule_id=? ORDER BY scheduled_for, id
            """,
        scheduleId);
  }

  private UUID occurrenceOn(UUID scheduleId, LocalDate date) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE schedule_id=? AND scheduled_for=?",
        UUID.class,
        scheduleId,
        date);
  }

  private UUID scheduleIdForChore(UUID choreId) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_schedules WHERE chore_id=?", UUID.class, choreId);
  }

  private String status(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT status FROM chore_assignments WHERE id=?", String.class, assignmentId);
  }

  private OffsetDateTime dueAt(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT due_at FROM chore_assignments WHERE id=?", OffsetDateTime.class, assignmentId);
  }

  private List<UUID> assignees(UUID assignmentId) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
        UUID.class,
        assignmentId);
  }

  private int assignmentCount(UUID householdId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM chore_assignments WHERE household_id=?", Integer.class, householdId);
  }

  private int choreAssignedEvents(UUID householdId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM notification_events WHERE household_id=? AND event_type='CHORE_ASSIGNED'",
        Integer.class,
        householdId);
  }

  private List<Map<String, Object>> pendingReminders(UUID assignmentId) {
    return jdbc.queryForList(
        """
            SELECT id, type, scheduled_at FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
              AND type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
            ORDER BY scheduled_at, id
            """,
        assignmentId);
  }

  private List<UUID> pendingReminderIds(UUID assignmentId) {
    return pendingReminders(assignmentId).stream().map(row -> (UUID) row.get("id")).toList();
  }

  private Authentication authentication(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }

  private record Fixture(UUID householdId, UUID ownerId) {}
}
