package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.WebPushClient;
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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key"
    })
class OneTimePauseAndReminderReplanIntegrationTest {
  private static final String PAST_DUE_MESSAGE =
      "This chore's due date has passed. Choose a new due date.";

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private HouseholdSettingsService householdSettingsService;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private PlatformTransactionManager transactionManager;
  @MockitoBean private WebPushClient webPushClient;

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
      jdbc.update(
          "DELETE FROM recurring_chore_assignment_announcements WHERE schedule_id IN "
              + "(SELECT id FROM chore_schedules WHERE household_id=?)",
          householdId);
      jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_categories WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM households WHERE id=?", householdId);
    }
    for (UUID userId : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", userId);
      jdbc.update("DELETE FROM push_subscriptions WHERE user_id=?", userId);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    householdIds.clear();
    userIds.clear();
  }

  // ---- Defect 1: pause and activate ----

  @Test
  void pausedFutureOneTimeChoreReactivatesTheSameOccurrenceWithFreshReminders() {
    Fixture home = createHousehold("pause-future");
    LocalDate dueDate = today().plusDays(5);
    UUID choreId = createOneTimeChore(home, dueDate, home.ownerId());
    UUID occurrenceId = onlyOccurrence(choreId);
    notificationScheduler.run();
    List<Reminder> original = pendingReminders(occurrenceId);
    assertThat(original).isNotEmpty();

    choreService.pauseChore(home.householdId(), choreId, auth(home.ownerId()));

    assertThat(status(occurrenceId)).isEqualTo("CANCELLED");
    assertThat(pendingReminders(occurrenceId)).isEmpty();

    choreService.activateChore(home.householdId(), choreId, auth(home.ownerId()));

    assertThat(occurrenceIds(choreId)).containsExactly(occurrenceId);
    assertThat(status(occurrenceId)).isEqualTo("PENDING");
    assertThat(assignees(occurrenceId)).containsExactly(home.ownerId());
    assertThat(dueAt(occurrenceId)).isEqualTo(noon(dueDate).toInstant());
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);

    notificationScheduler.run();

    assertThat(slots(pendingReminders(occurrenceId))).containsExactlyElementsOf(slots(original));
  }

  @Test
  void activatingAOneTimeChoreWhoseDueDateHasPassedIsRejected() {
    Fixture home = createHousehold("pause-past");
    UUID choreId = createOneTimeChore(home, today().plusDays(5), home.ownerId());
    UUID occurrenceId = onlyOccurrence(choreId);
    choreService.pauseChore(home.householdId(), choreId, auth(home.ownerId()));
    // Simulate the due date passing while the chore was paused.
    LocalDate yesterday = today().minusDays(1);
    jdbc.update("UPDATE chore_schedules SET starts_on=? WHERE chore_id=?", yesterday, choreId);
    jdbc.update(
        "UPDATE chore_assignments SET scheduled_for=?, due_at=? WHERE id=?",
        yesterday,
        noon(yesterday),
        occurrenceId);

    assertThatThrownBy(
            () -> choreService.activateChore(home.householdId(), choreId, auth(home.ownerId())))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(PAST_DUE_MESSAGE);

    assertThat(scheduleActive(choreId)).isFalse();
    assertThat(status(occurrenceId)).isEqualTo("CANCELLED");
  }

  @Test
  void pausedOneTimeChoreCanBeMovedToANewDateAndActivatedWithoutANewAnnouncement() {
    Fixture home = createHousehold("pause-edit");
    LocalDate firstDate = today().plusDays(5);
    LocalDate newDate = today().plusDays(12);
    UUID choreId = createOneTimeChore(home, firstDate, home.ownerId());
    UUID original = onlyOccurrence(choreId);
    choreService.pauseChore(home.householdId(), choreId, auth(home.ownerId()));

    choreService.updateChore(
        home.householdId(), choreId, oneTimeRequest(newDate, home.ownerId()), auth(home.ownerId()));
    choreService.activateChore(home.householdId(), choreId, auth(home.ownerId()));

    List<Map<String, Object>> live = liveOccurrences(choreId);
    assertThat(live).hasSize(1);
    assertThat(localDate(live.getFirst().get("scheduled_for"))).isEqualTo(newDate);
    assertThat(assignees((UUID) live.getFirst().get("id"))).containsExactly(home.ownerId());
    // The cancelled occurrence on the old date stays as history.
    assertThat(status(original)).isEqualTo("CANCELLED");
    assertThat(scheduledFor(original)).isEqualTo(firstDate);
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);
  }

  @Test
  void repeatedPauseAndActivateCyclesKeepOneOccurrenceAndOneAnnouncement() {
    Fixture home = createHousehold("pause-cycles");
    UUID choreId = createOneTimeChore(home, today().plusDays(5), home.ownerId());
    UUID occurrenceId = onlyOccurrence(choreId);

    for (int cycle = 0; cycle < 3; cycle++) {
      choreService.pauseChore(home.householdId(), choreId, auth(home.ownerId()));
      choreService.activateChore(home.householdId(), choreId, auth(home.ownerId()));
      notificationScheduler.run();
    }

    assertThat(occurrenceIds(choreId)).containsExactly(occurrenceId);
    assertThat(status(occurrenceId)).isEqualTo("PENDING");
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);
    assertThat(pendingReminders(occurrenceId)).isNotEmpty();
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM (
                        SELECT type, scheduled_at FROM notifications
                        WHERE reference_id=? AND status='PENDING'
                        GROUP BY type, scheduled_at HAVING COUNT(*) > 1
                    ) duplicates
                    """,
                Integer.class,
                occurrenceId))
        .isZero();
  }

  @Test
  void exitCancelledOneTimeOccurrenceIsNeverRevivedForTheMemberWhoLeft() {
    Fixture home = createHousehold("exit-cancel");
    UUID memberId = createUser("exit-cancel-member");
    addMember(home.householdId(), memberId, "MEMBER");
    UUID choreId = createOneTimeChore(home, today().plusDays(5), memberId);
    UUID occurrenceId = onlyOccurrence(choreId);

    householdSettingsService.leave(home.householdId(), null, auth(memberId));

    assertThat(status(occurrenceId)).isEqualTo("CANCELLED");
    assertThat(exitCancelled(occurrenceId)).isTrue();
    assertThat(assignees(occurrenceId)).isEmpty();
    // Background generation and plain activation never bring it back for the departed member.
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(tx -> occurrenceService.generateHousehold(home.householdId()));
    assertThat(status(occurrenceId)).isEqualTo("CANCELLED");
    assertThatThrownBy(
            () -> choreService.activateChore(home.householdId(), choreId, auth(home.ownerId())))
        .isInstanceOf(InvalidHouseholdException.class);
    assertThat(status(occurrenceId)).isEqualTo("CANCELLED");

    // Reassigning to a current member and activating revives the same row for that member only.
    choreService.updateChore(
        home.householdId(),
        choreId,
        oneTimeRequest(today().plusDays(5), home.ownerId()),
        auth(home.ownerId()));
    choreService.activateChore(home.householdId(), choreId, auth(home.ownerId()));

    assertThat(occurrenceIds(choreId)).containsExactly(occurrenceId);
    assertThat(status(occurrenceId)).isEqualTo("PENDING");
    assertThat(exitCancelled(occurrenceId)).isFalse();
    assertThat(assignees(occurrenceId)).containsExactly(home.ownerId()).doesNotContain(memberId);
  }

  @Test
  void remindersDispatchAfterReactivation() throws Exception {
    Fixture home = createHousehold("pause-dispatch");
    enablePush(home.ownerId());
    doReturn(201)
        .when(webPushClient)
        .send(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            any(byte[].class));
    UUID choreId = createOneTimeChore(home, today().plusDays(5), home.ownerId());
    UUID occurrenceId = onlyOccurrence(choreId);
    choreService.pauseChore(home.householdId(), choreId, auth(home.ownerId()));
    choreService.activateChore(home.householdId(), choreId, auth(home.ownerId()));
    notificationScheduler.run();
    Reminder first = pendingReminders(occurrenceId).getFirst();
    clearInvocations(webPushClient);

    makeDue(first.id());
    notificationScheduler.run();

    assertThat(notificationStatus(first.id())).isEqualTo("SENT");
    verify(webPushClient)
        .send(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            any(byte[].class));
  }

  // ---- Defect 2: reminders after a deadline returns to an earlier value ----

  @Test
  void remindersAreReplannedAfterMovingAcrossTheHorizonAndBack() {
    assertRoundTripReplansReminders("round-trip-far", 10, 45);
  }

  @Test
  void remindersAreReplannedAfterMovingInsideTheHorizonAndBack() {
    assertRoundTripReplansReminders("round-trip-near", 10, 20);
  }

  @Test
  void deliveredOrAttemptedRemindersAreNeverResentAfterARoundTrip() throws Exception {
    Fixture home = createHousehold("round-trip-sent");
    enablePush(home.ownerId());
    LocalDate near = today().plusDays(10);
    UUID choreId = createOneTimeChore(home, near, home.ownerId());
    UUID occurrenceId = onlyOccurrence(choreId);
    notificationScheduler.run();
    List<Reminder> original = pendingReminders(occurrenceId);
    // Different reminder types, so the one-per-hour per-type cooldown does not defer the second.
    Reminder delivered =
        original.stream().filter(r -> "CHORE_DUE_SOON".equals(r.type())).findFirst().orElseThrow();
    Reminder attempted =
        original.stream().filter(r -> "CHORE_DUE_NOW".equals(r.type())).findFirst().orElseThrow();

    // One reminder is delivered; another gets a failed push attempt and stays retryable.
    doReturn(201)
        .when(webPushClient)
        .send(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            any(byte[].class));
    makeDue(delivered.id());
    notificationScheduler.run();
    doReturn(503)
        .when(webPushClient)
        .send(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            any(byte[].class));
    makeDue(attempted.id());
    notificationScheduler.run();
    assertThat(notificationStatus(delivered.id())).isEqualTo("SENT");
    assertThat(pushAttempts(attempted.id())).isPositive();
    // A third reminder whose push was attempted but never delivered on any channel, so the
    // deadline move below cancels it. It must still never be planned again.
    Reminder cancelledAfterAttempt =
        original.stream().filter(r -> "CHORE_OVERDUE".equals(r.type())).findFirst().orElseThrow();
    jdbc.update(
        """
            UPDATE notification_deliveries SET status='FAILED', attempts=1
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        cancelledAfterAttempt.id());

    move(home, choreId, today().plusDays(45));
    notificationScheduler.run();
    move(home, choreId, near);
    clearInvocations(webPushClient);
    notificationScheduler.run();

    List<Reminder> replanned = pendingReminders(occurrenceId);
    assertThat(replanned)
        .extracting(Reminder::slot)
        .doesNotContain(delivered.slot(), attempted.slot(), cancelledAfterAttempt.slot())
        .containsExactlyElementsOf(
            original.stream()
                .map(Reminder::slot)
                .filter(
                    slot ->
                        !slot.equals(delivered.slot())
                            && !slot.equals(attempted.slot())
                            && !slot.equals(cancelledAfterAttempt.slot()))
                .toList());
    assertThat(notificationStatus(delivered.id())).isEqualTo("SENT");
    assertThat(remindersForSlot(occurrenceId, delivered.slot())).isEqualTo(1);
    assertThat(remindersForSlot(occurrenceId, attempted.slot())).isEqualTo(1);
    assertThat(notificationStatus(cancelledAfterAttempt.id())).isEqualTo("CANCELLED");
    assertThat(remindersForSlot(occurrenceId, cancelledAfterAttempt.slot())).isEqualTo(1);
    verify(webPushClient, never())
        .send(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            any(byte[].class));
  }

  @Test
  void recurringDeadlineEditsReplaceRemindersAndRestoreThemOnReturn() {
    Fixture home = createHousehold("recurring-deadline");
    LocalDate startsOn = today().plusDays(2);
    UUID choreId =
        choreService
            .createChore(
                home.householdId(),
                weeklyRequest(startsOn, LocalTime.NOON, home.ownerId()),
                auth(home.ownerId()))
            .id();
    UUID occurrenceId = occurrenceOn(choreId, startsOn);
    notificationScheduler.run();
    List<Reminder> atNoon = pendingReminders(occurrenceId);
    assertThat(atNoon).isNotEmpty();

    choreService.updateChore(
        home.householdId(),
        choreId,
        weeklyRequest(startsOn, LocalTime.of(13, 0), home.ownerId()),
        auth(home.ownerId()));
    notificationScheduler.run();

    List<Reminder> atOne = pendingReminders(occurrenceId);
    assertThat(atOne).extracting(Reminder::slot).doesNotContainAnyElementsOf(slots(atNoon));
    assertThat(atOne)
        .allSatisfy(
            reminder ->
                assertThat(reminder.scheduledAt().toInstant())
                    .isBeforeOrEqualTo(
                        OccurrenceService.dueAt(startsOn, LocalTime.of(13, 0), ZoneOffset.UTC)
                            .plusHours(3)
                            .toInstant()));

    choreService.updateChore(
        home.householdId(),
        choreId,
        weeklyRequest(startsOn, LocalTime.NOON, home.ownerId()),
        auth(home.ownerId()));
    notificationScheduler.run();

    assertThat(slots(pendingReminders(occurrenceId))).containsExactlyElementsOf(slots(atNoon));
  }

  private void assertRoundTripReplansReminders(String label, int nearDays, int awayDays) {
    Fixture home = createHousehold(label);
    LocalDate near = today().plusDays(nearDays);
    UUID choreId = createOneTimeChore(home, near, home.ownerId());
    UUID occurrenceId = onlyOccurrence(choreId);
    notificationScheduler.run();
    List<Reminder> original = pendingReminders(occurrenceId);
    assertThat(original).isNotEmpty();

    move(home, choreId, today().plusDays(awayDays));
    notificationScheduler.run();
    assertThat(pendingReminders(occurrenceId))
        .isNotEmpty()
        .extracting(Reminder::slot)
        .doesNotContainAnyElementsOf(slots(original));

    move(home, choreId, near);
    notificationScheduler.run();

    assertThat(occurrenceIds(choreId)).containsExactly(occurrenceId);
    assertThat(slots(pendingReminders(occurrenceId))).containsExactlyElementsOf(slots(original));
    assertThat(choreAssignedEvents(home.householdId())).isEqualTo(1);
  }

  // ---- fixtures and queries ----

  private record Fixture(UUID householdId, UUID ownerId) {}

  /** A reminder's identity for comparisons: type and scheduled instant. */
  private record Slot(String type, Instant scheduledAt) {}

  private record Reminder(UUID id, String type, OffsetDateTime scheduledAt) {
    Slot slot() {
      return new Slot(type, scheduledAt.toInstant());
    }
  }

  private static List<Slot> slots(List<Reminder> reminders) {
    return reminders.stream().map(Reminder::slot).toList();
  }

  private void move(Fixture home, UUID choreId, LocalDate date) {
    choreService.updateChore(
        home.householdId(), choreId, oneTimeRequest(date, home.ownerId()), auth(home.ownerId()));
  }

  private UUID createOneTimeChore(Fixture home, LocalDate date, UUID assigneeId) {
    return choreService
        .createChore(home.householdId(), oneTimeRequest(date, assigneeId), auth(home.ownerId()))
        .id();
  }

  private static ChoreRequest oneTimeRequest(LocalDate date, UUID assigneeId) {
    return new ChoreRequest(
        "One-time chore",
        null,
        null,
        null,
        null,
        null,
        false,
        new ChoreScheduleRequest(
            "FREQ=ONCE",
            "UTC",
            date,
            null,
            LocalTime.NOON,
            AssignmentStrategy.FIXED,
            assigneeId,
            null,
            null));
  }

  private static ChoreRequest weeklyRequest(LocalDate startsOn, LocalTime dueTime, UUID assignee) {
    return new ChoreRequest(
        "Weekly chore",
        null,
        null,
        null,
        null,
        null,
        false,
        new ChoreScheduleRequest(
            "FREQ=WEEKLY;BYDAY=" + startsOn.getDayOfWeek().name().substring(0, 2),
            "UTC",
            startsOn,
            null,
            dueTime,
            AssignmentStrategy.FIXED,
            assignee,
            null,
            null));
  }

  private Fixture createHousehold(String label) {
    UUID ownerId = createUser(label + "-owner");
    UUID householdId = UUID.randomUUID();
    householdIds.add(householdId);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Replan test', 'UTC', ?)",
        householdId,
        ownerId);
    addMember(householdId, ownerId, "OWNER");
    return new Fixture(householdId, ownerId);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', 'Replan test')",
        id,
        label + "-" + id + "@example.test");
    return id;
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

  private void enablePush(UUID userId) {
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled) VALUES (?, TRUE)", userId);
    jdbc.update(
        """
            INSERT INTO push_subscriptions (id, user_id, endpoint, public_key, auth_secret)
            VALUES (?, ?, ?, 'test-subscription-key', 'test-auth-secret')
            """,
        UUID.randomUUID(),
        userId,
        "https://push.example.test/" + UUID.randomUUID());
  }

  private void makeDue(UUID notificationId) {
    jdbc.update(
        """
            UPDATE notifications
            SET scheduled_at=NOW() - INTERVAL '1 minute', expires_at=NOW() + INTERVAL '1 hour'
            WHERE id=?
            """,
        notificationId);
  }

  private static LocalDate today() {
    return LocalDate.now(ZoneOffset.UTC);
  }

  private static OffsetDateTime noon(LocalDate date) {
    return OccurrenceService.dueAt(date, LocalTime.NOON, ZoneOffset.UTC);
  }

  private static LocalDate localDate(Object value) {
    return value instanceof java.sql.Date date ? date.toLocalDate() : (LocalDate) value;
  }

  private UUID onlyOccurrence(UUID choreId) {
    List<UUID> ids = occurrenceIds(choreId);
    assertThat(ids).hasSize(1);
    return ids.getFirst();
  }

  private List<UUID> occurrenceIds(UUID choreId) {
    return jdbc.queryForList(
        "SELECT id FROM chore_assignments WHERE chore_id=? ORDER BY scheduled_for, id",
        UUID.class,
        choreId);
  }

  private UUID occurrenceOn(UUID choreId, LocalDate date) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND scheduled_for=?",
        UUID.class,
        choreId,
        date);
  }

  private List<Map<String, Object>> liveOccurrences(UUID choreId) {
    return jdbc.queryForList(
        """
            SELECT id, scheduled_for FROM chore_assignments
            WHERE chore_id=? AND status IN ('PENDING','SUBMITTED')
            """,
        choreId);
  }

  private String status(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT status FROM chore_assignments WHERE id=?", String.class, assignmentId);
  }

  private LocalDate scheduledFor(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT scheduled_for FROM chore_assignments WHERE id=?", LocalDate.class, assignmentId);
  }

  private Instant dueAt(UUID assignmentId) {
    return jdbc.queryForObject(
            "SELECT due_at FROM chore_assignments WHERE id=?", OffsetDateTime.class, assignmentId)
        .toInstant();
  }

  private boolean exitCancelled(UUID assignmentId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT cancelled_by_membership_exit FROM chore_assignments WHERE id=?",
            Boolean.class,
            assignmentId));
  }

  private boolean scheduleActive(UUID choreId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT is_active FROM chore_schedules WHERE chore_id=?", Boolean.class, choreId));
  }

  private List<UUID> assignees(UUID assignmentId) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
        UUID.class,
        assignmentId);
  }

  private int choreAssignedEvents(UUID householdId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM notification_events WHERE household_id=? AND event_type='CHORE_ASSIGNED'",
        Integer.class,
        householdId);
  }

  private List<Reminder> pendingReminders(UUID assignmentId) {
    return jdbc.query(
        """
            SELECT id, type, scheduled_at FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
              AND type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
            ORDER BY scheduled_at, type
            """,
        (rs, row) ->
            new Reminder(
                rs.getObject("id", UUID.class),
                rs.getString("type"),
                rs.getObject("scheduled_at", OffsetDateTime.class)),
        assignmentId);
  }

  private int remindersForSlot(UUID assignmentId, Slot slot) {
    return jdbc.queryForObject(
            """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND type=?
              AND deduplication_key LIKE '%' || ?
            """,
            Integer.class, assignmentId, slot.type(), slot.scheduledAt().toString())
        + jdbc.queryForObject(
            """
                SELECT COUNT(*) FROM notifications
                WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND type=?
                  AND deduplication_key LIKE '%' || ? || ':r%'
                """,
            Integer.class, assignmentId, slot.type(), slot.scheduledAt().toString());
  }

  private String notificationStatus(UUID notificationId) {
    return jdbc.queryForObject(
        "SELECT status FROM notifications WHERE id=?", String.class, notificationId);
  }

  private int pushAttempts(UUID notificationId) {
    return jdbc.queryForObject(
        """
            SELECT COALESCE(MAX(attempts), 0) FROM notification_push_delivery_targets
            WHERE notification_id=?
            """,
        Integer.class,
        notificationId);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
