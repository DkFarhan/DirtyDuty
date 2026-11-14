package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
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

/** Move, skip, unskip and reassign one occurrence, and how series edits and COUNT treat them. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class OccurrenceActionsIntegrationTest {
  private static final LocalTime NOON = LocalTime.NOON;

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
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Actions', 'UTC', ?)",
        householdId,
        owner);
    addMember(householdId, owner, "OWNER");
    addMember(householdId, ana, "MEMBER");
    addMember(householdId, ben, "MEMBER");
    home = new Home(householdId, owner, ana, ben);
  }

  @AfterEach
  void cleanFixtures() {
    for (UUID householdId : householdIds) {
      jdbc.update(
          """
              DELETE FROM notification_push_delivery_targets WHERE notification_id IN (
                SELECT n.id FROM notifications n
                WHERE (n.reference_type='CHORE_ASSIGNMENT'
                       AND n.reference_id IN (SELECT id FROM chore_assignments WHERE household_id=?))
                   OR n.event_id IN (SELECT id FROM notification_events WHERE household_id=?))
              """,
          householdId,
          householdId);
      jdbc.update(
          """
              DELETE FROM notification_deliveries WHERE notification_id IN (
                SELECT n.id FROM notifications n
                WHERE (n.reference_type='CHORE_ASSIGNMENT'
                       AND n.reference_id IN (SELECT id FROM chore_assignments WHERE household_id=?))
                   OR n.event_id IN (SELECT id FROM notification_events WHERE household_id=?))
              """,
          householdId,
          householdId);
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
      jdbc.update("DELETE FROM household_invitations WHERE household_id=?", householdId);
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

  // ---- Move -----------------------------------------------------------------------------------

  @Test
  void assigneeMayMoveTheirOwnChoreWithinSevenDaysOfItsOriginalDayButNotBeforeToday() {
    LocalDate planned = today.plusDays(10);
    UUID choreId = fixedChore("Water plants", yearlyOn(planned), today, home.ana());
    UUID occurrence = occurrenceOn(choreId, planned);

    AssignmentResponse.Actions actions = view(occurrence, home.ana()).actions();
    assertThat(actions.canMove()).isTrue();
    assertThat(actions.moveEarliest()).isEqualTo(planned.minusDays(7));
    assertThat(actions.moveLatest()).isEqualTo(planned.plusDays(7));
    assertThat(actions.canSkip()).isFalse();
    assertThat(actions.canReassign()).isFalse();

    assertMessage(
        () -> move(occurrence, planned.plusDays(8), home.ana()),
        "You can move your chore up to 7 days before or after its original day.");
    AssignmentResponse moved = move(occurrence, planned.plusDays(7), home.ana());
    assertThat(moved.scheduledFor()).isEqualTo(planned.plusDays(7));
    assertThat(moved.originalDate()).isEqualTo(planned);
    assertThat(moved.moved()).isTrue();
    // The window stays anchored on the original day, so moves cannot be chained.
    assertMessage(
        () -> move(occurrence, planned.plusDays(14), home.ana()),
        "You can move your chore up to 7 days before or after its original day.");
    assertThat(move(occurrence, planned.minusDays(7), home.ana()).scheduledFor())
        .isEqualTo(planned.minusDays(7));

    LocalDate soon = today.plusDays(2);
    UUID soonChore = fixedChore("Feed fish", yearlyOn(soon), today, home.ana());
    UUID soonOccurrence = occurrenceOn(soonChore, soon);
    assertThat(view(soonOccurrence, home.ana()).actions().moveEarliest()).isEqualTo(today);
    assertMessage(
        () -> move(soonOccurrence, today.minusDays(1), home.ana()), "Choose today or a later day.");
    assertThat(move(soonOccurrence, today, home.ana()).scheduledFor()).isEqualTo(today);
  }

  @Test
  void ownerAndAdminMayMoveAnyPendingChoreToAnyDayFromToday() {
    LocalDate planned = today.plusDays(3);
    UUID choreId = fixedChore("Clean oven", yearlyOn(planned), today, home.ana());
    UUID occurrence = occurrenceOn(choreId, planned);
    AssignmentResponse.Actions actions = view(occurrence, home.owner()).actions();
    assertThat(actions.canMove()).isTrue();
    assertThat(actions.moveEarliest()).isEqualTo(today);
    assertThat(actions.moveLatest()).isNull();

    AssignmentResponse moved =
        move(occurrence, planned.plusDays(60), home.owner(), LocalTime.of(9, 30));
    assertThat(moved.scheduledFor()).isEqualTo(planned.plusDays(60));
    assertThat(moved.dueAt().toInstant())
        .isEqualTo(planned.plusDays(60).atTime(9, 30).toInstant(ZoneOffset.UTC));
    assertMessage(
        () -> move(occurrence, today.minusDays(1), home.owner()), "Choose today or a later day.");

    jdbc.update(
        "UPDATE household_memberships SET role='ADMIN' WHERE household_id=? AND user_id=?",
        home.householdId(),
        home.ben());
    assertThat(move(occurrence, today, home.ben()).scheduledFor()).isEqualTo(today);
  }

  @Test
  void membersCannotSkipReassignOrMoveSomeoneElsesChore() {
    LocalDate planned = today.plusDays(4);
    UUID occurrence =
        occurrenceOn(fixedChore("Dust", yearlyOn(planned), today, home.ana()), planned);

    AssignmentResponse.Actions benActions = view(occurrence, home.ben()).actions();
    assertThat(benActions.canMove()).isFalse();
    assertThat(benActions.canSkip()).isFalse();
    assertThat(benActions.canReassign()).isFalse();
    assertMessage(
        () -> move(occurrence, planned.plusDays(1), home.ben()),
        "You can only move chores that are assigned to you.");
    assertMessage(
        () -> occurrenceService.skip(home.householdId(), occurrence, auth(home.ana())),
        "Only household owners and admins can skip a chore.");
    assertMessage(
        () ->
            occurrenceService.reassign(
                home.householdId(), occurrence, List.of(home.ana()), auth(home.ana())),
        "Only household owners and admins can reassign a chore.");
    assertThat(status(occurrence)).isEqualTo("PENDING");
  }

  @Test
  void nonMembersGetForbiddenAndOtherHouseholdsOccurrencesAreNotFound() {
    LocalDate planned = today.plusDays(4);
    UUID occurrence =
        occurrenceOn(fixedChore("Dust", yearlyOn(planned), today, home.ana()), planned);
    UUID outsider = createUser("outsider");
    assertThatThrownBy(() -> move(occurrence, planned.plusDays(1), outsider))
        .isInstanceOf(HouseholdAccessDeniedException.class);

    UUID otherHousehold = UUID.randomUUID();
    householdIds.add(otherHousehold);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Other', 'UTC', ?)",
        otherHousehold,
        outsider);
    addMember(otherHousehold, outsider, "OWNER");
    assertThatThrownBy(() -> occurrenceService.skip(otherHousehold, occurrence, auth(outsider)))
        .isInstanceOf(ResourceNotFoundException.class);
  }

  @Test
  void submittedAndCompletedOccurrencesCannotBeMovedSkippedOrReassigned() {
    LocalDate planned = today.plusDays(2);
    UUID done = occurrenceOn(fixedChore("Mop", yearlyOn(planned), today, home.ana()), planned);
    occurrenceService.complete(home.householdId(), done, auth(home.ana()));
    UUID submitted =
        occurrenceOn(fixedChore("Vacuum", yearlyOn(planned), today, home.ana()), planned);
    jdbc.update("UPDATE chore_assignments SET status='SUBMITTED' WHERE id=?", submitted);

    for (UUID occurrence : List.of(done, submitted)) {
      assertMessage(
          () -> move(occurrence, planned.plusDays(1), home.owner()),
          "Only a chore that is still to do can be moved.");
      assertMessage(
          () -> occurrenceService.skip(home.householdId(), occurrence, auth(home.owner())),
          "Only a chore that is still to do can be skipped.");
      assertMessage(
          () ->
              occurrenceService.reassign(
                  home.householdId(), occurrence, List.of(home.ben()), auth(home.owner())),
          "Only a chore that is still to do can be reassigned.");
      assertThat(view(occurrence, home.owner()).actions().canMove()).isFalse();
    }
  }

  @Test
  void aMovedOccurrenceSurvivesBackgroundAndOnReadGenerationWithoutRecreatingItsOriginalDay() {
    LocalDate first = today.plusDays(1);
    UUID choreId = fixedChore("Bins out", weeklyOn(first), today, home.ana());
    int before = rowCount(choreId);
    UUID occurrence = occurrenceOn(choreId, first);
    move(occurrence, first.plusDays(2), home.owner());

    for (int run = 0; run < 3; run++) {
      occurrenceService.generateHousehold(home.householdId());
      generationScheduler.run();
      occurrenceService.dashboard(home.householdId(), auth(home.ana()));
      occurrenceService.myChores(home.householdId(), "UPCOMING", auth(home.ana()));
    }

    assertThat(status(occurrence)).isEqualTo("PENDING");
    assertThat(column(occurrence, "scheduled_for", LocalDate.class)).isEqualTo(first.plusDays(2));
    assertThat(column(occurrence, "planned_for", LocalDate.class)).isEqualTo(first);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=? AND scheduled_for=?",
                Integer.class,
                choreId,
                first))
        .isZero();
    assertThat(rowCount(choreId)).isEqualTo(before);
  }

  @Test
  void movingOntoADayTheChoreAlreadyHasIsRejected() {
    UUID daily = fixedChore("Feed cat", "FREQ=DAILY", today, home.ana());
    UUID occurrence = occurrenceOn(daily, today.plusDays(2));
    assertMessage(
        () -> move(occurrence, today.plusDays(3), home.owner()),
        OccurrenceService.OCCUPIED_DAY_MESSAGE);

    // A rule day beyond the generated horizon is taken too, so a later run cannot double it up.
    UUID weekly = fixedChore("Laundry", weeklyOn(today), today, home.ana());
    UUID nextWeek = occurrenceOn(weekly, today.plusDays(7));
    assertMessage(
        () -> move(nextWeek, today.plusDays(35), home.owner()),
        OccurrenceService.OCCUPIED_DAY_MESSAGE);
    assertThat(move(nextWeek, today.plusDays(36), home.owner()).scheduledFor())
        .isEqualTo(today.plusDays(36));
    // Its own original day is free again.
    assertThat(move(nextWeek, today.plusDays(7), home.owner()).moved()).isFalse();
  }

  // ---- Skip -----------------------------------------------------------------------------------

  @Test
  void skipCountsAsThatPersonsTurnAndDoesNotReshuffleUpcomingOccurrences() {
    UUID choreId = rotatingChore("Kitchen clean-up", weeklyOn(today), today);
    List<UUID> upcoming = occurrencesOf(choreId);
    UUID first = upcoming.getFirst();
    Map<UUID, List<UUID>> before = assigneesByOccurrence(upcoming);
    // Give the first turn to Ben, then skip it: it still counts as Ben's turn.
    occurrenceService.reassign(home.householdId(), first, List.of(home.ben()), auth(home.owner()));
    occurrenceService.skip(home.householdId(), first, auth(home.owner()));

    occurrenceService.generateHousehold(home.householdId());
    for (UUID occurrence : upcoming.subList(1, upcoming.size())) {
      assertThat(assignees(occurrence)).isEqualTo(before.get(occurrence));
    }

    // Regenerate the second week from scratch: Ben's skipped turn counts, so Ana is next.
    UUID second = upcoming.get(1);
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", second);
    jdbc.update("DELETE FROM chore_assignments WHERE id=?", second);
    jdbc.update(
        "DELETE FROM chore_assignment_assignees WHERE assignment_id IN "
            + "(SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for>?)",
        choreId,
        today.plusDays(7));
    jdbc.update(
        "DELETE FROM chore_assignments WHERE chore_id=? AND planned_for>?",
        choreId,
        today.plusDays(7));
    occurrenceService.generateHousehold(home.householdId());
    assertThat(assignees(occurrenceOn(choreId, today.plusDays(7)))).containsExactly(home.ana());
  }

  @Test
  void ownerCanUndoASkipWhileItsDayIsTodayOrLater() {
    LocalDate planned = today.plusDays(2);
    UUID occurrence =
        occurrenceOn(fixedChore("Sweep", yearlyOn(planned), today, home.ana()), planned);
    AssignmentResponse skipped =
        occurrenceService.skip(home.householdId(), occurrence, auth(home.owner()));
    assertThat(skipped.status()).isEqualTo("SKIPPED");
    assertThat(skipped.actions().canUnskip()).isTrue();
    assertThat(view(occurrence, home.ana()).actions().canUnskip()).isFalse();
    assertMessage(
        () -> occurrenceService.unskip(home.householdId(), occurrence, auth(home.ana())),
        "Only household owners and admins can restore a chore.");

    AssignmentResponse restored =
        occurrenceService.unskip(home.householdId(), occurrence, auth(home.owner()));
    assertThat(restored.status()).isEqualTo("PENDING");

    occurrenceService.skip(home.householdId(), occurrence, auth(home.owner()));
    jdbc.update(
        "UPDATE chore_assignments SET scheduled_for=? WHERE id=?", today.minusDays(1), occurrence);
    assertThat(view(occurrence, home.owner()).actions().canUnskip()).isFalse();
    assertMessage(
        () -> occurrenceService.unskip(home.householdId(), occurrence, auth(home.owner())),
        "This day has passed, so the skip can't be undone.");
  }

  @Test
  void skippedOccurrencesAreLeftOutOfTheWeekTotals() {
    UUID choreId = fixedChore("Wipe table", yearlyOn(today), today, home.ana());
    UUID occurrence = occurrenceOn(choreId, today);
    var before = occurrenceService.dashboard(home.householdId(), auth(home.ana())).weekSummary();
    occurrenceService.skip(home.householdId(), occurrence, auth(home.owner()));
    var after = occurrenceService.dashboard(home.householdId(), auth(home.ana())).weekSummary();
    assertThat(after.totalCount()).isEqualTo(before.totalCount() - 1);
    assertThat(after.completedCount()).isEqualTo(before.completedCount());
    // Skipped work still shows where history is shown, labelled as skipped.
    assertThat(occurrenceService.dashboard(home.householdId(), auth(home.ana())).today())
        .extracting(AssignmentResponse::status)
        .contains("SKIPPED");
    assertThat(occurrenceService.myChores(home.householdId(), "UPCOMING", auth(home.ana())))
        .extracting(AssignmentResponse::id)
        .doesNotContain(occurrence);
  }

  // ---- Reassign -------------------------------------------------------------------------------

  @Test
  void reassignAnnouncesOnlyNewPeopleAndMovesRemindersToThem() {
    LocalDate planned = today.plusDays(2);
    UUID occurrence =
        occurrenceOn(fixedChore("Scrub tub", yearlyOn(planned), today, home.ana()), planned);
    notificationScheduler.run();
    assertThat(pendingReminders(occurrence, home.ana())).isPositive();
    int anaAnnouncements = assignedNotices(occurrence, home.ana());

    assertMessage(
        () ->
            occurrenceService.reassign(
                home.householdId(),
                occurrence,
                List.of(home.ana(), home.ben()),
                auth(home.owner())),
        "Choose one person for this chore.");
    assertMessage(
        () ->
            occurrenceService.reassign(
                home.householdId(), occurrence, List.of(UUID.randomUUID()), auth(home.owner())),
        "Everyone you choose must be a current household member.");

    AssignmentResponse reassigned =
        occurrenceService.reassign(
            home.householdId(), occurrence, List.of(home.ben()), auth(home.owner()));
    assertThat(reassigned.reassigned()).isTrue();
    assertThat(reassigned.assignees()).extracting(a -> a.userId()).containsExactly(home.ben());
    assertThat(column(occurrence, "assigned_by_user_id", UUID.class)).isEqualTo(home.owner());
    assertThat(pendingReminders(occurrence, home.ana())).isZero();
    assertThat(assignedNotices(occurrence, home.ben())).isEqualTo(1);
    assertThat(assignedNotices(occurrence, home.ana())).isEqualTo(anaAnnouncements);
    assertThat(assignedNotices(occurrence, home.owner())).isZero();

    notificationScheduler.run();
    assertThat(pendingReminders(occurrence, home.ben())).isPositive();
    assertThat(pendingReminders(occurrence, home.ana())).isZero();

    // Back to Ana: she is told again (a second notice, not dropped as a duplicate).
    occurrenceService.reassign(
        home.householdId(), occurrence, List.of(home.ana()), auth(home.owner()));
    assertThat(assignedNotices(occurrence, home.ana())).isEqualTo(anaAnnouncements + 1);
    assertThat(pendingReminders(occurrence, home.ben())).isZero();
    // The owner giving the chore to themself is not told.
    occurrenceService.reassign(
        home.householdId(), occurrence, List.of(home.owner()), auth(home.owner()));
    assertThat(assignedNotices(occurrence, home.owner())).isZero();
  }

  // ---- Notifications --------------------------------------------------------------------------

  @Test
  void assigneesAreToldWhenSomeoneElseMovesOrSkipsTheirChoreButNotForTheirOwnActions() {
    LocalDate planned = today.plusDays(3);
    UUID occurrence =
        occurrenceOn(fixedChore("Kitchen clean-up", yearlyOn(planned), today, home.ana()), planned);

    move(occurrence, planned.plusDays(1), home.ana());
    assertThat(notices(occurrence, home.ana(), "CHORE_OCCURRENCE_MOVED")).isEmpty();

    move(occurrence, planned.plusDays(2), home.owner());
    List<String> moved = notices(occurrence, home.ana(), "CHORE_OCCURRENCE_MOVED");
    assertThat(moved)
        .containsExactly(
            "Kitchen clean-up moved to "
                + java.time.format.DateTimeFormatter.ofPattern(
                        "EEE, MMM d", java.util.Locale.ENGLISH)
                    .format(planned.plusDays(2)));
    move(occurrence, planned.plusDays(3), home.owner());
    assertThat(notices(occurrence, home.ana(), "CHORE_OCCURRENCE_MOVED")).hasSize(2);

    occurrenceService.skip(home.householdId(), occurrence, auth(home.owner()));
    assertThat(notices(occurrence, home.ana(), "CHORE_OCCURRENCE_SKIPPED"))
        .singleElement()
        .satisfies(
            message ->
                assertThat(message).startsWith("Kitchen clean-up on ").endsWith(" was skipped"));

    UUID ownChore =
        occurrenceOn(fixedChore("Own chore", yearlyOn(planned), today, home.owner()), planned);
    occurrenceService.skip(home.householdId(), ownChore, auth(home.owner()));
    assertThat(notices(ownChore, home.owner(), "CHORE_OCCURRENCE_SKIPPED")).isEmpty();
  }

  @Test
  void remindersFollowTheMovedDeadlineAndDeliveredOnesAreNeverSentAgain() {
    LocalDate planned = today.plusDays(3);
    UUID occurrence =
        occurrenceOn(fixedChore("Change sheets", yearlyOn(planned), today, home.ana()), planned);
    notificationScheduler.run();
    OffsetDateTime originalDue = column(occurrence, "due_at", OffsetDateTime.class);
    UUID delivered =
        jdbc.queryForObject(
            """
                SELECT id FROM notifications
                WHERE reference_id=? AND status='PENDING'
                  AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
                ORDER BY scheduled_at LIMIT 1
                """,
            UUID.class,
            occurrence);
    String deliveredKey =
        jdbc.queryForObject(
            "SELECT deduplication_key FROM notifications WHERE id=?", String.class, delivered);
    jdbc.update("UPDATE notifications SET status='SENT', sent_at=NOW() WHERE id=?", delivered);
    jdbc.update(
        "UPDATE notification_deliveries SET status='SENT', sent_at=NOW(), attempts=1 WHERE notification_id=?",
        delivered);

    move(occurrence, planned.plusDays(1), home.owner());
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications
                    WHERE reference_id=? AND status='PENDING'
                      AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
                    """,
                Integer.class,
                occurrence))
        .isZero();
    notificationScheduler.run();
    OffsetDateTime movedDue = column(occurrence, "due_at", OffsetDateTime.class);
    assertThat(pendingReminderTimes(occurrence))
        .isNotEmpty()
        .allMatch(
            time ->
                !time.isAfter(movedDue.plusDays(2))
                    && time.isAfter(originalDue.minusDays(1).plusHours(12)));

    move(occurrence, planned, home.owner());
    notificationScheduler.run();
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications
                    WHERE reference_id=? AND status<>'CANCELLED'
                      AND (deduplication_key=? OR starts_with(deduplication_key, ?))
                    """,
                Integer.class,
                occurrence,
                deliveredKey,
                deliveredKey + ":r"))
        .as("the delivered reminder is not planned a second time")
        .isEqualTo(1);
    assertThat(pendingReminders(occurrence, home.ana())).isPositive();
  }

  // ---- Series edits ---------------------------------------------------------------------------

  @Test
  void seriesEditsKeepOverridesWhosePlannedDayStaysAndCancelThoseWhoseDayIsDropped() {
    LocalDate first = today.plusDays(1);
    String rule = weeklyOn(first);
    UUID choreId = fixedChore("Hoover stairs", rule, today, home.ana());
    UUID week2 = occurrenceOn(choreId, first.plusDays(7));
    UUID week3 = occurrenceOn(choreId, first.plusDays(14));
    move(week2, first.plusDays(8), home.owner(), LocalTime.of(8, 0));
    occurrenceService.reassign(home.householdId(), week3, List.of(home.ben()), auth(home.owner()));

    // Same rule, new title and due time, and a different fixed assignee.
    update(choreId, "Hoover the stairs", rule, today, LocalTime.of(19, 0), home.owner());
    assertThat(column(week2, "scheduled_for", LocalDate.class)).isEqualTo(first.plusDays(8));
    assertThat(column(week2, "due_at", OffsetDateTime.class).toInstant())
        .isEqualTo(first.plusDays(8).atTime(8, 0).toInstant(ZoneOffset.UTC));
    assertThat(column(week2, "title_snapshot", String.class)).isEqualTo("Hoover the stairs");
    assertThat(assignees(week3)).containsExactly(home.ben());
    assertThat(column(week3, "due_at", OffsetDateTime.class).toInstant())
        .isEqualTo(first.plusDays(14).atTime(19, 0).toInstant(ZoneOffset.UTC));
    UUID week4 = occurrenceOn(choreId, first.plusDays(21));
    assertThat(assignees(week4)).containsExactly(home.owner());

    // A different weekday drops both planned days: the overridden occurrences go with them.
    update(choreId, "Hoover the stairs", weeklyOn(first.plusDays(2)), today, NOON, home.owner());
    assertThat(status(week2)).isEqualTo("CANCELLED");
    assertThat(status(week3)).isEqualTo("CANCELLED");
  }

  @Test
  void aRuleEditKeepsTheCountTotalByProducingOnlyTheRemainder() {
    LocalDate start = today.minusDays(2);
    UUID choreId = fixedChore("Course homework", "FREQ=DAILY;COUNT=5", start, home.ana());
    UUID scheduleId = scheduleOf(choreId);
    // Two days were done before today.
    completedOccurrence(choreId, scheduleId, start);
    completedOccurrence(choreId, scheduleId, start.plusDays(1));

    update(choreId, "Course homework", "FREQ=DAILY;INTERVAL=2;COUNT=5", start, NOON, home.ana());
    for (int run = 0; run < 2; run++) {
      occurrenceService.generateHousehold(home.householdId());
    }

    assertThat(liveDays(choreId))
        .containsExactly(today, today.plusDays(2), today.plusDays(4))
        .as("2 done + 3 remaining = COUNT 5; the old behaviour produced 4 more");
    assertThat(
            jdbc.queryForObject(
                "SELECT starts_on FROM chore_schedules WHERE id=?", LocalDate.class, scheduleId))
        .as("the start date, and so the interval anchoring, is unchanged")
        .isEqualTo(start);
    assertThat(
            jdbc.queryForObject(
                "SELECT recurrence_rule FROM chore_schedules WHERE id=?", String.class, scheduleId))
        .isEqualTo("FREQ=DAILY;INTERVAL=2;COUNT=5");

    // Removing COUNT clears the anchor.
    update(choreId, "Course homework", "FREQ=DAILY;INTERVAL=2", start, NOON, home.ana());
    assertThat(
            jdbc.queryForObject(
                "SELECT count_rebased_on FROM chore_schedules WHERE id=?",
                LocalDate.class,
                scheduleId))
        .isNull();
  }

  // ---- One-time chores ------------------------------------------------------------------------

  @Test
  void movingAOneTimeChoreActsLikeEditingItsDueDate() {
    LocalDate due = today.plusDays(2);
    UUID choreId = fixedChore("Return parcel", "FREQ=ONCE", due, home.ana());
    UUID occurrence = occurrenceOn(choreId, due);
    notificationScheduler.run();
    assertThat(pendingReminders(occurrence, home.ana())).isPositive();

    AssignmentResponse moved = move(occurrence, today.plusDays(4), home.owner());
    assertThat(moved.id()).isEqualTo(occurrence);
    assertThat(moved.originalDate()).isEqualTo(due);
    assertThat(
            jdbc.queryForObject(
                "SELECT starts_on FROM chore_schedules WHERE id=?",
                LocalDate.class,
                scheduleOf(choreId)))
        .isEqualTo(today.plusDays(4));
    assertThat(pendingReminderTimes(occurrence)).isEmpty();

    occurrenceService.generateHousehold(home.householdId());
    notificationScheduler.run();
    assertThat(rowCount(choreId)).isEqualTo(1);
    assertThat(column(occurrence, "scheduled_for", LocalDate.class)).isEqualTo(today.plusDays(4));
    assertThat(pendingReminders(occurrence, home.ana())).isPositive();

    // The assignee's window stays anchored on the first due date.
    assertMessage(
        () -> move(occurrence, due.plusDays(8), home.ana()),
        "You can move your chore up to 7 days before or after its original day.");
    assertThat(move(occurrence, due.plusDays(7), home.ana()).scheduledFor())
        .isEqualTo(due.plusDays(7));
    assertThat(move(occurrence, due, home.ana()).originalDate()).isNull();
  }

  @Test
  void changingAOneTimeChoresAssigneeThroughTheEditTellsTheNewPerson() {
    LocalDate due = today.plusDays(3);
    UUID choreId = fixedChore("Book plumber", "FREQ=ONCE", due, home.ana());
    UUID occurrence = occurrenceOn(choreId, due);
    notificationScheduler.run();
    assertThat(assignedNotices(occurrence, home.ben())).isZero();

    update(choreId, "Book plumber", "FREQ=ONCE", due, NOON, home.ben());

    assertThat(assignees(occurrence)).containsExactly(home.ben());
    assertThat(assignedNotices(occurrence, home.ben())).isEqualTo(1);
    assertThat(pendingReminders(occurrence, home.ana())).isZero();
  }

  // ---- Member exit ----------------------------------------------------------------------------

  @Test
  void memberExitCleansUpMovedAndReassignedOccurrences() {
    LocalDate planned = today.plusDays(5);
    UUID choreId = fixedChore("Clean windows", yearlyOn(planned), today, home.ana());
    UUID occurrence = occurrenceOn(choreId, planned);
    occurrenceService.reassign(
        home.householdId(), occurrence, List.of(home.ben()), auth(home.owner()));
    move(occurrence, planned.plusDays(2), home.owner());

    householdService.removeMember(home.householdId(), home.ben(), auth(home.owner()));

    assertThat(status(occurrence)).isEqualTo("CANCELLED");
    assertThat(column(occurrence, "cancelled_by_membership_exit", Boolean.class)).isTrue();
    occurrenceService.generateHousehold(home.householdId());
    assertThat(status(occurrence)).isEqualTo("CANCELLED");
    assertThat(rowCount(choreId)).isEqualTo(1);
  }

  // ---- helpers --------------------------------------------------------------------------------

  private AssignmentResponse move(UUID occurrence, LocalDate date, UUID actor) {
    return move(occurrence, date, actor, null);
  }

  private AssignmentResponse move(UUID occurrence, LocalDate date, UUID actor, LocalTime time) {
    return occurrenceService.move(home.householdId(), occurrence, date, time, auth(actor));
  }

  private AssignmentResponse view(UUID occurrence, UUID viewer) {
    return occurrenceService.occurrence(home.householdId(), occurrence, auth(viewer));
  }

  private UUID fixedChore(String title, String rule, LocalDate startsOn, UUID assignee) {
    return choreService
        .createChore(
            home.householdId(),
            new ChoreRequest(
                title,
                null,
                null,
                null,
                null,
                null,
                false,
                new ChoreScheduleRequest(
                    rule, null, startsOn, null, NOON, AssignmentStrategy.FIXED, assignee, null, 1)),
            auth(home.owner()))
        .id();
  }

  private UUID rotatingChore(String title, String rule, LocalDate startsOn) {
    return choreService
        .createChore(
            home.householdId(),
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
                    startsOn,
                    null,
                    NOON,
                    AssignmentStrategy.ROUND_ROBIN,
                    null,
                    List.of(home.ana(), home.ben()),
                    1)),
            auth(home.owner()))
        .id();
  }

  private void update(
      UUID choreId, String title, String rule, LocalDate startsOn, LocalTime due, UUID assignee) {
    choreService.updateChore(
        home.householdId(),
        choreId,
        new ChoreRequest(
            title,
            null,
            null,
            null,
            null,
            null,
            false,
            new ChoreScheduleRequest(
                rule, null, startsOn, null, due, AssignmentStrategy.FIXED, assignee, null, 1)),
        auth(home.owner()));
  }

  private void completedOccurrence(UUID choreId, UUID scheduleId, LocalDate day) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, schedule_id, assigned_to_user_id, scheduled_for,
                 status, title_snapshot, priority_snapshot, difficulty_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 'Course homework', 'NORMAL', 1)
            """,
        id,
        home.householdId(),
        choreId,
        scheduleId,
        home.ana(),
        day);
    jdbc.update(
        "INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id) VALUES (?, ?, ?)",
        home.householdId(),
        id,
        home.ana());
  }

  private static String yearlyOn(LocalDate day) {
    return "FREQ=YEARLY;BYMONTH=%d;BYMONTHDAY=%d"
        .formatted(day.getMonthValue(), day.getDayOfMonth());
  }

  private static String weeklyOn(LocalDate day) {
    DayOfWeek weekday = day.getDayOfWeek();
    return "FREQ=WEEKLY;BYDAY=" + weekday.name().substring(0, 2);
  }

  private UUID occurrenceOn(UUID choreId, LocalDate planned) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND planned_for=?",
        UUID.class,
        choreId,
        planned);
  }

  private List<UUID> occurrencesOf(UUID choreId) {
    return jdbc.queryForList(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND status='PENDING' ORDER BY planned_for",
        UUID.class,
        choreId);
  }

  private List<LocalDate> liveDays(UUID choreId) {
    return jdbc.queryForList(
        """
            SELECT planned_for FROM chore_assignments
            WHERE chore_id=? AND status IN ('PENDING','SUBMITTED') ORDER BY planned_for
            """,
        LocalDate.class,
        choreId);
  }

  private UUID scheduleOf(UUID choreId) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_schedules WHERE chore_id=?", UUID.class, choreId);
  }

  private int rowCount(UUID choreId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=?", Integer.class, choreId);
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

  private Map<UUID, List<UUID>> assigneesByOccurrence(List<UUID> occurrences) {
    Map<UUID, List<UUID>> result = new java.util.HashMap<>();
    occurrences.forEach(occurrence -> result.put(occurrence, assignees(occurrence)));
    return result;
  }

  private int pendingReminders(UUID occurrence, UUID recipient) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND recipient_user_id=?
              AND status='PENDING' AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        Integer.class,
        occurrence,
        recipient);
  }

  private List<OffsetDateTime> pendingReminderTimes(UUID occurrence) {
    return jdbc.queryForList(
        """
            SELECT scheduled_at FROM notifications
            WHERE reference_id=? AND status='PENDING'
              AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        OffsetDateTime.class,
        occurrence);
  }

  private int assignedNotices(UUID occurrence, UUID recipient) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND recipient_user_id=?
              AND type='CHORE_ASSIGNED'
            """,
        Integer.class,
        occurrence,
        recipient);
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

  private static void assertMessage(Runnable action, String message) {
    assertThatThrownBy(action::run)
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage(message);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', ?)",
        id,
        "actions-" + label + "-" + id + "@example.test",
        "Actions " + label);
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
