package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.service.ChoreService;
import com.dirtyduty.app.service.MembershipExitCleanupService;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The notification scheduler plans reminders without holding household locks, so a household save
 * made while a run is planning goes through at once, and the plan is checked again under the lock
 * before anything is written.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key"
    })
class NotificationSchedulerLockingIntegrationTest {
  private static final Duration SHORT = Duration.ofSeconds(1);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private MembershipExitCleanupService membershipExitCleanupService;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private PlatformTransactionManager transactionManager;
  @MockitoSpyBean private NotificationTemplateResolver templateResolver;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> householdIds = new ArrayList<>();
  private final List<UUID> userIds = new ArrayList<>();

  @Test
  void householdWriteDuringARunIsNotBlockedAndTheRunStillPlansEveryReminder() throws Exception {
    Fixture home = createHousehold("lock-write");
    LocalDate dueDate = LocalDate.now(ZoneOffset.UTC).plusDays(5);
    UUID choreId = createOneTimeChore(home, dueDate);
    UUID occurrenceId = onlyOccurrence(choreId);

    PausedRun run = startRunPausedInPlanning(home.householdId());
    try {
      Duration waited =
          timed(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            membershipExitCleanupService.lockHousehold(home.householdId());
                            jdbc.update(
                                "UPDATE households SET description=? WHERE id=?",
                                "Saved during a scheduler run",
                                home.householdId());
                          }));
      assertThat(waited).isLessThan(SHORT);
    } finally {
      run.finish();
    }

    Set<Instant> expected = expectedSlots(home.householdId(), noon(dueDate));
    assertThat(expected).isNotEmpty();
    assertThat(reminderSlots(occurrenceId)).isEqualTo(expected);
    int rows = reminderRows(occurrenceId);
    assertThat(rows).isEqualTo(expected.size());

    // Nothing is planned twice on the next run.
    notificationScheduler.run();
    assertThat(reminderRows(occurrenceId)).isEqualTo(rows);
    assertThat(
            jdbc.queryForObject(
                "SELECT description FROM households WHERE id=?", String.class, home.householdId()))
        .isEqualTo("Saved during a scheduler run");
  }

  @Test
  void deadlineMovedWhileARunPlansIsRecheckedUnderTheLock() throws Exception {
    Fixture home = createHousehold("lock-recheck");
    LocalDate firstDate = LocalDate.now(ZoneOffset.UTC).plusDays(5);
    LocalDate movedDate = firstDate.plusDays(2);
    UUID choreId = createOneTimeChore(home, firstDate);
    UUID occurrenceId = onlyOccurrence(choreId);

    PausedRun run = startRunPausedInPlanning(home.householdId());
    try {
      Duration waited =
          timed(
              () ->
                  choreService.updateChore(
                      home.householdId(),
                      choreId,
                      oneTimeRequest(movedDate, home.ownerId()),
                      auth(home.ownerId())));
      assertThat(waited).isLessThan(SHORT);
    } finally {
      run.finish();
    }

    assertThat(onlyOccurrence(choreId)).isEqualTo(occurrenceId);
    // The slots planned for the old deadline were dropped under the lock, not written.
    assertThat(reminderRows(occurrenceId)).isZero();

    notificationScheduler.run();

    Set<Instant> expected = expectedSlots(home.householdId(), noon(movedDate));
    assertThat(expected).isNotEmpty();
    assertThat(reminderSlots(occurrenceId)).isEqualTo(expected);
    assertThat(reminderRows(occurrenceId)).isEqualTo(expected.size());
  }

  @Test
  void aSlowPushIsSentAfterTheHouseholdLockIsReleasedAndRecordedOnce() throws Exception {
    Fixture home = createHousehold("lock-push");
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled) VALUES (?, TRUE)",
        home.ownerId());
    String endpoint = "https://push.example.test/slow-" + UUID.randomUUID();
    jdbc.update(
        "INSERT INTO push_subscriptions (user_id, endpoint, public_key, auth_secret)"
            + " VALUES (?, ?, ?, ?)",
        home.ownerId(),
        endpoint,
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[65]),
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]));
    UUID notificationId = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO notifications
                (id, recipient_user_id, type, category, title, message, status, reference_type,
                 reference_id, scheduled_at, expires_at, deduplication_key)
            VALUES (?, ?, 'HOUSEHOLD_JOINED', 'GENERAL', 'Title', 'Body', 'PENDING', 'HOUSEHOLD',
                    ?, NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 hour', ?)
            """,
        notificationId,
        home.ownerId(),
        home.householdId(),
        "slow-push-" + notificationId);
    jdbc.update(
        "INSERT INTO notification_deliveries (notification_id, channel, status)"
            + " VALUES (?, 'IN_APP', 'PENDING')",
        notificationId);

    CountDownLatch sending = new CountDownLatch(1);
    CountDownLatch finishSend = new CountDownLatch(1);
    doAnswer(
            invocation -> {
              sending.countDown();
              assertThat(finishSend.await(10, TimeUnit.SECONDS)).isTrue();
              return 201;
            })
        .when(webPushClient)
        .send(any(), any(), any(), eq(endpoint), any(), any(), any());

    ExecutorService executor = Executors.newSingleThreadExecutor();
    Future<?> run = executor.submit(() -> notificationScheduler.run());
    try {
      assertThat(sending.await(10, TimeUnit.SECONDS)).isTrue();
      // The push is on its way: the household, its member and the notification are all free,
      // and the notification and its claimed push target are already committed.
      Duration waited =
          timed(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            jdbc.execute("SET LOCAL lock_timeout = '500ms'");
                            membershipExitCleanupService.lockHousehold(home.householdId());
                            jdbc.queryForList(
                                "SELECT id FROM users WHERE id=? FOR UPDATE",
                                UUID.class,
                                home.ownerId());
                            jdbc.queryForList(
                                "SELECT id FROM notifications WHERE id=? FOR UPDATE",
                                UUID.class,
                                notificationId);
                            jdbc.update(
                                "UPDATE households SET description=? WHERE id=?",
                                "Saved while a push was sending",
                                home.householdId());
                          }));
      assertThat(waited).isLessThan(SHORT);
      assertThat(
              jdbc.queryForObject(
                  "SELECT status FROM notifications WHERE id=?", String.class, notificationId))
          .isEqualTo("SENT");
      assertThat(pushTargetStatus(notificationId)).isEqualTo("PENDING");
    } finally {
      finishSend.countDown();
      try {
        run.get(20, TimeUnit.SECONDS);
      } finally {
        executor.shutdownNow();
      }
    }

    // The result is recorded after the send, and the next run doesn't send it again.
    assertThat(pushTargetStatus(notificationId)).isEqualTo("SENT");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM notification_deliveries WHERE notification_id=?"
                    + " AND channel='WEB_PUSH'",
                String.class,
                notificationId))
        .isEqualTo("SENT");
    notificationScheduler.run();
    org.mockito.Mockito.verify(webPushClient, org.mockito.Mockito.times(1))
        .send(any(), any(), any(), eq(endpoint), any(), any(), any());
  }

  private String pushTargetStatus(UUID notificationId) {
    return jdbc.queryForObject(
        "SELECT status FROM notification_push_delivery_targets WHERE notification_id=?",
        String.class,
        notificationId);
  }

  // ---- A run paused while it plans this household's reminders (no locks held) ----

  private PausedRun startRunPausedInPlanning(UUID householdId) throws InterruptedException {
    CountDownLatch planning = new CountDownLatch(1);
    CountDownLatch resume = new CountDownLatch(1);
    AtomicBoolean pauseOnce = new AtomicBoolean(true);
    doAnswer(
            invocation -> {
              if (pauseOnce.compareAndSet(true, false)) {
                planning.countDown();
                assertThat(resume.await(10, TimeUnit.SECONDS)).isTrue();
              }
              return invocation.callRealMethod();
            })
        .when(templateResolver)
        .hasEnabledTemplate(any(), eq(householdId), any());
    ExecutorService executor = Executors.newSingleThreadExecutor();
    Future<?> future = executor.submit(() -> notificationScheduler.run());
    assertThat(planning.await(10, TimeUnit.SECONDS)).isTrue();
    return new PausedRun(resume, future, executor);
  }

  private record PausedRun(CountDownLatch resume, Future<?> future, ExecutorService executor) {
    void finish() throws Exception {
      resume.countDown();
      try {
        future.get(20, TimeUnit.SECONDS);
      } finally {
        executor.shutdownNow();
      }
    }
  }

  private static Duration timed(Runnable action) {
    long started = System.nanoTime();
    action.run();
    return Duration.ofNanos(System.nanoTime() - started);
  }

  // ---- Reminders ----

  /** The reminder slots of the household's chores' levels for this deadline still ahead. */
  private Set<Instant> expectedSlots(UUID householdId, OffsetDateTime dueAt) {
    Instant now = Instant.now();
    return jdbc
        .queryForList(
            """
                SELECT DISTINCT r.minutes_before_due FROM notification_reminder_rules r
                JOIN chores c ON c.reminder_mode=r.mode
                WHERE c.household_id=? AND r.enabled=TRUE
                """,
            Integer.class,
            householdId)
        .stream()
        .map(minutes -> dueAt.minusMinutes(minutes).toInstant())
        .filter(slot -> slot.isAfter(now))
        .collect(Collectors.toSet());
  }

  private Set<Instant> reminderSlots(UUID occurrenceId) {
    return jdbc
        .query(
            """
                SELECT scheduled_at FROM notifications
                WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
                  AND type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                """,
            (rs, row) -> rs.getObject("scheduled_at", OffsetDateTime.class).toInstant(),
            occurrenceId)
        .stream()
        .collect(Collectors.toSet());
  }

  private int reminderRows(UUID occurrenceId) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=?
              AND type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
            """,
        Integer.class,
        occurrenceId);
  }

  // ---- Fixtures ----

  private record Fixture(UUID householdId, UUID ownerId) {}

  private UUID createOneTimeChore(Fixture home, LocalDate date) {
    return choreService
        .createChore(home.householdId(), oneTimeRequest(date, home.ownerId()), auth(home.ownerId()))
        .id();
  }

  private static ChoreRequest oneTimeRequest(LocalDate date, UUID assigneeId) {
    return new ChoreRequest(
        "Locking chore",
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

  private static OffsetDateTime noon(LocalDate date) {
    // The fixtures' household and schedule are in UTC.
    return date.atTime(LocalTime.NOON).atOffset(ZoneOffset.UTC);
  }

  private UUID onlyOccurrence(UUID choreId) {
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT id FROM chore_assignments WHERE chore_id=? ORDER BY scheduled_for, id",
            UUID.class,
            choreId);
    assertThat(ids).hasSize(1);
    return ids.getFirst();
  }

  private Fixture createHousehold(String label) {
    UUID ownerId = createUser(label + "-owner");
    UUID householdId = UUID.randomUUID();
    householdIds.add(householdId);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Locking test', 'UTC', ?)",
        householdId,
        ownerId);
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
            """,
        householdId,
        ownerId);
    return new Fixture(householdId, ownerId);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name)"
            + " VALUES (?, ?, 'test-hash', 'Locking test')",
        id,
        label + "-" + id + "@example.test");
    return id;
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }

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
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM push_subscriptions WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    householdIds.clear();
    userIds.clear();
  }
}
