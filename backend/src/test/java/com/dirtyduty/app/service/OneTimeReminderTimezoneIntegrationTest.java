package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
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
class OneTimeReminderTimezoneIntegrationTest {
  private static final ZoneId HALIFAX = ZoneId.of("America/Halifax");
  private static final ZoneId UTC = ZoneOffset.UTC;

  @Autowired private JdbcTemplate jdbc;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private PlatformTransactionManager transactionManager;
  @MockitoBean private WebPushClient webPushClient;

  private UUID householdId;
  private UUID userId;

  @AfterEach
  void cleanFixtures() {
    if (householdId != null) {
      jdbc.update(
          "DELETE FROM notifications WHERE event_id IN "
              + "(SELECT id FROM notification_events WHERE household_id=?)",
          householdId);
      jdbc.update("DELETE FROM notification_events WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM activity_events WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_completions WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM households WHERE id=?", householdId);
    }
    if (userId != null) {
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    householdId = null;
    userId = null;
  }

  @Test
  void repeatedHalifaxHouseholdGenerationPreservesAllPendingReminderDeliveries() {
    LocalDate scheduledFor = LocalDate.now(HALIFAX).plusDays(2);
    LocalTime dueTime = LocalTime.NOON;
    UUID scheduleId = createSchedule(HALIFAX, scheduledFor, dueTime);
    OffsetDateTime expectedDueAt = OccurrenceService.dueAt(scheduledFor, dueTime, HALIFAX);

    generateHousehold();

    UUID assignmentId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=?", UUID.class, scheduleId);
    OffsetDateTime storedDueAt =
        jdbc.queryForObject(
            "SELECT due_at FROM chore_assignments WHERE id=?", OffsetDateTime.class, assignmentId);
    assertThat(storedDueAt.getOffset()).isEqualTo(ZoneOffset.UTC);
    assertThat(expectedDueAt.getOffset()).isNotEqualTo(storedDueAt.getOffset());
    assertThat(storedDueAt.toInstant()).isEqualTo(expectedDueAt.toInstant());

    notificationScheduler.run();

    List<ReminderSnapshot> before = reminders(assignmentId);
    assertThat(before).hasSize(6);
    assertThat(before)
        .extracting(ReminderSnapshot::type)
        .containsExactly(
            "CHORE_DUE_NOW",
            "CHORE_DUE_SOON",
            "CHORE_DUE_SOON",
            "CHORE_DUE_SOON",
            "CHORE_OVERDUE",
            "CHORE_OVERDUE");
    assertThat(before)
        .allSatisfy(
            reminder -> {
              assertThat(reminder.status()).isEqualTo("PENDING");
              assertThat(reminder.inAppStatus()).isEqualTo("PENDING");
              assertThat(reminder.webPushStatus()).isEqualTo("PENDING");
            });

    generateHousehold();

    assertThat(reminders(assignmentId)).containsExactlyElementsOf(before);
  }

  @Test
  void repeatedUtcHouseholdGenerationPreservesAllPendingReminderDeliveries() {
    LocalDate scheduledFor = LocalDate.now(UTC).plusDays(2);
    LocalTime dueTime = LocalTime.NOON;
    UUID scheduleId = createSchedule(UTC, scheduledFor, dueTime);
    OffsetDateTime expectedDueAt = OccurrenceService.dueAt(scheduledFor, dueTime, UTC);

    generateHousehold();

    UUID assignmentId = assignmentId(scheduleId);
    OffsetDateTime storedDueAt = assignmentDueAt(assignmentId);
    assertThat(storedDueAt.getOffset()).isEqualTo(ZoneOffset.UTC);
    assertThat(storedDueAt.toInstant()).isEqualTo(expectedDueAt.toInstant());
    notificationScheduler.run();
    List<ReminderSnapshot> before = reminders(assignmentId);
    assertThat(before).hasSize(6);

    generateHousehold();

    assertThat(reminders(assignmentId)).containsExactlyElementsOf(before);
  }

  @Test
  void changedHalifaxDeadlineCancelsOldRemindersAndCreatesValidReplacements() {
    LocalDate scheduledFor = LocalDate.now(HALIFAX).plusDays(2);
    UUID scheduleId = createSchedule(HALIFAX, scheduledFor, LocalTime.NOON);
    generateHousehold();
    UUID assignmentId = assignmentId(scheduleId);
    notificationScheduler.run();
    List<ReminderSnapshot> oldReminders = reminders(assignmentId);
    assertThat(oldReminders).hasSize(6);

    jdbc.update(
        "UPDATE chore_schedules SET due_time=? WHERE id=?", LocalTime.of(13, 15), scheduleId);
    generateHousehold();

    assertThat(assignmentDueAt(assignmentId).toInstant())
        .isEqualTo(
            OccurrenceService.dueAt(scheduledFor, LocalTime.of(13, 15), HALIFAX).toInstant());
    assertThat(reminders(assignmentId))
        .filteredOn(
            reminder -> oldReminders.stream().anyMatch(old -> old.id().equals(reminder.id())))
        .allSatisfy(
            reminder -> {
              assertThat(reminder.status()).isEqualTo("CANCELLED");
              assertThat(reminder.inAppStatus()).isEqualTo("CANCELLED");
              assertThat(reminder.webPushStatus()).isEqualTo("CANCELLED");
            });

    notificationScheduler.run();

    List<ReminderSnapshot> replacements =
        reminders(assignmentId).stream()
            .filter(reminder -> "PENDING".equals(reminder.status()))
            .toList();
    assertThat(replacements).hasSize(6);
    assertThat(replacements)
        .extracting(ReminderSnapshot::id)
        .doesNotContainAnyElementsOf(oldReminders.stream().map(ReminderSnapshot::id).toList());
  }

  @Test
  void addingAndRemovingDueTimeCreatesThenCancelsReminders() {
    LocalDate scheduledFor = LocalDate.now(HALIFAX).plusDays(2);
    UUID scheduleId = createSchedule(HALIFAX, scheduledFor, null);
    generateHousehold();
    UUID assignmentId = assignmentId(scheduleId);
    assertThat(assignmentDueAt(assignmentId)).isNull();
    notificationScheduler.run();
    assertThat(reminders(assignmentId)).isEmpty();

    jdbc.update("UPDATE chore_schedules SET due_time=? WHERE id=?", LocalTime.NOON, scheduleId);
    generateHousehold();
    assertThat(assignmentDueAt(assignmentId).toInstant())
        .isEqualTo(OccurrenceService.dueAt(scheduledFor, LocalTime.NOON, HALIFAX).toInstant());
    notificationScheduler.run();
    List<ReminderSnapshot> createdReminders = reminders(assignmentId);
    assertThat(createdReminders).hasSize(6);
    assertThat(createdReminders)
        .allSatisfy(reminder -> assertThat(reminder.status()).isEqualTo("PENDING"));

    jdbc.update("UPDATE chore_schedules SET due_time=NULL WHERE id=?", scheduleId);
    generateHousehold();

    assertThat(assignmentDueAt(assignmentId)).isNull();
    assertThat(reminders(assignmentId))
        .allSatisfy(
            reminder -> {
              assertThat(reminder.status()).isEqualTo("CANCELLED");
              assertThat(reminder.inAppStatus()).isEqualTo("CANCELLED");
              assertThat(reminder.webPushStatus()).isEqualTo("CANCELLED");
            });
  }

  @Test
  void schedulerDispatchesCurrentValidRemindersThroughStubbedWebPushTransport() throws Exception {
    LocalDate scheduledFor = LocalDate.now(HALIFAX).plusDays(2);
    UUID scheduleId = createSchedule(HALIFAX, scheduledFor, LocalTime.NOON);
    enablePushForUser();
    generateHousehold();
    UUID assignmentId = assignmentId(scheduleId);
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
    notificationScheduler.run();
    List<ReminderSnapshot> allReminders = reminders(assignmentId);
    assertThat(allReminders).hasSize(6);
    clearInvocations(webPushClient);

    jdbc.update(
        """
            WITH selected AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY type ORDER BY scheduled_at, id) AS rank
                FROM notifications
                WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=?
                  AND type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
            )
            UPDATE notifications n
            SET scheduled_at=NOW() - INTERVAL '1 minute', expires_at=NOW() + INTERVAL '1 hour'
            FROM selected
            WHERE n.id=selected.id AND selected.rank=1
            """,
        assignmentId);
    notificationScheduler.run();

    List<ReminderSnapshot> dispatched =
        reminders(assignmentId).stream()
            .filter(
                reminder ->
                    allReminders.stream()
                        .anyMatch(
                            original ->
                                original.id().equals(reminder.id())
                                    && !original.scheduledAt().equals(reminder.scheduledAt())))
            .toList();
    assertThat(dispatched).hasSize(3);
    assertThat(dispatched)
        .allSatisfy(
            reminder -> {
              assertThat(reminder.status()).isEqualTo("SENT");
              assertThat(reminder.inAppStatus()).isEqualTo("SENT");
              assertThat(reminder.webPushStatus()).isEqualTo("SENT");
              assertThat(
                      jdbc.queryForObject(
                          """
                              SELECT COUNT(*) FROM notification_push_delivery_targets
                              WHERE notification_id=? AND status='SENT' AND attempts=1
                              """,
                          Integer.class,
                          reminder.id()))
                  .isEqualTo(1);
            });
    verify(webPushClient, times(3))
        .send(
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            anyString(),
            any(byte[].class));
  }

  private UUID createSchedule(ZoneId zone, LocalDate scheduledFor, LocalTime dueTime) {
    userId = createUser();
    householdId = createHousehold(userId, zone);
    UUID choreId = createChore(userId);
    return createOneTimeSchedule(choreId, userId, scheduledFor, dueTime, zone);
  }

  private UUID createUser() {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) "
            + "VALUES (?, ?, 'test-hash', 'Timezone test')",
        id,
        "timezone-" + id + "@example.test");
    return id;
  }

  private UUID createHousehold(UUID ownerId, ZoneId zone) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) "
            + "VALUES (?, 'Timezone test', ?, ?)",
        id,
        zone.getId(),
        ownerId);
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
            """,
        id,
        ownerId);
    return id;
  }

  private UUID createChore(UUID creatorId) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
            VALUES (?, ?, 'Timezone test chore', 'NORMAL', 1, ?)
            """,
        id,
        householdId,
        creatorId);
    return id;
  }

  private UUID createOneTimeSchedule(
      UUID choreId, UUID assigneeId, LocalDate scheduledFor, LocalTime dueTime, ZoneId zone) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_schedules
                (id, household_id, chore_id, recurrence_rule, timezone, starts_on, due_time,
                 assignment_strategy, fixed_assignee_user_id, strategy_config)
            VALUES (?, ?, ?, 'FREQ=ONCE', ?, ?, ?, 'FIXED', ?, '{"peopleNeeded":1}'::jsonb)
            """,
        id,
        householdId,
        choreId,
        zone.getId(),
        scheduledFor,
        dueTime,
        assigneeId);
    return id;
  }

  private void generateHousehold() {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(status -> occurrenceService.generateHousehold(householdId));
  }

  private List<ReminderSnapshot> reminders(UUID assignmentId) {
    return jdbc.query(
        """
            SELECT n.id, n.type, n.scheduled_at, n.status,
                   in_app.status AS in_app_status, web_push.status AS web_push_status
            FROM notifications n
            JOIN notification_deliveries in_app
              ON in_app.notification_id=n.id AND in_app.channel='IN_APP'
            JOIN notification_deliveries web_push
              ON web_push.notification_id=n.id AND web_push.channel='WEB_PUSH'
            WHERE n.reference_type='CHORE_ASSIGNMENT' AND n.reference_id=?
              AND n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
            ORDER BY n.type, n.scheduled_at, n.id
            """,
        (rs, row) ->
            new ReminderSnapshot(
                rs.getObject("id", UUID.class),
                rs.getString("type"),
                rs.getObject("scheduled_at", OffsetDateTime.class),
                rs.getString("status"),
                rs.getString("in_app_status"),
                rs.getString("web_push_status")),
        assignmentId);
  }

  private UUID assignmentId(UUID scheduleId) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE schedule_id=?", UUID.class, scheduleId);
  }

  private OffsetDateTime assignmentDueAt(UUID assignmentId) {
    return jdbc.query(
        "SELECT due_at FROM chore_assignments WHERE id=?",
        rs -> rs.next() ? rs.getObject("due_at", OffsetDateTime.class) : null,
        assignmentId);
  }

  private void enablePushForUser() {
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

  private record ReminderSnapshot(
      UUID id,
      String type,
      OffsetDateTime scheduledAt,
      String status,
      String inAppStatus,
      String webPushStatus) {}
}
