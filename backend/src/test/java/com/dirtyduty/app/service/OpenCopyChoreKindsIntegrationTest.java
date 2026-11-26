package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.chore.DashboardResponse;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
 * "After it's done" (AFTER_COMPLETION) and "When needed" (AS_NEEDED) chores: one open copy, the
 * next counted from the completion, turn order, "Needs doing", reminders and week totals.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class OpenCopyChoreKindsIntegrationTest {
  private static final LocalTime EIGHT_PM = LocalTime.of(20, 0);

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private OccurrenceGenerationScheduler generationScheduler;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private HouseholdService householdService;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> householdIds = new ArrayList<>();
  private final List<UUID> userIds = new ArrayList<>();
  private Home home;
  private LocalDate today;

  @BeforeEach
  void setUp() {
    today = LocalDate.now(ZoneOffset.UTC);
    UUID owner = createUser("owner");
    UUID ana = createUser("ana");
    UUID ben = createUser("ben");
    UUID householdId = UUID.randomUUID();
    householdIds.add(householdId);
    jdbc.update(
        // New chores get Full reminders (E13): these tests count its slots.
        "INSERT INTO households (id, name, timezone, created_by_user_id, default_reminder_mode)"
            + " VALUES (?, 'Kinds', 'UTC', ?, 'AGGRESSIVE')",
        householdId,
        owner);
    addMember(householdId, owner, "OWNER");
    addMember(householdId, ana, "MEMBER");
    addMember(householdId, ben, "MEMBER");
    home = new Home(householdId, owner, ana, ben);
  }

  @AfterEach
  void cleanFixtures() {
    occurrenceService.useClock(null);
    for (UUID householdId : householdIds) {
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
    }
    for (UUID userId : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", userId);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    householdIds.clear();
    userIds.clear();
  }

  // ---- After it's done -------------------------------------------------------------------------

  @Test
  void afterItsDoneDatesTheNextOneFromTheCompletionAtTheDueTime() {
    UUID chore =
        afterChore(
            "Vacuum",
            3,
            IntervalUnit.DAY,
            today.plusDays(1),
            EIGHT_PM,
            AssignmentStrategy.FIXED,
            List.of(home.ana()));
    UUID first = openOf(chore);
    assertThat(column(first, "planned_for", LocalDate.class)).isEqualTo(today.plusDays(1));
    assertThat(dueAt(first)).isEqualTo(at(today.plusDays(1), EIGHT_PM));

    // Only the assignee completes an "After it's done" chore.
    assertThatThrownBy(() -> complete(first, home.owner()))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    complete(first, home.ana());

    UUID next = openOf(chore);
    assertThat(next).isNotEqualTo(first);
    assertThat(column(next, "planned_for", LocalDate.class)).isEqualTo(today.plusDays(3));
    assertThat(dueAt(next)).isEqualTo(at(today.plusDays(3), EIGHT_PM));
    assertThat(assignees(next)).containsExactly(home.ana());
    assertThat(openCount(chore)).isEqualTo(1);
    assertThat(view(next, home.ana()).lastDone().byUserId()).isEqualTo(home.ana());
    assertThat(view(next, home.ana()).repeat().intervalCount()).isEqualTo(3);
  }

  @Test
  void withoutADueTimeTheDeadlineIsTheEndOfTheDayAndWeeksAreSupported() {
    UUID chore =
        afterChore(
            "Change sheets",
            2,
            IntervalUnit.WEEK,
            today.plusDays(1),
            null,
            AssignmentStrategy.FIXED,
            List.of(home.ana()));
    UUID first = openOf(chore);
    assertThat(dueAt(first)).isEqualTo(at(today.plusDays(1), LocalTime.of(23, 59)));
    complete(first, home.ana());
    UUID next = openOf(chore);
    assertThat(column(next, "planned_for", LocalDate.class)).isEqualTo(today.plusWeeks(2));
    assertThat(dueAt(next)).isEqualTo(at(today.plusWeeks(2), LocalTime.of(23, 59)));
  }

  @Test
  void anOverdueOpenCopyStaysTheOnlyOneThroughGeneration() {
    UUID chore =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(1), EIGHT_PM, fixed(), anaOnly());
    UUID open = openOf(chore);
    jdbc.update(
        "UPDATE chore_assignments SET due_at=?, scheduled_for=?, planned_for=? WHERE id=?",
        OffsetDateTime.now(ZoneOffset.UTC).minusDays(4),
        today.minusDays(4),
        today.minusDays(4),
        open);

    generationScheduler.run();
    generationScheduler.run();
    occurrenceService.dashboard(home.householdId(), auth(home.ana()));

    assertThat(openCount(chore)).isEqualTo(1);
    assertThat(openOf(chore)).isEqualTo(open);
    assertThat(view(open, home.ana()).overdue()).isTrue();
  }

  @Test
  void verificationCreatesTheNextOneOnlyWhenTheSubmittedOneIsCompleted() {
    UUID chore =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(1), EIGHT_PM, fixed(), anaOnly());
    UUID open = openOf(chore);
    jdbc.update("UPDATE chore_assignments SET status='SUBMITTED' WHERE id=?", open);

    generationScheduler.run();
    assertThat(openCount(chore)).isEqualTo(1);

    complete(open, home.ana());
    assertThat(status(open)).isEqualTo("COMPLETED");
    UUID next = openOf(chore);
    assertThat(next).isNotEqualTo(open);
    assertThat(column(next, "planned_for", LocalDate.class)).isEqualTo(today.plusDays(3));
  }

  @Test
  void remindersForTheOpenCopyGoThroughTheNormalScheduler() {
    UUID chore =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(2), EIGHT_PM, fixed(), anaOnly());
    UUID open = openOf(chore);

    notificationScheduler.run();

    assertThat(reminderTypes(open, home.ana()))
        .containsExactlyInAnyOrder(
            "CHORE_DUE_SOON",
            "CHORE_DUE_SOON",
            "CHORE_DUE_SOON",
            "CHORE_DUE_NOW",
            "CHORE_OVERDUE",
            "CHORE_OVERDUE");
  }

  @Test
  void skipStartsTheNextFromTheSkipDayAndMoveWorksOnTheOpenCopy() {
    UUID chore =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(1), EIGHT_PM, fixed(), anaOnly());
    UUID first = openOf(chore);
    AssignmentResponse.Actions actions = view(first, home.owner()).actions();
    assertThat(actions.canMove()).isTrue();
    assertThat(actions.canSkip()).isTrue();
    assertThat(actions.canReassign()).isTrue();
    assertThat(actions.canFlag()).isFalse();

    AssignmentResponse moved =
        occurrenceService.move(
            home.householdId(), first, today.plusDays(5), null, auth(home.owner()));
    assertThat(moved.scheduledFor()).isEqualTo(today.plusDays(5));
    assertThat(moved.dueAt().toInstant()).isEqualTo(at(today.plusDays(5), EIGHT_PM).toInstant());

    AssignmentResponse skipped =
        occurrenceService.skip(home.householdId(), first, auth(home.owner()));
    assertThat(skipped.status()).isEqualTo("SKIPPED");
    assertThat(skipped.actions().canUnskip()).isFalse();
    assertThatThrownBy(
            () -> occurrenceService.unskip(home.householdId(), first, auth(home.owner())))
        .isInstanceOf(InvalidHouseholdException.class);

    UUID next = openOf(chore);
    assertThat(column(next, "planned_for", LocalDate.class)).isEqualTo(today.plusDays(3));
    assertThat(openCount(chore)).isEqualTo(1);
  }

  // ---- When needed -----------------------------------------------------------------------------

  @Test
  void anyoneInTheRotationCanCompleteAndTheCreditGoesToThem() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    UUID open = openOf(chore);
    assertThat(assignees(open)).containsExactly(home.owner());
    assertThat(dueAt(open)).isEqualTo(at(today.plusDays(2), EIGHT_PM));

    // Ben is a member but not in the rotation: he sees it and may flag it, not complete it.
    AssignmentResponse benView = view(open, home.ben());
    assertThat(benView.canComplete()).isFalse();
    assertThat(benView.actions().canFlag()).isTrue();
    assertThatThrownBy(() -> complete(open, home.ben()))
        .isInstanceOf(HouseholdAccessDeniedException.class)
        .hasMessage("Only people in this chore's rotation can complete it.");

    AssignmentResponse anaView = view(open, home.ana());
    assertThat(anaView.canComplete()).isTrue();
    assertThat(anaView.turn().userId()).isEqualTo(home.owner());
    complete(open, home.ana());

    assertThat(
            jdbc.queryForObject(
                "SELECT completed_by_user_id FROM chore_completions WHERE assignment_id=?",
                UUID.class,
                open))
        .isEqualTo(home.ana());
    // Completed lists it for whoever did it, not for whose turn it was.
    assertThat(occurrenceService.myChores(home.householdId(), "COMPLETED", auth(home.ana())))
        .extracting(AssignmentResponse::id)
        .containsExactly(open);
    assertThat(occurrenceService.myChores(home.householdId(), "COMPLETED", auth(home.owner())))
        .isEmpty();
    // Covering for the owner leaves the turn with the owner.
    UUID next = openOf(chore);
    assertThat(assignees(next)).containsExactly(home.owner());
    assertThat(view(next, home.owner()).lastDone().byUserId()).isEqualTo(home.ana());
  }

  @Test
  void theFewestCompletionsGoNextWithTiesInRotationOrder() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    assertThat(assignees(openOf(chore))).containsExactly(home.owner());
    complete(openOf(chore), home.owner());
    assertThat(assignees(openOf(chore))).containsExactly(home.ana());
    complete(openOf(chore), home.ana());
    // 1 and 1: the tie goes to the owner, first in rotation order.
    assertThat(assignees(openOf(chore))).containsExactly(home.owner());
    assertThat(openCount(chore)).isEqualTo(1);
  }

  @Test
  void aLateJoinerStartsLevelInsteadOfGettingABurstOfTurns() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    complete(openOf(chore), home.owner()); // owner 1
    complete(openOf(chore), home.ana()); // ana 1
    complete(openOf(chore), home.owner()); // owner 2, ana's turn

    updateWhenNeeded(chore, 2, EIGHT_PM, List.of(home.owner(), home.ana(), home.ben()));
    List<UUID> turns = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      UUID open = openOf(chore);
      UUID turn = assignees(open).getFirst();
      turns.add(turn);
      complete(open, turn);
    }
    // Ben starts level with Ana (1), so the turns stay one each instead of Ben catching up. On
    // that tie Ben goes first (never done counts as longest ago), then whoever did it longest ago.
    assertThat(turns).containsExactly(home.ben(), home.ana(), home.owner(), home.ben());
  }

  @Test
  void removingAParticipantOrAMemberExitRecomputesTheTurn() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    complete(openOf(chore), home.owner());
    UUID anaTurn = openOf(chore);
    assertThat(assignees(anaTurn)).containsExactly(home.ana());

    // Ben joins level with the owner and comes first in the new rotation order.
    updateWhenNeeded(chore, 2, EIGHT_PM, List.of(home.ben(), home.owner()));
    assertThat(openOf(chore)).isEqualTo(anaTurn);
    assertThat(assignees(anaTurn)).containsExactly(home.ben());

    householdService.removeMember(home.householdId(), home.ben(), auth(home.owner()));
    assertThat(openCount(chore)).isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT cancelled_by_membership_exit FROM chore_assignments WHERE id=?",
                Boolean.class,
                anaTurn))
        .isTrue();

    // The hourly job repairs the missing open copy once, for the remaining participant.
    generationScheduler.run();
    generationScheduler.run();
    assertThat(openCount(chore)).isEqualTo(1);
    UUID repaired = openOf(chore);
    assertThat(assignees(repaired)).containsExactly(home.owner());
    assertThat(column(repaired, "planned_for", LocalDate.class))
        .isEqualTo(column(anaTurn, "planned_for", LocalDate.class));
  }

  @Test
  void twoMembersCompletingAtOnceGiveOneCompletionAndAlreadyDoneForTheOther() throws Exception {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    UUID open = openOf(chore);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<String>> results = new ArrayList<>();
      for (UUID user : List.of(home.owner(), home.ana())) {
        Callable<String> task =
            () -> {
              start.await();
              try {
                complete(open, user);
                return "ok";
              } catch (DuplicateResourceException exception) {
                return exception.getMessage();
              }
            };
        results.add(pool.submit(task));
      }
      start.countDown();
      List<String> outcomes = new ArrayList<>();
      for (Future<String> result : results) {
        outcomes.add(result.get());
      }
      assertThat(outcomes).containsOnlyOnce("ok");
      assertThat(outcomes)
          .anyMatch(message -> message.matches("Already done by Kinds (owner|ana)\\."));
    } finally {
      pool.shutdownNow();
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chore_completions WHERE assignment_id=?",
                Integer.class,
                open))
        .isEqualTo(1);
    assertThat(openCount(chore)).isEqualTo(1);

    // A double tap by the person who won is answered with the result, nothing more.
    UUID winner =
        jdbc.queryForObject(
            "SELECT completed_by_user_id FROM chore_completions WHERE assignment_id=?",
            UUID.class,
            open);
    assertThat(complete(open, winner).status()).isEqualTo("COMPLETED");
    assertThat(openCount(chore)).isEqualTo(1);
  }

  @Test
  void withTheBackstopOffThereIsNoDeadlineAndNoRemindersButFlagsStillWork() {
    UUID chore = whenNeeded("Toilet paper", null, null, List.of(home.owner(), home.ana()));
    UUID open = openOf(chore);
    assertThat(dueAt(open)).isNull();
    assertThat(view(open, home.ana()).repeat().backstopDays()).isNull();
    notificationScheduler.run();
    assertThat(reminderTypes(open, home.owner())).isEmpty();

    occurrenceService.flag(home.householdId(), open, auth(home.ben()));
    assertThat(dueAt(open)).isCloseTo(OffsetDateTime.now(ZoneOffset.UTC), within());
    assertThat(notices(open, home.owner(), "CHORE_NEEDS_DOING")).hasSize(1);
    notificationScheduler.run();
    assertThat(reminderTypes(open, home.owner()))
        .containsExactlyInAnyOrder("CHORE_OVERDUE", "CHORE_OVERDUE");
  }

  // ---- Needs doing -----------------------------------------------------------------------------

  @Test
  void needsDoingAlertsOnlyWhoseTurnItIsAndPullsTheDeadlineToNow() {
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled) VALUES (?, TRUE)",
        home.owner());
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    UUID open = openOf(chore);

    AssignmentResponse flagged = occurrenceService.flag(home.householdId(), open, auth(home.ben()));

    assertThat(flagged.flag().byUserId()).isEqualTo(home.ben());
    // The flag brings the day forward; that is not a move.
    assertThat(flagged.originalDate()).isNull();
    assertThat(flagged.moved()).isFalse();
    assertThat(dueAt(open)).isCloseTo(OffsetDateTime.now(ZoneOffset.UTC), within());
    assertThat(column(open, "scheduled_for", LocalDate.class)).isEqualTo(today);
    assertThat(notices(open, home.owner(), "CHORE_NEEDS_DOING"))
        .containsExactly("Garbage needs doing. It's your turn.");
    assertThat(notices(open, home.ana(), "CHORE_NEEDS_DOING")).isEmpty();
    assertThat(notices(open, home.ben(), "CHORE_NEEDS_DOING")).isEmpty();
    assertThat(deliveryChannels(open, home.owner(), "CHORE_NEEDS_DOING"))
        .containsExactlyInAnyOrder("IN_APP", "WEB_PUSH");

    // Pressing again within two hours does nothing.
    assertThatThrownBy(() -> occurrenceService.flag(home.householdId(), open, auth(home.ana())))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessageStartingWith("Already flagged at ");
    assertThat(notices(open, home.owner(), "CHORE_NEEDS_DOING")).hasSize(1);
    assertThat(view(open, home.ana()).flag().byUserId()).isEqualTo(home.ben());

    // The overdue reminders follow if it is ignored.
    notificationScheduler.run();
    assertThat(reminderTypes(open, home.owner()))
        .containsExactlyInAnyOrder("CHORE_OVERDUE", "CHORE_OVERDUE");

    // Completing clears the flag: the next copy starts unflagged.
    complete(open, home.owner());
    UUID next = openOf(chore);
    assertThat(view(next, home.ana()).flag()).isNull();
    assertThat(column(next, "flagged_at", OffsetDateTime.class)).isNull();
    assertThat(view(open, home.ana()).flag()).isNull();
  }

  @Test
  void needsDoingNeverResendsDeliveredRemindersAndRespectsPreferences() {
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, chore_reminders_enabled) VALUES (?, FALSE)",
        home.ana());
    UUID chore = whenNeeded("Garbage", 1, EIGHT_PM, List.of(home.owner(), home.ana()));
    complete(openOf(chore), home.owner());
    UUID open = openOf(chore); // Ana's turn; she has chore reminders off.
    assertThat(assignees(open)).containsExactly(home.ana());
    jdbc.update(
        "UPDATE notification_preferences SET chore_reminders_enabled=TRUE WHERE user_id=?",
        home.ana());
    notificationScheduler.run();
    UUID delivered =
        jdbc.queryForObject(
            """
                SELECT id FROM notifications WHERE reference_id=? AND recipient_user_id=?
                  AND type='CHORE_DUE_SOON' ORDER BY scheduled_at LIMIT 1
                """,
            UUID.class,
            open,
            home.ana());
    jdbc.update("UPDATE notifications SET status='SENT', sent_at=NOW() WHERE id=?", delivered);
    jdbc.update(
        "UPDATE notification_deliveries SET status='SENT', sent_at=NOW(), attempts=1 "
            + "WHERE notification_id=?",
        delivered);
    jdbc.update(
        "UPDATE notification_preferences SET chore_reminders_enabled=FALSE WHERE user_id=?",
        home.ana());

    occurrenceService.flag(home.householdId(), open, auth(home.owner()));

    // Preferences: Ana has chore reminders off, so "Needs doing" is not shown to her.
    assertThat(notices(open, home.ana(), "CHORE_NEEDS_DOING")).isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM notifications WHERE id=?", String.class, delivered))
        .isEqualTo("SENT");
    jdbc.update(
        "UPDATE notification_preferences SET chore_reminders_enabled=TRUE WHERE user_id=?",
        home.ana());
    notificationScheduler.run();
    notificationScheduler.run();
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications n
                    WHERE n.reference_id=? AND n.recipient_user_id=? AND n.type='CHORE_DUE_SOON'
                      AND n.status IN ('PENDING','SENT')
                    """,
                Integer.class,
                open,
                home.ana()))
        .isEqualTo(1);
  }

  @Test
  void turnChangesAreAnInAppLineAndNeverAChoreAssignedPush() {
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled) VALUES (?, TRUE)",
        home.ana());
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    complete(openOf(chore), home.owner());
    UUID next = openOf(chore);
    assertThat(notices(next, home.ana(), "CHORE_TURN"))
        .containsExactly("It's your turn for Garbage.");
    assertThat(deliveryChannels(next, home.ana(), "CHORE_TURN")).containsExactly("IN_APP");
    assertThat(notices(next, home.ana(), "CHORE_ASSIGNED")).isEmpty();

    // Reassign changes whose turn it is without changing anyone's count.
    occurrenceService.reassign(home.householdId(), next, List.of(home.owner()), auth(home.owner()));
    assertThat(assignees(next)).containsExactly(home.owner());
    assertThat(notices(next, home.owner(), "CHORE_ASSIGNED")).isEmpty();
    assertThatThrownBy(
            () ->
                occurrenceService.reassign(
                    home.householdId(), next, List.of(home.ben()), auth(home.owner())))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Choose someone in this chore's rotation.");
    complete(next, home.owner());
    // Owner 2, Ana 0: Ana is next.
    assertThat(assignees(openOf(chore))).containsExactly(home.ana());
  }

  @Test
  void whenNeededOffersOnlyReassignAndNeedsDoing() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    UUID open = openOf(chore);
    AssignmentResponse.Actions owner = view(open, home.owner()).actions();
    assertThat(owner.canMove()).isFalse();
    assertThat(owner.canSkip()).isFalse();
    assertThat(owner.canUnskip()).isFalse();
    assertThat(owner.canReassign()).isTrue();
    assertThat(owner.canFlag()).isTrue();
    assertThat(view(open, home.ana()).actions().canReassign()).isFalse();
    assertThatThrownBy(() -> occurrenceService.skip(home.householdId(), open, auth(home.owner())))
        .isInstanceOf(InvalidHouseholdException.class);
    assertThatThrownBy(
            () ->
                occurrenceService.move(
                    home.householdId(), open, today.plusDays(1), null, auth(home.owner())))
        .isInstanceOf(InvalidHouseholdException.class);
  }

  // ---- Home and My Chores ----------------------------------------------------------------------

  @Test
  void householdJobsAreShownToEveryMemberAndMyChoresToTheRotation() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    UUID open = openOf(chore);
    DashboardResponse benHome = occurrenceService.dashboard(home.householdId(), auth(home.ben()));
    assertThat(benHome.householdJobs()).extracting(AssignmentResponse::id).containsExactly(open);
    assertThat(benHome.today()).isEmpty();
    assertThat(benHome.thisWeek()).extracting(AssignmentResponse::id).doesNotContain(open);

    assertThat(occurrenceService.myChores(home.householdId(), "UPCOMING", auth(home.ana())))
        .extracting(AssignmentResponse::id)
        .containsExactly(open);
    assertThat(occurrenceService.myChores(home.householdId(), "UPCOMING", auth(home.ben())))
        .isEmpty();

    // Flagged: in the attention area for whoever's turn it is.
    occurrenceService.flag(home.householdId(), open, auth(home.ben()));
    assertThat(occurrenceService.dashboard(home.householdId(), auth(home.owner())).overdue())
        .extracting(AssignmentResponse::id)
        .containsExactly(open);
    assertThat(occurrenceService.dashboard(home.householdId(), auth(home.ana())).overdue())
        .isEmpty();
  }

  @Test
  void weekTotalsCountByDueDayAndUndatedJobsOnlyOnceDone() {
    DashboardResponse.WeekSummary before =
        occurrenceService.dashboard(home.householdId(), auth(home.owner())).weekSummary();
    UUID chore = whenNeeded("Toilet paper", null, null, List.of(home.owner(), home.ana()));
    DashboardResponse.WeekSummary open =
        occurrenceService.dashboard(home.householdId(), auth(home.owner())).weekSummary();
    assertThat(open.totalCount()).isEqualTo(before.totalCount());

    complete(openOf(chore), home.ana());
    DashboardResponse.WeekSummary done =
        occurrenceService.dashboard(home.householdId(), auth(home.owner())).weekSummary();
    assertThat(done.totalCount()).isEqualTo(before.totalCount() + 1);
    assertThat(done.completedCount()).isEqualTo(before.completedCount() + 1);
    assertThat(done.completionPercentage()).isEqualTo(100.0);
  }

  // ---- Pause, activate, archive, edits ---------------------------------------------------------

  @Test
  void pauseCancelsTheOpenCopyAndActivateStartsFresh() {
    UUID garbage = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    UUID open = openOf(garbage);
    occurrenceService.flag(home.householdId(), open, auth(home.ben()));
    notificationScheduler.run();
    assertThat(reminderTypes(open, home.owner())).isNotEmpty();

    choreService.pauseChore(home.householdId(), garbage, auth(home.owner()));
    assertThat(status(open)).isEqualTo("CANCELLED");
    assertThat(column(open, "flagged_at", OffsetDateTime.class)).isNull();
    assertThat(pendingReminders(open)).isZero();
    generationScheduler.run();
    assertThat(openCount(garbage)).isZero();

    choreService.activateChore(home.householdId(), garbage, auth(home.owner()));
    UUID fresh = openOf(garbage);
    assertThat(fresh).isNotEqualTo(open);
    assertThat(dueAt(fresh)).isEqualTo(at(today.plusDays(2), EIGHT_PM));

    UUID vacuum =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(4), EIGHT_PM, fixed(), anaOnly());
    choreService.pauseChore(home.householdId(), vacuum, auth(home.owner()));
    assertThat(openCount(vacuum)).isZero();
    choreService.activateChore(home.householdId(), vacuum, auth(home.owner()));
    assertThat(column(openOf(vacuum), "planned_for", LocalDate.class)).isEqualTo(today.plusDays(4));

    choreService.archiveChore(home.householdId(), vacuum, auth(home.owner()));
    assertThat(openCount(vacuum)).isZero();
  }

  @Test
  void changingKindEndsTheOldSeriesAndKeepsHistory() {
    UUID chore =
        choreService
            .createChore(
                home.householdId(),
                request(
                    "Bins",
                    new ChoreScheduleRequest(
                        "FREQ=DAILY",
                        null,
                        today.minusDays(2),
                        null,
                        EIGHT_PM,
                        AssignmentStrategy.FIXED,
                        home.ana(),
                        null,
                        1)),
                auth(home.owner()))
            .id();
    UUID past =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for=?",
            UUID.class,
            chore,
            today);
    complete(past, home.ana());
    int futureCalendar =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=? AND status='PENDING'",
            Integer.class,
            chore);
    assertThat(futureCalendar).isGreaterThan(5);

    choreService.updateChore(
        home.householdId(),
        chore,
        request(
            "Bins",
            afterSchedule(3, IntervalUnit.DAY, today.plusDays(1), EIGHT_PM, fixed(), anaOnly())),
        auth(home.owner()));

    assertThat(status(past)).isEqualTo("COMPLETED");
    assertThat(
            jdbc.queryForList(
                """
                    SELECT kind_snapshot FROM chore_assignments
                    WHERE chore_id=? AND status IN ('PENDING','SUBMITTED')
                    """,
                String.class,
                chore))
        .containsExactly("AFTER_COMPLETION");
    assertThatThrownBy(
            () ->
                choreService.updateChore(
                    home.householdId(),
                    chore,
                    request(
                        "Bins",
                        new ChoreScheduleRequest(
                            "FREQ=ONCE",
                            null,
                            today.plusDays(1),
                            null,
                            EIGHT_PM,
                            AssignmentStrategy.FIXED,
                            home.ana(),
                            null,
                            1)),
                    auth(home.owner())))
        .isInstanceOf(InvalidHouseholdException.class);
  }

  @Test
  void changingTheIntervalOrBackstopReplansTheOpenDeadlineFromTheLastCompletion() {
    UUID vacuum =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(1), EIGHT_PM, fixed(), anaOnly());
    complete(openOf(vacuum), home.ana());
    UUID open = openOf(vacuum);
    notificationScheduler.run();
    assertThat(pendingReminders(open)).isPositive();

    choreService.updateChore(
        home.householdId(),
        vacuum,
        request(
            "Vacuum",
            afterSchedule(5, IntervalUnit.DAY, today.plusDays(1), null, fixed(), anaOnly())),
        auth(home.owner()));
    assertThat(openOf(vacuum)).isEqualTo(open);
    assertThat(dueAt(open)).isEqualTo(at(today.plusDays(5), LocalTime.of(23, 59)));
    assertThat(pendingReminders(open)).isZero();

    UUID garbage = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    OffsetDateTime doneAt = pinCompletion(today.plusDays(1), LocalTime.of(9, 15));
    complete(openOf(garbage), home.owner());
    UUID next = openOf(garbage);
    updateWhenNeeded(garbage, 4, EIGHT_PM, List.of(home.owner(), home.ana()));
    // "When needed" re-plans from the completion instant, not the due time.
    assertThat(dueAt(next)).isEqualTo(doneAt.plusDays(4));
    updateWhenNeeded(garbage, null, EIGHT_PM, List.of(home.owner(), home.ana()));
    assertThat(dueAt(next)).isNull();
  }

  @Test
  void kindSpecificSettingsAreValidatedWithClearMessages() {
    assertRejected(
        afterSchedule(0, IntervalUnit.DAY, today, null, fixed(), anaOnly()),
        "Choose between 1 and 365 days after it's done.");
    assertRejected(
        afterSchedule(53, IntervalUnit.WEEK, today, null, fixed(), anaOnly()),
        "Choose between 1 and 52 weeks after it's done.");
    assertRejected(
        new ChoreScheduleRequest(
            null,
            null,
            today,
            today.plusDays(9),
            null,
            AssignmentStrategy.FIXED,
            home.ana(),
            anaOnly(),
            1,
            ScheduleKind.AFTER_COMPLETION,
            3,
            IntervalUnit.DAY,
            null,
            null),
        "An end date doesn't apply to this chore type.");
    assertRejected(
        new ChoreScheduleRequest(
            "FREQ=DAILY;COUNT=3",
            null,
            today,
            null,
            null,
            AssignmentStrategy.FIXED,
            home.ana(),
            anaOnly(),
            1,
            ScheduleKind.AFTER_COMPLETION,
            3,
            IntervalUnit.DAY,
            null,
            null),
        "A number of times doesn't apply to this chore type.");
    assertRejected(
        new ChoreScheduleRequest(
            null,
            null,
            null,
            null,
            null,
            AssignmentStrategy.RANDOM,
            null,
            List.of(home.owner(), home.ana()),
            1,
            ScheduleKind.AS_NEEDED,
            null,
            null,
            true,
            2),
        "A When needed chore either rotates or has one fixed person.");
    assertRejected(
        new ChoreScheduleRequest(
            null,
            null,
            null,
            null,
            null,
            AssignmentStrategy.ROUND_ROBIN,
            null,
            List.of(home.owner(), home.ana()),
            1,
            ScheduleKind.AS_NEEDED,
            null,
            null,
            true,
            31),
        "Choose \"at least every\" between 1 and 30 days.");
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  // ---- When needed: rolling deadline from the completion ---------------------------------------

  @Test
  void whenNeededDueIsTheCompletionInstantPlusTheBackstopDays() {
    UUID chore = whenNeeded("Garbage", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    // The first one keeps the chosen time.
    assertThat(dueAt(openOf(chore))).isEqualTo(at(today.plusDays(2), EIGHT_PM));

    OffsetDateTime lateNight = pinCompletion(today.plusDays(1), LocalTime.of(23, 50));
    complete(openOf(chore), home.owner());
    UUID second = openOf(chore);
    assertThat(dueAt(second)).isEqualTo(lateNight.plusDays(2));
    assertThat(column(second, "planned_for", LocalDate.class)).isEqualTo(today.plusDays(3));

    OffsetDateTime afternoon = pinCompletion(today.plusDays(2), LocalTime.of(17, 0));
    complete(second, home.ana());
    UUID third = openOf(chore);
    assertThat(dueAt(third)).isEqualTo(afternoon.plusDays(2));
    assertThat(column(third, "planned_for", LocalDate.class)).isEqualTo(today.plusDays(4));
  }

  @Test
  void whenNeededKeepsTheWallClockTimeAcrossADaylightSavingChange() {
    jdbc.update("UPDATE households SET timezone='America/Halifax' WHERE id=?", home.householdId());
    UUID chore = whenNeeded("Recycling", 2, EIGHT_PM, List.of(home.owner(), home.ana()));
    ZoneId halifax = ZoneId.of("America/Halifax");
    // Clocks spring forward in Halifax at 2 AM on Sunday, March 14 2027.
    java.time.ZonedDateTime done = LocalDate.of(2027, 3, 13).atTime(23, 50).atZone(halifax);
    occurrenceService.useClock(java.time.Clock.fixed(done.toInstant(), ZoneOffset.UTC));
    complete(openOf(chore), home.owner());

    UUID next = openOf(chore);
    java.time.ZonedDateTime due = dueAt(next).atZoneSameInstant(halifax);
    assertThat(due.toLocalDateTime()).isEqualTo(LocalDate.of(2027, 3, 15).atTime(23, 50));
    assertThat(column(next, "planned_for", LocalDate.class)).isEqualTo(LocalDate.of(2027, 3, 15));
    // Two calendar days, one of them 23 hours long.
    assertThat(java.time.Duration.between(done, due)).isEqualTo(java.time.Duration.ofHours(47));
  }

  @Test
  void editingWhenNeededReplansFromTheLastCompletionOrMovesOnlyTheOpenDeadline() {
    List<UUID> rotation = List.of(home.owner(), home.ana());
    UUID chore = whenNeeded("Dishwasher", 2, EIGHT_PM, rotation);
    OffsetDateTime doneAt = pinCompletion(today.plusDays(1), LocalTime.of(7, 30));
    complete(openOf(chore), home.owner());
    UUID open = openOf(chore);
    notificationScheduler.run();
    assertThat(pendingReminders(open)).isPositive();

    // A new backstop counts again from the completion instant; old reminders go, new ones come.
    updateWhenNeeded(chore, 3, EIGHT_PM, rotation);
    assertThat(openOf(chore)).isEqualTo(open);
    assertThat(dueAt(open)).isEqualTo(doneAt.plusDays(3));
    assertThat(pendingReminders(open)).isZero();
    notificationScheduler.run();
    assertThat(pendingReminders(open)).isPositive();

    // A new due time is the user's choice for this one: that time on its planned day.
    updateWhenNeeded(chore, 3, LocalTime.of(18, 0), rotation);
    assertThat(dueAt(open)).isEqualTo(at(today.plusDays(4), LocalTime.of(18, 0)));
    // An unrelated edit leaves it alone.
    updateWhenNeeded(chore, 3, LocalTime.of(18, 0), List.of(home.ana(), home.owner()));
    assertThat(dueAt(open)).isEqualTo(at(today.plusDays(4), LocalTime.of(18, 0)));

    // The next completion rolls again: no clock time from the settings.
    OffsetDateTime later = pinCompletion(today.plusDays(2), LocalTime.of(21, 5));
    complete(open, home.ana());
    assertThat(dueAt(openOf(chore))).isEqualTo(later.plusDays(3));
  }

  @Test
  void anExistingOpenCopyKeepsItsDeadlineUntilItIsCompleted() {
    List<UUID> rotation = List.of(home.owner(), home.ana());
    UUID chore = whenNeeded("Bins", 2, EIGHT_PM, rotation);
    complete(openOf(chore), home.owner());
    UUID open = openOf(chore);
    // An open copy from before the rule: dated at the due time, with only "basedOn" stored.
    OffsetDateTime legacyDue = at(today.plusDays(2), EIGHT_PM);
    jdbc.update(
        """
            UPDATE chore_assignments
            SET due_at=?, planned_for=?, scheduled_for=?,
                metadata=jsonb_build_object('basedOn', ?::text)
            WHERE id=?
            """,
        legacyDue,
        today.plusDays(2),
        today.plusDays(2),
        today.toString(),
        open);

    generationScheduler.run();
    updateWhenNeeded(chore, 2, EIGHT_PM, List.of(home.ana(), home.owner()));
    assertThat(dueAt(open)).isEqualTo(legacyDue);

    OffsetDateTime doneAt = pinCompletion(today.plusDays(1), LocalTime.of(23, 50));
    complete(open, home.ana());
    assertThat(dueAt(openOf(chore))).isEqualTo(doneAt.plusDays(2));
  }

  @Test
  void afterItsDoneStillUsesTheDoneDayAndDueTimeForCompletionsAndSkips() {
    UUID chore =
        afterChore("Vacuum", 3, IntervalUnit.DAY, today.plusDays(1), EIGHT_PM, fixed(), anaOnly());
    pinCompletion(today.plusDays(1), LocalTime.of(23, 50));
    complete(openOf(chore), home.ana());
    UUID next = openOf(chore);
    assertThat(dueAt(next)).isEqualTo(at(today.plusDays(4), EIGHT_PM));

    occurrenceService.skip(home.householdId(), next, auth(home.owner()));
    assertThat(dueAt(openOf(chore))).isEqualTo(at(today.plusDays(3), EIGHT_PM));
  }

  /** Completions happen at this UTC day and time (the household is in UTC). */
  private OffsetDateTime pinCompletion(LocalDate day, LocalTime time) {
    OffsetDateTime instant = day.atTime(time).atOffset(ZoneOffset.UTC);
    occurrenceService.useClock(java.time.Clock.fixed(instant.toInstant(), ZoneOffset.UTC));
    return instant;
  }

  private void assertRejected(ChoreScheduleRequest schedule, String message) {
    assertThatThrownBy(
            () ->
                choreService.createChore(
                    home.householdId(), request("Rejected", schedule), auth(home.owner())))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(message);
  }

  private static org.assertj.core.data.TemporalUnitOffset within() {
    return new org.assertj.core.data.TemporalUnitWithinOffset(
        Duration.ofMinutes(1).toSeconds(), java.time.temporal.ChronoUnit.SECONDS);
  }

  private AssignmentStrategy fixed() {
    return AssignmentStrategy.FIXED;
  }

  private List<UUID> anaOnly() {
    return List.of(home.ana());
  }

  private ChoreRequest request(String title, ChoreScheduleRequest schedule) {
    return new ChoreRequest(title, null, null, null, null, null, false, schedule);
  }

  private ChoreScheduleRequest afterSchedule(
      int count,
      IntervalUnit unit,
      LocalDate firstDue,
      LocalTime dueTime,
      AssignmentStrategy strategy,
      List<UUID> participants) {
    return new ChoreScheduleRequest(
        null,
        null,
        firstDue,
        null,
        dueTime,
        strategy,
        strategy == AssignmentStrategy.FIXED ? participants.getFirst() : null,
        participants,
        1,
        ScheduleKind.AFTER_COMPLETION,
        count,
        unit,
        null,
        null);
  }

  private UUID afterChore(
      String title,
      int count,
      IntervalUnit unit,
      LocalDate firstDue,
      LocalTime dueTime,
      AssignmentStrategy strategy,
      List<UUID> participants) {
    return choreService
        .createChore(
            home.householdId(),
            request(title, afterSchedule(count, unit, firstDue, dueTime, strategy, participants)),
            auth(home.owner()))
        .id();
  }

  private ChoreScheduleRequest whenNeededSchedule(
      Integer backstopDays, LocalTime dueTime, List<UUID> participants) {
    return new ChoreScheduleRequest(
        null,
        null,
        null,
        null,
        dueTime,
        AssignmentStrategy.ROUND_ROBIN,
        null,
        participants,
        1,
        ScheduleKind.AS_NEEDED,
        null,
        null,
        backstopDays != null,
        backstopDays);
  }

  private UUID whenNeeded(
      String title, Integer backstopDays, LocalTime dueTime, List<UUID> participants) {
    return choreService
        .createChore(
            home.householdId(),
            request(title, whenNeededSchedule(backstopDays, dueTime, participants)),
            auth(home.owner()))
        .id();
  }

  private void updateWhenNeeded(
      UUID chore, Integer backstopDays, LocalTime dueTime, List<UUID> participants) {
    String title = jdbc.queryForObject("SELECT title FROM chores WHERE id=?", String.class, chore);
    choreService.updateChore(
        home.householdId(),
        chore,
        request(title, whenNeededSchedule(backstopDays, dueTime, participants)),
        auth(home.owner()));
  }

  private AssignmentResponse complete(UUID occurrence, UUID user) {
    return occurrenceService.complete(home.householdId(), occurrence, auth(user));
  }

  private AssignmentResponse view(UUID occurrence, UUID viewer) {
    return occurrenceService.occurrence(home.householdId(), occurrence, auth(viewer));
  }

  private UUID openOf(UUID chore) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND status IN ('PENDING','SUBMITTED')",
        UUID.class,
        chore);
  }

  private int openCount(UUID chore) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=? AND status IN ('PENDING','SUBMITTED')",
        Integer.class,
        chore);
  }

  private OffsetDateTime at(LocalDate day, LocalTime time) {
    return day.atTime(time).atOffset(ZoneOffset.UTC);
  }

  private OffsetDateTime dueAt(UUID occurrence) {
    OffsetDateTime value = column(occurrence, "due_at", OffsetDateTime.class);
    return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC);
  }

  private String status(UUID occurrence) {
    return column(occurrence, "status", String.class);
  }

  private <T> T column(UUID occurrence, String name, Class<T> type) {
    return jdbc.queryForObject(
        "SELECT " + name + " FROM chore_assignments WHERE id=?", type, occurrence);
  }

  private List<UUID> assignees(UUID occurrence) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
        UUID.class,
        occurrence);
  }

  private List<String> reminderTypes(UUID occurrence, UUID recipient) {
    return jdbc.queryForList(
        """
            SELECT type FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND recipient_user_id=?
              AND status='PENDING' AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        String.class,
        occurrence,
        recipient);
  }

  private int pendingReminders(UUID occurrence) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
              AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        Integer.class,
        occurrence);
  }

  private List<String> notices(UUID occurrence, UUID recipient, String type) {
    return jdbc.queryForList(
        """
            SELECT message FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND recipient_user_id=?
              AND type=? ORDER BY created_at
            """,
        String.class,
        occurrence,
        recipient,
        type);
  }

  private List<String> deliveryChannels(UUID occurrence, UUID recipient, String type) {
    return jdbc.queryForList(
        """
            SELECT d.channel FROM notification_deliveries d
            JOIN notifications n ON n.id=d.notification_id
            WHERE n.reference_id=? AND n.recipient_user_id=? AND n.type=?
            """,
        String.class,
        occurrence,
        recipient,
        type);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "kinds-" + label + "-" + id + "@example.test",
        "Kinds " + label);
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

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }

  private record Home(UUID householdId, UUID owner, UUID ana, UUID ben) {}
}
