package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class RecurringChoreAssignmentAnnouncementIntegrationTest {

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreScheduleRepository scheduleRepository;
  @Autowired private UserRepository userRepository;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private ChoreService choreService;
  @Autowired private HouseholdSettingsService householdSettingsService;
  @Autowired private NotificationEventService notificationEventService;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private PlatformTransactionManager transactionManager;
  @Autowired private MembershipExitCleanupService membershipExitCleanupService;

  private UUID householdId;
  private final List<UUID> userIds = new java.util.ArrayList<>();

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
    for (UUID userId : userIds) {
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    userIds.clear();
    householdId = null;
  }

  @Test
  void recurringAnnouncementsAreDurablePerScheduleAndOneTimeChoresRemainUnchanged() {
    UUID firstUser = createUser("first");
    UUID secondUser = createUser("second");
    UUID newlyAddedUser = createUser("added");
    householdId = createHousehold(firstUser);
    addMember(secondUser);
    addMember(newlyAddedUser);

    UUID recurringChoreId = createChore(firstUser, "Recurring chore");
    UUID recurringScheduleId =
        createSchedule(
            recurringChoreId, "FREQ=DAILY", "ROUND_ROBIN", List.of(firstUser, secondUser));
    ChoreSchedule recurringSchedule = loadSchedule(recurringChoreId);

    synchronizeSchedule(recurringSchedule.getId());
    assertThat(announcementCount(recurringScheduleId)).isEqualTo(2);
    assertThat(notificationCount(recurringScheduleId, firstUser)).isEqualTo(1);
    assertThat(notificationCount(recurringScheduleId, secondUser)).isEqualTo(1);

    synchronizeSchedule(recurringSchedule.getId());
    assertThat(announcementCount(recurringScheduleId)).isEqualTo(2);

    Map<String, Object> config = new HashMap<>(recurringSchedule.getStrategyConfig());
    config.put(
        "participantUserIds",
        List.of(firstUser.toString(), secondUser.toString(), newlyAddedUser.toString()));
    recurringSchedule.setStrategyConfig(config);
    scheduleRepository.saveAndFlush(recurringSchedule);
    synchronizeSchedule(recurringSchedule.getId(), true);

    assertThat(announcementCount(recurringScheduleId)).isEqualTo(3);
    assertThat(notificationCount(recurringScheduleId, newlyAddedUser)).isEqualTo(1);

    config = new HashMap<>(recurringSchedule.getStrategyConfig());
    config.put("participantUserIds", List.of(firstUser.toString(), newlyAddedUser.toString()));
    recurringSchedule.setStrategyConfig(config);
    scheduleRepository.saveAndFlush(recurringSchedule);
    synchronizeSchedule(recurringSchedule.getId(), true);
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*)
                    FROM chore_assignment_assignees aa
                    JOIN chore_assignments a ON a.id=aa.assignment_id
                    WHERE a.schedule_id=? AND a.status IN ('PENDING','SUBMITTED')
                      AND a.scheduled_for>=CURRENT_DATE AND aa.user_id=?
                    """,
                Integer.class,
                recurringScheduleId,
                secondUser))
        .isZero();
    assertThat(announcementCount(recurringScheduleId)).isEqualTo(3);

    config = new HashMap<>(recurringSchedule.getStrategyConfig());
    config.put(
        "participantUserIds",
        List.of(firstUser.toString(), secondUser.toString(), newlyAddedUser.toString()));
    recurringSchedule.setStrategyConfig(config);
    scheduleRepository.saveAndFlush(recurringSchedule);
    synchronizeSchedule(recurringSchedule.getId(), true);
    assertThat(announcementCount(recurringScheduleId)).isEqualTo(3);
    assertThat(notificationCount(recurringScheduleId, secondUser)).isEqualTo(1);

    UUID oneTimeChoreId = createChore(firstUser, "One-time chore");
    UUID oneTimeScheduleId =
        createSchedule(oneTimeChoreId, "FREQ=ONCE", "FIXED", List.of(firstUser));
    synchronizeScheduleForChore(oneTimeChoreId);
    assertThat(announcementCount(oneTimeScheduleId)).isEqualTo(1);
    assertThat(notificationTitle(oneTimeScheduleId, firstUser)).isEqualTo("Chore assigned");
    assertThat(notificationMessage(oneTimeScheduleId, firstUser))
        .isEqualTo("You have been assigned One-time chore");
    UUID oneTimeAssignmentId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=?", UUID.class, oneTimeScheduleId);
    assertThat(notificationAssignmentReferenceType(oneTimeScheduleId, firstUser))
        .isEqualTo("CHORE_ASSIGNMENT");
    assertThat(notificationAssignmentReferenceId(oneTimeScheduleId, firstUser))
        .isEqualTo(oneTimeAssignmentId);
    synchronizeScheduleForChore(oneTimeChoreId);
    assertThat(announcementCount(oneTimeScheduleId)).isEqualTo(1);
  }

  @Test
  void overdueOneTimeAssignmentIsRescheduledWithoutCreatingAnotherActiveAssignment() {
    UUID userId = createUser("reschedule");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Overdue one-time chore");
    UUID scheduleId = createSchedule(choreId, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    LocalDate previousDate = today.minusDays(1);
    LocalTime dueTime = LocalTime.of(23, 35);
    schedule.setStartsOn(previousDate);
    schedule.setDueTime(dueTime);
    scheduleRepository.saveAndFlush(schedule);
    UUID assignmentId =
        createAssignment(
            scheduleId,
            choreId,
            previousDate,
            previousDate.atTime(dueTime).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);

    schedule.setStartsOn(today);
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(scheduleId);

    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT id FROM chore_assignments WHERE schedule_id=? AND status='PENDING'",
                UUID.class,
                scheduleId))
        .isEqualTo(assignmentId);
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                assignmentId))
        .isEqualTo(today);
    assertThat(
            jdbc.queryForObject(
                "SELECT due_at FROM chore_assignments WHERE id=?",
                OffsetDateTime.class,
                assignmentId))
        .isEqualTo(today.atTime(dueTime).atOffset(ZoneOffset.UTC));
    assertThat(
            jdbc.queryForObject(
                "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=?",
                UUID.class,
                assignmentId))
        .isEqualTo(userId);
    assertThat(announcementCount(scheduleId)).isZero();
    synchronizeSchedule(scheduleId);
    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThat(occurrenceCount(scheduleId)).isEqualTo(1);
    assertThat(announcementCount(scheduleId)).isZero();
  }

  @Test
  void oneTimeTimeChangeKeepsAssignmentAndCancelsObsoleteReminders() {
    UUID userId = createUser("time-change");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "One-time time change");
    UUID scheduleId = createSchedule(choreId, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    ZoneId zone = ZoneId.of("America/Los_Angeles");
    LocalDate scheduledFor = LocalDate.now(zone);
    LocalTime originalTime = LocalTime.of(20, 0);
    schedule.setTimezone(zone.getId());
    schedule.setStartsOn(scheduledFor);
    schedule.setDueTime(originalTime);
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(scheduleId);
    UUID assignmentId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=?", UUID.class, scheduleId);
    publishReminderEvent(assignmentId, userId, "CHORE_DUE_SOON", "CHORE_REMINDER");
    UUID reminderId =
        jdbc.queryForObject(
            "SELECT id FROM notifications WHERE reference_id=? AND type='CHORE_DUE_SOON'",
            UUID.class,
            assignmentId);
    markNotificationPending(reminderId);

    LocalTime updatedTime = LocalTime.of(21, 15);
    schedule.setDueTime(updatedTime);
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(scheduleId);

    assertThat(
            jdbc.queryForObject(
                "SELECT id FROM chore_assignments WHERE schedule_id=? AND status='PENDING'",
                UUID.class,
                scheduleId))
        .isEqualTo(assignmentId);
    assertThat(
            jdbc.queryForObject(
                "SELECT due_at FROM chore_assignments WHERE id=?",
                OffsetDateTime.class,
                assignmentId))
        .isEqualTo(OccurrenceService.dueAt(scheduledFor, updatedTime, zone));
    assertThat(notificationStatus(reminderId)).isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM notification_deliveries WHERE notification_id=? AND channel='IN_APP'",
                String.class,
                reminderId))
        .isEqualTo("CANCELLED");
    assertThat(announcementCount(scheduleId)).isEqualTo(1);
    synchronizeSchedule(scheduleId);
    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThat(announcementCount(scheduleId)).isEqualTo(1);
  }

  @Test
  void oneTimeDestinationCollisionKeepsDestinationAndCancelsObsoletePendingOccurrence() {
    UUID userId = createUser("destination");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Destination collision");
    UUID scheduleId = createSchedule(choreId, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    LocalDate targetDate = LocalDate.now(ZoneOffset.UTC);
    LocalDate previousDate = targetDate.minusDays(1);
    schedule.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(schedule);
    UUID previousAssignment =
        createAssignment(
            scheduleId,
            choreId,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);
    UUID targetAssignment =
        createAssignment(
            scheduleId,
            choreId,
            targetDate,
            targetDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);
    publishReminderEvent(previousAssignment, userId, "CHORE_ASSIGNED", "CHORE_REMINDER");
    UUID obsoleteAssignmentNotice =
        jdbc.queryForObject(
            "SELECT id FROM notifications WHERE reference_id=? AND type='CHORE_ASSIGNED'",
            UUID.class,
            previousAssignment);
    markNotificationPending(obsoleteAssignmentNotice);

    schedule.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(scheduleId);

    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                previousAssignment))
        .isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?", String.class, targetAssignment))
        .isEqualTo("PENDING");
    assertThat(notificationStatus(obsoleteAssignmentNotice)).isEqualTo("CANCELLED");
    assertThat(announcementCount(scheduleId)).isEqualTo(1);
    synchronizeSchedule(scheduleId);
    assertThat(occurrenceCount(scheduleId)).isEqualTo(2);
    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThat(announcementCount(scheduleId)).isEqualTo(1);
  }

  @Test
  void dashboardSyncAndScheduleEditPreservePendingWorkAtCancelledDestination() {
    UUID userId = createUser("cancelled-destination");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Cancelled destination");
    UUID scheduleId = createSchedule(choreId, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    LocalDate targetDate = LocalDate.now(ZoneOffset.UTC);
    LocalDate previousDate = targetDate.minusDays(1);
    schedule.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(schedule);
    UUID pendingAssignment =
        createAssignment(
            scheduleId,
            choreId,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);
    UUID cancelledAssignment =
        createAssignment(
            scheduleId,
            choreId,
            targetDate,
            targetDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "CANCELLED",
            userId);
    schedule.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(schedule);

    generateHousehold();

    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThatThrownBy(() -> synchronizeSchedule(scheduleId, false, true))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessageContaining("cancelled assignment");
    generateHousehold();

    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?", String.class, pendingAssignment))
        .isEqualTo("PENDING");
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                pendingAssignment))
        .isEqualTo(previousDate);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                cancelledAssignment))
        .isEqualTo("CANCELLED");
    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
  }

  @Test
  void dashboardSyncAndScheduleEditPreserveMultipleSubmittedAssignments() {
    UUID userId = createUser("multiple-submitted");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Multiple submitted assignments");
    UUID scheduleId = createSchedule(choreId, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    LocalDate targetDate = LocalDate.now(ZoneOffset.UTC);
    LocalDate previousDate = targetDate.minusDays(1);
    schedule.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(schedule);
    UUID submittedAssignment =
        createAssignment(
            scheduleId,
            choreId,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "SUBMITTED",
            userId);
    UUID targetSubmittedAssignment =
        createAssignment(
            scheduleId,
            choreId,
            targetDate,
            targetDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "SUBMITTED",
            userId);
    schedule.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(schedule);

    generateHousehold();

    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(2);
    assertThatThrownBy(() -> synchronizeSchedule(scheduleId, false, true))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessageContaining("multiple submitted assignments");
    generateHousehold();

    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                submittedAssignment))
        .isEqualTo(previousDate);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                submittedAssignment))
        .isEqualTo("SUBMITTED");
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                targetSubmittedAssignment))
        .isEqualTo(targetDate);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                targetSubmittedAssignment))
        .isEqualTo("SUBMITTED");
  }

  @Test
  void oneTimeScheduleWithMultipleStalePendingAssignmentsIsReconciledIdempotently() {
    UUID userId = createUser("multiple-stale");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Multiple stale assignments");
    UUID scheduleId = createSchedule(choreId, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    LocalDate targetDate = LocalDate.now(ZoneOffset.UTC);
    LocalDate yesterday = targetDate.minusDays(1);
    LocalDate twoDaysAgo = targetDate.minusDays(2);
    schedule.setStartsOn(twoDaysAgo);
    scheduleRepository.saveAndFlush(schedule);
    UUID olderAssignment =
        createAssignment(
            scheduleId,
            choreId,
            twoDaysAgo,
            twoDaysAgo.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);
    UUID newerAssignment =
        createAssignment(
            scheduleId,
            choreId,
            yesterday,
            yesterday.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);

    schedule.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(scheduleId);

    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?", String.class, olderAssignment))
        .isEqualTo("PENDING");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?", String.class, newerAssignment))
        .isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                olderAssignment))
        .isEqualTo(targetDate);
    assertThat(occurrenceCount(scheduleId)).isEqualTo(2);
    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
    assertThat(announcementCount(scheduleId)).isZero();
    synchronizeSchedule(scheduleId);
    assertThat(occurrenceCount(scheduleId)).isEqualTo(2);
    assertThat(activeAssignmentCount(scheduleId)).isEqualTo(1);
  }

  @Test
  void oneTimeScheduleDoesNotReopenSubmittedCompletedOrCancelledAssignments() {
    UUID userId = createUser("terminal-state");
    householdId = createHousehold(userId);
    LocalDate targetDate = LocalDate.now(ZoneOffset.UTC);
    LocalDate previousDate = targetDate.minusDays(1);

    UUID submittedChore = createChore(userId, "Submitted work");
    UUID submittedSchedule = createSchedule(submittedChore, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule submittedScheduleEntity = loadSchedule(submittedChore);
    submittedScheduleEntity.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(submittedScheduleEntity);
    UUID submittedAssignment =
        createAssignment(
            submittedSchedule,
            submittedChore,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "SUBMITTED",
            userId);
    submittedScheduleEntity.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(submittedScheduleEntity);
    synchronizeSchedule(submittedSchedule);

    assertThat(occurrenceCount(submittedSchedule)).isEqualTo(1);
    assertThat(activeAssignmentCount(submittedSchedule)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                submittedAssignment))
        .isEqualTo("SUBMITTED");
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                submittedAssignment))
        .isEqualTo(previousDate);

    UUID completedChore = createChore(userId, "Completed work");
    UUID completedSchedule = createSchedule(completedChore, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule completedScheduleEntity = loadSchedule(completedChore);
    completedScheduleEntity.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(completedScheduleEntity);
    UUID completedAssignment =
        createAssignment(
            completedSchedule,
            completedChore,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "COMPLETED",
            userId);
    completedScheduleEntity.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(completedScheduleEntity);
    synchronizeSchedule(completedSchedule);

    assertThat(occurrenceCount(completedSchedule)).isEqualTo(1);
    assertThat(activeAssignmentCount(completedSchedule)).isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                completedAssignment))
        .isEqualTo("COMPLETED");

    UUID cancelledChore = createChore(userId, "Cancelled work");
    UUID cancelledSchedule = createSchedule(cancelledChore, "FREQ=ONCE", "FIXED", List.of(userId));
    ChoreSchedule cancelledScheduleEntity = loadSchedule(cancelledChore);
    cancelledScheduleEntity.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(cancelledScheduleEntity);
    UUID pendingAssignment =
        createAssignment(
            cancelledSchedule,
            cancelledChore,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);
    UUID cancelledAssignment =
        createAssignment(
            cancelledSchedule,
            cancelledChore,
            targetDate,
            targetDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "CANCELLED",
            userId);
    cancelledScheduleEntity.setStartsOn(targetDate);
    scheduleRepository.saveAndFlush(cancelledScheduleEntity);
    synchronizeSchedule(cancelledSchedule);

    assertThat(activeAssignmentCount(cancelledSchedule)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?", String.class, pendingAssignment))
        .isEqualTo("PENDING");
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_for FROM chore_assignments WHERE id=?",
                LocalDate.class,
                pendingAssignment))
        .isEqualTo(previousDate);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                cancelledAssignment))
        .isEqualTo("CANCELLED");
  }

  @Test
  void recurringScheduleSynchronizationPreservesHistoricalOverdueOccurrences() {
    UUID userId = createUser("recurring-history");
    householdId = createHousehold(userId);
    LocalDate previousDate = LocalDate.now(ZoneOffset.UTC).minusDays(1);
    String byDay = previousDate.getDayOfWeek().name().substring(0, 2);

    for (String recurrenceRule :
        List.of(
            "FREQ=DAILY", "FREQ=WEEKLY;BYDAY=" + byDay, "FREQ=WEEKLY;INTERVAL=2;BYDAY=" + byDay)) {
      UUID choreId = createChore(userId, recurrenceRule + " obligation");
      UUID scheduleId = createSchedule(choreId, recurrenceRule, "FIXED", List.of(userId));
      ChoreSchedule schedule = loadSchedule(choreId);
      schedule.setStartsOn(previousDate);
      schedule.setDueTime(LocalTime.of(23, 35));
      scheduleRepository.saveAndFlush(schedule);
      UUID overdueAssignment =
          createAssignment(
              scheduleId,
              choreId,
              previousDate,
              previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
              "PENDING",
              userId);

      synchronizeSchedule(scheduleId);

      assertThat(
              jdbc.queryForObject(
                  "SELECT status FROM chore_assignments WHERE id=?",
                  String.class,
                  overdueAssignment))
          .as(recurrenceRule)
          .isEqualTo("PENDING");
      assertThat(activeAssignmentCount(scheduleId)).as(recurrenceRule).isGreaterThan(1);
    }
  }

  @Test
  void recurringToOneTimeConversionWithoutLedgerIsRejectedAndHistoryRemainsSafe() {
    UUID userId = createUser("frequency-change");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Converted schedule");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(userId));
    ChoreSchedule schedule = loadSchedule(choreId);
    LocalDate previousDate = LocalDate.now(ZoneOffset.UTC).minusDays(1);
    schedule.setStartsOn(previousDate);
    scheduleRepository.saveAndFlush(schedule);
    UUID historicalAssignment =
        createAssignment(
            scheduleId,
            choreId,
            previousDate,
            previousDate.atTime(23, 35).atOffset(ZoneOffset.UTC),
            "PENDING",
            userId);
    assertThatThrownBy(
            () ->
                occurrenceService.validateScheduleFrequencyChange(
                    schedule, "FREQ=DAILY", "FREQ=ONCE"))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessageContaining("cannot be converted to one-time");

    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                historicalAssignment))
        .isEqualTo("PENDING");
    assertThat(schedule.getRecurrenceRule()).isEqualTo("FREQ=DAILY");
    generateHousehold();
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                historicalAssignment))
        .isEqualTo("PENDING");
    generateHousehold();
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                historicalAssignment))
        .isEqualTo("PENDING");
  }

  @Test
  void previouslyAnnouncedRecurringParticipantsAreNotAnnouncedAgain() {
    UUID userId = createUser("existing");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Existing schedule");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(userId));
    jdbc.update(
        """
            INSERT INTO recurring_chore_assignment_announcements (schedule_id, user_id)
            VALUES (?, ?)
            """,
        scheduleId,
        userId);

    synchronizeScheduleForChore(choreId);

    assertThat(announcementCount(scheduleId)).isZero();
  }

  @Test
  void everyRecurringAssignmentStrategyAnnouncesEachParticipantOnce() {
    UUID firstUser = createUser("strategy-first");
    UUID secondUser = createUser("strategy-second");
    householdId = createHousehold(firstUser);
    addMember(secondUser);

    for (String strategy : List.of("FIXED", "ROUND_ROBIN", "RANDOM")) {
      UUID choreId = createChore(firstUser, strategy + " recurring chore");
      UUID scheduleId =
          createSchedule(choreId, "FREQ=DAILY", strategy, List.of(firstUser, secondUser), 2);
      ChoreSchedule schedule = loadSchedule(choreId);

      synchronizeSchedule(schedule.getId());

      assertThat(announcementCount(scheduleId)).as(strategy).isEqualTo(2);
      assertThat(notificationCount(scheduleId, firstUser)).as(strategy).isEqualTo(1);
      assertThat(notificationCount(scheduleId, secondUser)).as(strategy).isEqualTo(1);
      assertThat(occurrenceCount(scheduleId)).as(strategy).isGreaterThan(2);
      assertThat(notificationTitle(scheduleId, firstUser))
          .as(strategy)
          .isEqualTo(
              "FIXED".equals(strategy)
                  ? "New daily chore assigned"
                  : "New rotating chore assigned");
      assertThat(notificationMessage(scheduleId, firstUser))
          .as(strategy)
          .contains(
              "FIXED".equals(strategy)
                  ? "has been added to your recurring chores"
                  : "has been added to your rotating chores. We'll remind you when it's your turn.");

      synchronizeSchedule(schedule.getId());
      assertThat(announcementCount(scheduleId)).as(strategy).isEqualTo(2);
    }
  }

  @Test
  void randomAnnouncementsIncludeParticipantsNotSelectedInTheOccurrenceHorizon() {
    UUID firstUser = createUser("random-first");
    UUID secondUser = createUser("random-second");
    UUID thirdUser = createUser("random-third");
    householdId = createHousehold(firstUser);
    addMember(secondUser);
    addMember(thirdUser);

    UUID choreId = createChore(firstUser, "Random recurring chore");
    UUID scheduleId =
        createSchedule(choreId, "FREQ=DAILY", "RANDOM", List.of(firstUser, secondUser, thirdUser));
    ChoreSchedule schedule = loadSchedule(choreId);
    schedule.setEndsOn(LocalDate.now(ZoneOffset.UTC));
    scheduleRepository.saveAndFlush(schedule);

    synchronizeSchedule(schedule.getId());

    assertThat(occurrenceCount(scheduleId)).isEqualTo(1);
    assertThat(announcementCount(scheduleId)).isEqualTo(3);
    assertThat(notificationCount(scheduleId, firstUser)).isEqualTo(1);
    assertThat(notificationCount(scheduleId, secondUser)).isEqualTo(1);
    assertThat(notificationCount(scheduleId, thirdUser)).isEqualTo(1);
    assertThat(notificationMessage(scheduleId, firstUser))
        .isEqualTo(
            "Random recurring chore has been added to your rotating chores. We'll remind you when it's your turn.");
    assertThat(notificationReferenceType(scheduleId, firstUser)).isEqualTo("CHORE_SCHEDULE");
    assertThat(notificationReferenceId(scheduleId, firstUser)).isEqualTo(scheduleId);
  }

  @Test
  void fixedAnnouncementsUseCadenceAndNeutralIntervalTitles() {
    UUID userId = createUser("cadence");
    householdId = createHousehold(userId);

    UUID dailyChoreId = createChore(userId, "Daily chore");
    UUID dailyScheduleId = createSchedule(dailyChoreId, "FREQ=DAILY", "FIXED", List.of(userId));
    synchronizeScheduleForChore(dailyChoreId);
    assertThat(notificationTitle(dailyScheduleId, userId)).isEqualTo("New daily chore assigned");
    assertThat(notificationMessage(dailyScheduleId, userId)).contains("Daily chore");

    UUID weeklyChoreId = createChore(userId, "Weekly chore");
    UUID weeklyScheduleId =
        createSchedule(weeklyChoreId, "FREQ=WEEKLY;BYDAY=MO", "FIXED", List.of(userId));
    synchronizeScheduleForChore(weeklyChoreId);
    assertThat(notificationTitle(weeklyScheduleId, userId)).isEqualTo("New weekly chore assigned");

    UUID biweeklyChoreId = createChore(userId, "Biweekly chore");
    UUID biweeklyScheduleId =
        createSchedule(
            biweeklyChoreId, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "FIXED", List.of(userId));
    synchronizeScheduleForChore(biweeklyChoreId);
    assertThat(notificationTitle(biweeklyScheduleId, userId))
        .isEqualTo("New recurring chore assigned");
  }

  @Test
  void scheduleBeyondGenerationHorizonIsAnnouncedWithoutCreatingAssignments() {
    UUID firstUser = createUser("future-first");
    UUID secondUser = createUser("future-second");
    householdId = createHousehold(firstUser);
    addMember(secondUser);
    UUID choreId = createChore(firstUser, "Future rotation");
    UUID scheduleId =
        createSchedule(choreId, "FREQ=DAILY", "RANDOM", List.of(firstUser, secondUser));
    ChoreSchedule schedule = loadSchedule(choreId);
    schedule.setStartsOn(LocalDate.now(ZoneOffset.UTC).plusDays(45));
    scheduleRepository.saveAndFlush(schedule);

    synchronizeSchedule(schedule.getId());

    assertThat(occurrenceCount(scheduleId)).isZero();
    assertThat(announcementCount(scheduleId)).isEqualTo(2);
    assertThat(notificationReferenceType(scheduleId, firstUser)).isEqualTo("CHORE_SCHEDULE");
    assertThat(notificationReferenceId(scheduleId, firstUser)).isEqualTo(scheduleId);
  }

  @Test
  void completingAnOccurrenceDoesNotCancelItsPendingScheduleAnnouncement() {
    UUID userId = createUser("completion");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Completing chore");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(userId));
    synchronizeScheduleForChore(choreId);

    UUID assignmentId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=? ORDER BY scheduled_for LIMIT 1",
            UUID.class,
            scheduleId);
    UUID notificationId = notificationId(scheduleId, userId);
    jdbc.update(
        "UPDATE notifications SET status='PENDING', scheduled_at=? WHERE id=?",
        OffsetDateTime.now(ZoneOffset.UTC).plusHours(1),
        notificationId);
    jdbc.update(
        "UPDATE notification_deliveries SET status='PENDING', sent_at=NULL WHERE notification_id=?",
        notificationId);
    jdbc.update("UPDATE chore_assignments SET status='COMPLETED' WHERE id=?", assignmentId);

    notificationScheduler.run();

    assertThat(notificationStatus(notificationId)).isEqualTo("PENDING");
  }

  @Test
  void schedulerCancelsHouseholdNotificationsForInactiveRecipientsAndTheirRetries() {
    UUID recipientId = createUser("inactive-recipient");
    householdId = createHousehold(recipientId);
    UUID eventId = UUID.randomUUID();
    UUID notificationId = UUID.randomUUID();
    String deduplicationKey = "inactive-recipient-" + UUID.randomUUID();
    jdbc.update(
        """
        INSERT INTO notification_events
            (id, event_type, household_id, reference_type, reference_id, title, message,
             category, processed_at)
        VALUES (?, 'HOUSEHOLD_UPDATE', ?, 'HOUSEHOLD', ?, 'Update', 'Message',
                'HOUSEHOLD_UPDATE', NOW())
        """,
        eventId,
        householdId,
        householdId);
    jdbc.update(
        """
        INSERT INTO notifications
            (id, recipient_user_id, event_id, type, category, title, message, status,
             scheduled_at, deduplication_key, reference_type, reference_id)
        VALUES (?, ?, ?, 'HOUSEHOLD_UPDATE', 'HOUSEHOLD_UPDATE', 'Update', 'Message',
                'PENDING', NOW() - INTERVAL '1 minute', ?, 'HOUSEHOLD', ?)
        """,
        notificationId,
        recipientId,
        eventId,
        deduplicationKey,
        householdId);
    jdbc.update(
        """
        INSERT INTO notification_deliveries (notification_id, channel, status, attempts)
        VALUES (?, 'IN_APP', 'PENDING', 0), (?, 'WEB_PUSH', 'FAILED', 1)
        """,
        notificationId,
        notificationId);
    jdbc.update(
        "UPDATE household_memberships SET status='LEFT' WHERE household_id=? AND user_id=?",
        householdId,
        recipientId);

    notificationScheduler.run();

    assertThat(notificationStatus(notificationId)).isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForList(
                "SELECT status FROM notification_deliveries WHERE notification_id=?",
                String.class,
                notificationId))
        .containsOnly("CANCELLED");
  }

  @Test
  void membershipExitWaitsForScheduleSynchronizationAndCleansItsPendingAssignment()
      throws Exception {
    UUID ownerId = createUser("exit-lock-owner");
    UUID departingUserId = createUser("exit-lock-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    UUID choreId = createChore(ownerId, "Exit lock chore");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(departingUserId));
    synchronizeSchedule(scheduleId);
    UUID assignmentId =
        jdbc.queryForObject(
            """
            SELECT id FROM chore_assignments
            WHERE schedule_id=? AND status='PENDING' AND assigned_to_user_id=?
            ORDER BY scheduled_for LIMIT 1
            """,
            UUID.class,
            scheduleId,
            departingUserId);

    CountDownLatch scheduleLocked = new CountDownLatch(1);
    CountDownLatch releaseSynchronization = new CountDownLatch(1);
    CountDownLatch exitStarted = new CountDownLatch(1);
    AtomicInteger exitBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> synchronization =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            jdbc.queryForObject(
                                "SELECT id FROM households WHERE id=? FOR UPDATE",
                                UUID.class,
                                householdId);
                            jdbc.queryForObject(
                                "SELECT id FROM chore_schedules WHERE id=? FOR UPDATE",
                                UUID.class,
                                scheduleId);
                            scheduleLocked.countDown();
                            try {
                              if (!releaseSynchronization.await(10, TimeUnit.SECONDS)) {
                                throw new IllegalStateException(
                                    "Timed out waiting to release schedule synchronization.");
                              }
                            } catch (InterruptedException exception) {
                              Thread.currentThread().interrupt();
                              throw new IllegalStateException(
                                  "Schedule synchronization was interrupted.", exception);
                            }
                            occurrenceService.synchronizeSchedule(
                                scheduleRepository.findById(scheduleId).orElseThrow());
                          }));
      assertThat(scheduleLocked.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            exitStarted.countDown();
                            householdSettingsService.leave(
                                householdId, null, authentication(departingUserId));
                          }));
      assertThat(exitStarted.await(5, TimeUnit.SECONDS)).isTrue();

      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      boolean blockedByScheduleLock = false;
      while (System.nanoTime() < deadline) {
        blockedByScheduleLock =
            Boolean.TRUE.equals(
                jdbc.queryForObject(
                    "SELECT cardinality(pg_blocking_pids(?)) > 0",
                    Boolean.class,
                    exitBackendPid.get()));
        if (blockedByScheduleLock) break;
        Thread.sleep(20);
      }
      assertThat(blockedByScheduleLock).isTrue();

      releaseSynchronization.countDown();
      synchronization.get(10, TimeUnit.SECONDS);
      exit.get(10, TimeUnit.SECONDS);
    } finally {
      releaseSynchronization.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?", String.class, assignmentId))
        .isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT assigned_to_user_id FROM chore_assignments WHERE id=?",
                UUID.class,
                assignmentId))
        .isNull();
  }

  @Test
  void ordinaryGenerationDoesNotReopenExitCancelledRecurringAssignments() {
    UUID ownerId = createUser("exit-generation-owner");
    UUID departingUserId = createUser("exit-generation-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    UUID choreId = createChore(ownerId, "Exit generation chore");
    UUID scheduleId =
        createSchedule(choreId, "FREQ=DAILY", "ROUND_ROBIN", List.of(ownerId, departingUserId), 1);
    synchronizeSchedule(scheduleId);

    LocalDate targetDate = LocalDate.now(ZoneOffset.UTC).plusDays(2);
    LocalDate unaffectedDate = targetDate.plusDays(1);
    UUID exitCancelledId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=? AND scheduled_for=?",
            UUID.class,
            scheduleId,
            targetDate);
    UUID unaffectedId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=? AND scheduled_for=?",
            UUID.class,
            scheduleId,
            unaffectedDate);
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", exitCancelledId);
    jdbc.update(
        "UPDATE chore_assignments SET assigned_to_user_id=? WHERE id=?",
        departingUserId,
        exitCancelledId);
    jdbc.update(
        "INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id) VALUES (?, ?, ?)",
        householdId,
        exitCancelledId,
        departingUserId);
    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", unaffectedId);
    jdbc.update(
        "UPDATE chore_assignments SET assigned_to_user_id=? WHERE id=?", ownerId, unaffectedId);
    jdbc.update(
        "INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id) VALUES (?, ?, ?)",
        householdId,
        unaffectedId,
        ownerId);

    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            status -> {
              jdbc.update(
                  "UPDATE household_memberships SET status='LEFT', left_at=NOW() "
                      + "WHERE household_id=? AND user_id=?",
                  householdId,
                  departingUserId);
              membershipExitCleanupService.cleanupMembershipExit(householdId, departingUserId);
            });

    for (int attempt = 0; attempt < 3; attempt++) {
      generateHousehold();
    }

    assertThat(assignmentStatus(exitCancelledId)).isEqualTo("CANCELLED");
    assertThat(assignmentPrimaryAssignee(exitCancelledId)).isNull();
    assertThat(normalizedAssignees(exitCancelledId)).isEmpty();
    assertThat(assignmentStatus(unaffectedId)).isEqualTo("PENDING");
    assertThat(assignmentPrimaryAssignee(unaffectedId)).isEqualTo(ownerId);
    assertThat(normalizedAssignees(unaffectedId)).containsExactly(ownerId);
    assertThat(activeAssignmentCount(scheduleId)).isGreaterThan(0);

    choreService.updateChore(
        householdId,
        choreId,
        choreRequest("Exit generation chore", singleParticipantScheduleRequest(ownerId)),
        authentication(ownerId));
    assertThat(assignmentStatus(exitCancelledId)).isEqualTo("PENDING");
    assertThat(assignmentPrimaryAssignee(exitCancelledId)).isEqualTo(ownerId);
    assertThat(normalizedAssignees(exitCancelledId)).containsExactly(ownerId);
  }

  @Test
  void scheduleSynchronizationThatFinishesBeforeExitIsReconciledByExit() throws Exception {
    UUID ownerId = createUser("sync-first-owner");
    UUID departingUserId = createUser("sync-first-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    UUID choreId = createChore(ownerId, "Sync first chore");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(departingUserId));
    jdbc.update(
        "UPDATE chore_schedules SET starts_on=? WHERE id=?",
        LocalDate.now(ZoneOffset.UTC).plusDays(2),
        scheduleId);

    CountDownLatch synchronizedSchedule = new CountDownLatch(1);
    CountDownLatch allowSyncCommit = new CountDownLatch(1);
    CountDownLatch exitStarted = new CountDownLatch(1);
    AtomicInteger syncBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> synchronization =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            syncBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            ChoreSchedule schedule =
                                scheduleRepository.findById(scheduleId).orElseThrow();
                            occurrenceService.synchronizeSchedule(schedule);
                            synchronizedSchedule.countDown();
                            awaitLatch(allowSyncCommit, "sync commit");
                          }));
      assertThat(synchronizedSchedule.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitStarted.countDown();
                            jdbc.update(
                                "UPDATE household_memberships SET status='LEFT', left_at=NOW() "
                                    + "WHERE household_id=? AND user_id=?",
                                householdId,
                                departingUserId);
                            membershipExitCleanupService.cleanupMembershipExit(
                                householdId, departingUserId);
                          }));
      assertThat(exitStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(awaitBlockedBy(syncBackendPid.get())).isTrue();

      allowSyncCommit.countDown();
      synchronization.get(10, TimeUnit.SECONDS);
      exit.get(10, TimeUnit.SECONDS);
    } finally {
      allowSyncCommit.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    UUID generatedId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=? AND scheduled_for=?",
            UUID.class,
            scheduleId,
            LocalDate.now(ZoneOffset.UTC).plusDays(2));
    assertThat(assignmentStatus(generatedId)).isEqualTo("CANCELLED");
    assertThat(assignmentPrimaryAssignee(generatedId)).isNull();
    assertThat(normalizedAssignees(generatedId)).isEmpty();
    assertThat(scheduleActive(scheduleId)).isFalse();
  }

  @Test
  void exitThatFinishesBeforeWaitingGenerationPreventsStaleParticipantGeneration()
      throws Exception {
    UUID ownerId = createUser("exit-first-owner");
    UUID departingUserId = createUser("exit-first-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    UUID choreId = createChore(ownerId, "Exit first chore");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(departingUserId));
    jdbc.update(
        "UPDATE chore_schedules SET starts_on=? WHERE id=?",
        LocalDate.now(ZoneOffset.UTC).plusDays(2),
        scheduleId);

    CountDownLatch exitCleaned = new CountDownLatch(1);
    CountDownLatch allowExitCommit = new CountDownLatch(1);
    CountDownLatch generationStarted = new CountDownLatch(1);
    AtomicInteger exitBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            jdbc.queryForObject(
                                "SELECT id FROM households WHERE id=? FOR UPDATE",
                                UUID.class,
                                householdId);
                            jdbc.update(
                                "UPDATE household_memberships SET status='LEFT', left_at=NOW() "
                                    + "WHERE household_id=? AND user_id=?",
                                householdId,
                                departingUserId);
                            membershipExitCleanupService.cleanupMembershipExit(
                                householdId, departingUserId);
                            exitCleaned.countDown();
                            awaitLatch(allowExitCommit, "exit commit");
                          }));
      assertThat(exitCleaned.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> generation =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            generationStarted.countDown();
                            occurrenceService.generateHousehold(householdId);
                          }));
      assertThat(generationStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(awaitAnyBackendBlockedBy(exitBackendPid.get())).isTrue();

      allowExitCommit.countDown();
      exit.get(10, TimeUnit.SECONDS);
      generation.get(10, TimeUnit.SECONDS);
    } finally {
      allowExitCommit.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(scheduleActive(scheduleId)).isFalse();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chore_assignments WHERE schedule_id=?",
                Integer.class,
                scheduleId))
        .isZero();
  }

  @Test
  void scheduleCreationThatFinishesBeforeExitIsReconciledByExit() throws Exception {
    UUID ownerId = createUser("create-before-exit-owner");
    UUID departingUserId = createUser("create-before-exit-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    CountDownLatch operationCommittedToWork = new CountDownLatch(1);
    CountDownLatch allowOperationCommit = new CountDownLatch(1);
    CountDownLatch exitStarted = new CountDownLatch(1);
    AtomicInteger operationBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> creation =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            operationBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            choreService.createChore(
                                householdId,
                                choreRequest(
                                    "Created during exit race",
                                    scheduleRequest(ownerId, departingUserId)),
                                authentication(ownerId));
                            operationCommittedToWork.countDown();
                            awaitLatch(allowOperationCommit, "creation commit");
                          }));
      assertThat(operationCommittedToWork.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitStarted.countDown();
                            householdSettingsService.leave(
                                householdId, null, authentication(departingUserId));
                          }));
      assertThat(exitStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(awaitBlockedBy(operationBackendPid.get())).isTrue();

      allowOperationCommit.countDown();
      creation.get(10, TimeUnit.SECONDS);
      exit.get(10, TimeUnit.SECONDS);
    } finally {
      allowOperationCommit.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    UUID scheduleId =
        jdbc.queryForObject(
            "SELECT id FROM chore_schedules WHERE household_id=?", UUID.class, householdId);
    assertThat(scheduleActive(scheduleId)).isTrue();
    assertThat(scheduleParticipantIds(scheduleId)).containsExactly(ownerId.toString());
    assertThat(
            jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM chore_assignment_assignees
                WHERE household_id=? AND user_id=?
                """,
                Integer.class,
                householdId,
                departingUserId))
        .isZero();
  }

  @Test
  void scheduleEditThatFinishesBeforeExitIsReconciledByExit() throws Exception {
    UUID ownerId = createUser("edit-before-exit-owner");
    UUID departingUserId = createUser("edit-before-exit-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    UUID choreId = createChore(ownerId, "Edited during exit race");
    UUID scheduleId =
        createSchedule(choreId, "FREQ=DAILY", "ROUND_ROBIN", List.of(ownerId, departingUserId));
    CountDownLatch operationCommittedToWork = new CountDownLatch(1);
    CountDownLatch allowOperationCommit = new CountDownLatch(1);
    CountDownLatch exitStarted = new CountDownLatch(1);
    AtomicInteger operationBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> edit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            operationBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            choreService.updateChore(
                                householdId,
                                choreId,
                                choreRequest(
                                    "Edited during exit race",
                                    scheduleRequest(ownerId, departingUserId)),
                                authentication(ownerId));
                            operationCommittedToWork.countDown();
                            awaitLatch(allowOperationCommit, "schedule edit commit");
                          }));
      assertThat(operationCommittedToWork.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitStarted.countDown();
                            householdSettingsService.leave(
                                householdId, null, authentication(departingUserId));
                          }));
      assertThat(exitStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(awaitBlockedBy(operationBackendPid.get())).isTrue();

      allowOperationCommit.countDown();
      edit.get(10, TimeUnit.SECONDS);
      exit.get(10, TimeUnit.SECONDS);
    } finally {
      allowOperationCommit.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(scheduleParticipantIds(scheduleId)).containsExactly(ownerId.toString());
    assertThat(
            jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM chore_assignment_assignees
                WHERE household_id=? AND user_id=?
                """,
                Integer.class,
                householdId,
                departingUserId))
        .isZero();
  }

  @Test
  void exitThatFinishesBeforeScheduleCreationRejectsInactiveParticipant() throws Exception {
    UUID ownerId = createUser("create-after-exit-owner");
    UUID departingUserId = createUser("create-after-exit-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    CountDownLatch exitCommittedToWork = new CountDownLatch(1);
    CountDownLatch allowExitCommit = new CountDownLatch(1);
    CountDownLatch creationStarted = new CountDownLatch(1);
    AtomicInteger exitBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            householdSettingsService.leave(
                                householdId, null, authentication(departingUserId));
                            exitCommittedToWork.countDown();
                            awaitLatch(allowExitCommit, "exit commit");
                          }));
      assertThat(exitCommittedToWork.await(5, TimeUnit.SECONDS)).isTrue();

      Future<Boolean> creation =
          executor.submit(
              () -> {
                creationStarted.countDown();
                try {
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status ->
                              choreService.createChore(
                                  householdId,
                                  choreRequest(
                                      "Rejected creation",
                                      scheduleRequest(ownerId, departingUserId)),
                                  authentication(ownerId)));
                  return false;
                } catch (InvalidHouseholdException exception) {
                  return true;
                }
              });
      assertThat(creationStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(awaitBlockedBy(exitBackendPid.get())).isTrue();

      allowExitCommit.countDown();
      exit.get(10, TimeUnit.SECONDS);
      assertThat(creation.get(10, TimeUnit.SECONDS)).isTrue();
    } finally {
      allowExitCommit.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chores WHERE household_id=? AND title='Rejected creation'",
                Integer.class,
                householdId))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chore_schedules WHERE household_id=?",
                Integer.class,
                householdId))
        .isZero();
  }

  @Test
  void exitThatFinishesBeforeScheduleEditRejectsInactiveParticipant() throws Exception {
    UUID ownerId = createUser("edit-after-exit-owner");
    UUID departingUserId = createUser("edit-after-exit-member");
    householdId = createHousehold(ownerId);
    addMember(departingUserId);
    UUID choreId = createChore(ownerId, "Rejected edit");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "ROUND_ROBIN", List.of(ownerId));
    CountDownLatch exitCommittedToWork = new CountDownLatch(1);
    CountDownLatch allowExitCommit = new CountDownLatch(1);
    CountDownLatch editStarted = new CountDownLatch(1);
    AtomicInteger exitBackendPid = new AtomicInteger();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> exit =
          executor.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            exitBackendPid.set(
                                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
                            householdSettingsService.leave(
                                householdId, null, authentication(departingUserId));
                            exitCommittedToWork.countDown();
                            awaitLatch(allowExitCommit, "exit commit");
                          }));
      assertThat(exitCommittedToWork.await(5, TimeUnit.SECONDS)).isTrue();

      Future<Boolean> edit =
          executor.submit(
              () -> {
                editStarted.countDown();
                try {
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status ->
                              choreService.updateChore(
                                  householdId,
                                  choreId,
                                  choreRequest(
                                      "Rejected edit", scheduleRequest(ownerId, departingUserId)),
                                  authentication(ownerId)));
                  return false;
                } catch (InvalidHouseholdException exception) {
                  return true;
                }
              });
      assertThat(editStarted.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(awaitBlockedBy(exitBackendPid.get())).isTrue();

      allowExitCommit.countDown();
      exit.get(10, TimeUnit.SECONDS);
      assertThat(edit.get(10, TimeUnit.SECONDS)).isTrue();
    } finally {
      allowExitCommit.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(scheduleParticipantIds(scheduleId)).containsExactly(ownerId.toString());
  }

  @Test
  void activationRequiresCompletePoolsAndSucceedsAfterExplicitCorrection() {
    UUID ownerId = createUser("activation-owner");
    UUID secondMemberId = createUser("activation-second-member");
    householdId = createHousehold(ownerId);
    addMember(secondMemberId);

    for (AssignmentStrategy strategy :
        List.of(
            AssignmentStrategy.FIXED, AssignmentStrategy.ROUND_ROBIN, AssignmentStrategy.RANDOM)) {
      UUID choreId = createChore(ownerId, "Insufficient " + strategy);
      UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", strategy.name(), List.of(ownerId), 2);
      jdbc.update("UPDATE chore_schedules SET is_active=FALSE WHERE id=?", scheduleId);
      jdbc.update("UPDATE chores SET is_active=FALSE WHERE id=?", choreId);
      int assignmentsBefore =
          jdbc.queryForObject(
              "SELECT COUNT(*) FROM chore_assignments WHERE schedule_id=?",
              Integer.class,
              scheduleId);

      assertThatThrownBy(
              () -> choreService.activateChore(householdId, choreId, authentication(ownerId)))
          .isInstanceOf(InvalidHouseholdException.class);
      assertThat(scheduleActive(scheduleId)).isFalse();
      assertThat(
              jdbc.queryForObject(
                  "SELECT is_active FROM chores WHERE id=?", Boolean.class, choreId))
          .isFalse();
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM chore_assignments WHERE schedule_id=?",
                  Integer.class,
                  scheduleId))
          .isEqualTo(assignmentsBefore);

      String participants = "[\"" + ownerId + "\",\"" + secondMemberId + "\"]";
      jdbc.update(
          """
          UPDATE chore_schedules
          SET strategy_config=CAST(? AS jsonb),
              fixed_assignee_user_id=?
          WHERE id=?
          """,
          "{\"participantUserIds\":" + participants + ",\"peopleNeeded\":2}",
          strategy == AssignmentStrategy.FIXED ? ownerId : null,
          scheduleId);
      choreService.activateChore(householdId, choreId, authentication(ownerId));
      assertThat(scheduleActive(scheduleId)).isTrue();
      assertThat(
              jdbc.queryForObject(
                  "SELECT is_active FROM chores WHERE id=?", Boolean.class, choreId))
          .isTrue();
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM chore_assignments WHERE schedule_id=? AND status='PENDING'",
                  Integer.class,
                  scheduleId))
          .isGreaterThan(0);
    }
  }

  @Test
  void pausingAndReactivatingScheduleStillRestoresItsPendingAssignments() {
    UUID ownerId = createUser("pause-reactivate-owner");
    householdId = createHousehold(ownerId);
    UUID choreId = createChore(ownerId, "Pause and reactivate");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(ownerId));
    synchronizeSchedule(scheduleId);
    UUID assignmentId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=? ORDER BY scheduled_for LIMIT 1",
            UUID.class,
            scheduleId);

    choreService.pauseChore(householdId, choreId, authentication(ownerId));
    assertThat(scheduleActive(scheduleId)).isFalse();
    assertThat(assignmentStatus(assignmentId)).isEqualTo("CANCELLED");

    choreService.activateChore(householdId, choreId, authentication(ownerId));
    assertThat(scheduleActive(scheduleId)).isTrue();
    assertThat(assignmentStatus(assignmentId)).isEqualTo("PENDING");
    assertThat(assignmentPrimaryAssignee(assignmentId)).isEqualTo(ownerId);
    assertThat(normalizedAssignees(assignmentId)).containsExactly(ownerId);
  }

  @Test
  void reassignmentCancelsOnlyQueuedRemindersForRemovedAssignee() {
    UUID previousUser = createUser("removed");
    UUID nextUser = createUser("current");
    householdId = createHousehold(previousUser);
    addMember(nextUser);
    UUID choreId = createChore(previousUser, "Reassigned chore");
    UUID scheduleId = createSchedule(choreId, "FREQ=DAILY", "FIXED", List.of(previousUser));
    ChoreSchedule schedule = loadSchedule(choreId);
    schedule.setStartsOn(LocalDate.now(ZoneOffset.UTC).plusDays(1));
    schedule.setDueTime(LocalTime.now(ZoneOffset.UTC).plusHours(4));
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(schedule.getId());
    UUID assignmentId =
        jdbc.queryForObject(
            "SELECT id FROM chore_assignments WHERE schedule_id=? ORDER BY scheduled_for LIMIT 1",
            UUID.class,
            scheduleId);
    UUID reminderId = queueReminder(assignmentId, previousUser);
    OffsetDateTime pendingReminderTime =
        jdbc.queryForObject(
            "SELECT scheduled_at FROM notifications WHERE id=?", OffsetDateTime.class, reminderId);
    publishReminderEvent(assignmentId, previousUser, "CHORE_DUE_NOW", "CHORE_REMINDER");
    UUID retryingPushId =
        jdbc.queryForObject(
            """
                SELECT id FROM notifications
                WHERE type='CHORE_DUE_NOW' AND reference_id=? AND recipient_user_id=?
                """,
            UUID.class,
            assignmentId,
            previousUser);
    jdbc.update(
        """
            UPDATE notification_deliveries SET status='FAILED', attempts=1
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        retryingPushId);

    Map<String, Object> config = new HashMap<>(schedule.getStrategyConfig());
    config.put("participantUserIds", List.of(nextUser.toString()));
    schedule.setStrategyConfig(config);
    User nextAssignee = userRepository.findById(nextUser).orElseThrow();
    schedule.setFixedAssignee(nextAssignee);
    scheduleRepository.saveAndFlush(schedule);
    synchronizeSchedule(schedule.getId(), true);

    notificationScheduler.run();

    assertThat(notificationStatus(reminderId)).isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT scheduled_at FROM notifications WHERE id=?",
                OffsetDateTime.class,
                reminderId))
        .isEqualTo(pendingReminderTime);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM notification_deliveries WHERE notification_id=? AND channel='IN_APP'",
                String.class,
                reminderId))
        .isEqualTo("CANCELLED");
    assertThat(notificationStatus(retryingPushId)).isEqualTo("SENT");
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM notification_deliveries WHERE notification_id=? AND channel='WEB_PUSH'",
                String.class,
                retryingPushId))
        .isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications
                    WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=?
                      AND recipient_user_id=? AND type='CHORE_DUE_SOON'
                    """,
                Integer.class,
                assignmentId,
                nextUser))
        .isGreaterThan(0);
  }

  @Test
  void reminderAndCompletionEventTypesKeepTheirExistingCategoriesAndReferences() {
    UUID userId = createUser("reminders");
    householdId = createHousehold(userId);
    UUID choreId = createChore(userId, "Reminder behavior");
    UUID assignmentId = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, scheduled_for, due_at, status,
                 title_snapshot, priority_snapshot, difficulty_snapshot, assigned_to_user_id)
            VALUES (?, ?, ?, CURRENT_DATE, NOW(), 'PENDING',
                    'Reminder behavior', 'NORMAL', 1, ?)
            """,
        assignmentId,
        householdId,
        choreId,
        userId);
    jdbc.update(
        """
            INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
            VALUES (?, ?, ?)
            """,
        householdId,
        assignmentId,
        userId);

    publishReminderEvent(assignmentId, userId, "CHORE_DUE_SOON", "CHORE_REMINDER");
    publishReminderEvent(assignmentId, userId, "CHORE_DUE_NOW", "CHORE_REMINDER");
    publishReminderEvent(assignmentId, userId, "CHORE_OVERDUE", "CHORE_REMINDER");
    publishReminderEvent(assignmentId, userId, "CHORE_COMPLETED", "CHORE_COMPLETION");

    assertThat(notificationTypeCount(assignmentId, "CHORE_DUE_SOON")).isEqualTo(1);
    assertThat(notificationTypeCount(assignmentId, "CHORE_DUE_NOW")).isEqualTo(1);
    assertThat(notificationTypeCount(assignmentId, "CHORE_OVERDUE")).isEqualTo(1);
    assertThat(notificationTypeCount(assignmentId, "CHORE_COMPLETED")).isEqualTo(1);
    Map<String, String> categoriesByType =
        jdbc.query(
            """
                SELECT type, category FROM notifications
                WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=?
                """,
            rs -> {
              Map<String, String> values = new HashMap<>();
              while (rs.next()) {
                values.put(rs.getString("type"), rs.getString("category"));
              }
              return values;
            },
            assignmentId);
    assertThat(categoriesByType)
        .containsExactlyInAnyOrderEntriesOf(
            Map.of(
                "CHORE_DUE_SOON", "CHORE_REMINDER",
                "CHORE_DUE_NOW", "CHORE_REMINDER",
                "CHORE_OVERDUE", "CHORE_REMINDER",
                "CHORE_COMPLETED", "CHORE_COMPLETION"));
    assertThat(
            jdbc.queryForObject(
                """
                    SELECT COUNT(*) FROM notifications
                    WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=?
                    """,
                Integer.class,
                assignmentId))
        .isEqualTo(4);
  }

  private void publishReminderEvent(
      UUID assignmentId, UUID userId, String eventType, String category) {
    Map<String, String> variables = new HashMap<>();
    variables.put("chore_name", "Reminder behavior");
    variables.put("due_time", "12:00");
    variables.put("hours_late", "1");
    variables.put("scheduled_at", OffsetDateTime.now(ZoneOffset.UTC).toString());
    variables.put("expires_at", OffsetDateTime.now(ZoneOffset.UTC).plusHours(1).toString());
    notificationEventService.publish(
        new NotificationEvent(
            eventType,
            null,
            householdId,
            "CHORE_ASSIGNMENT",
            assignmentId,
            category,
            Map.copyOf(variables),
            List.of(userId)));
  }

  private void markNotificationPending(UUID notificationId) {
    jdbc.update("UPDATE notifications SET status='PENDING' WHERE id=?", notificationId);
    jdbc.update(
        "UPDATE notification_deliveries SET status='PENDING', sent_at=NULL WHERE notification_id=?",
        notificationId);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        """
            INSERT INTO users (id, email, password_hash, display_name)
            VALUES (?, ?, 'test-hash', ?)
            """,
        id,
        label + "-" + id + "@example.test",
        label);
    return id;
  }

  private UUID createHousehold(UUID ownerId) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Test', 'UTC', ?)",
        id,
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

  private void addMember(UUID userId) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, 'MEMBER', 'ACTIVE', NOW())
            """,
        householdId,
        userId);
  }

  private UUID createChore(UUID creatorId, String title) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
            VALUES (?, ?, ?, 'NORMAL', 1, ?)
            """,
        id,
        householdId,
        title,
        creatorId);
    return id;
  }

  private UUID createAssignment(
      UUID scheduleId,
      UUID choreId,
      LocalDate scheduledFor,
      OffsetDateTime dueAt,
      String status,
      UUID assignedUserId) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_assignments
                (id, household_id, chore_id, schedule_id, assigned_to_user_id,
                 scheduled_for, due_at, status, title_snapshot, priority_snapshot,
                 difficulty_snapshot, estimated_minutes_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'One-time snapshot', 'NORMAL', 1, 25)
            """,
        id,
        householdId,
        choreId,
        scheduleId,
        assignedUserId,
        scheduledFor,
        dueAt,
        status);
    jdbc.update(
        """
            INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
            VALUES (?, ?, ?)
            """,
        householdId,
        id,
        assignedUserId);
    return id;
  }

  private int activeAssignmentCount(UUID scheduleId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM chore_assignments WHERE schedule_id=? AND status IN ('PENDING','SUBMITTED')",
        Integer.class,
        scheduleId);
  }

  private String assignmentStatus(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT status FROM chore_assignments WHERE id=?", String.class, assignmentId);
  }

  private UUID assignmentPrimaryAssignee(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT assigned_to_user_id FROM chore_assignments WHERE id=?", UUID.class, assignmentId);
  }

  private List<UUID> normalizedAssignees(UUID assignmentId) {
    return jdbc.query(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
        (rs, row) -> rs.getObject("user_id", UUID.class),
        assignmentId);
  }

  private boolean scheduleActive(UUID scheduleId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT is_active FROM chore_schedules WHERE id=?", Boolean.class, scheduleId));
  }

  private boolean awaitBlockedBy(int blockerPid) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    do {
      Boolean blocked =
          jdbc.queryForObject(
              """
              SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity activity
                WHERE ? = ANY(pg_blocking_pids(activity.pid))
              )
              """,
              Boolean.class,
              blockerPid);
      if (Boolean.TRUE.equals(blocked)) return true;
      Thread.sleep(20);
    } while (System.nanoTime() < deadline);
    return false;
  }

  private boolean awaitAnyBackendBlockedBy(int blockerPid) throws InterruptedException {
    return awaitBlockedBy(blockerPid);
  }

  private void awaitLatch(CountDownLatch latch, String operation) {
    try {
      if (!latch.await(10, TimeUnit.SECONDS)) {
        throw new IllegalStateException("Timed out waiting for " + operation + ".");
      }
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(operation + " was interrupted.", exception);
    }
  }

  private ChoreRequest choreRequest(String title, ChoreScheduleRequest schedule) {
    return new ChoreRequest(title, null, null, null, null, null, false, schedule);
  }

  private ChoreScheduleRequest scheduleRequest(UUID ownerId, UUID participantId) {
    return new ChoreScheduleRequest(
        "FREQ=DAILY",
        "UTC",
        LocalDate.now(ZoneOffset.UTC).plusDays(2),
        null,
        null,
        AssignmentStrategy.ROUND_ROBIN,
        null,
        List.of(ownerId, participantId),
        1);
  }

  private ChoreScheduleRequest singleParticipantScheduleRequest(UUID participantId) {
    return new ChoreScheduleRequest(
        "FREQ=DAILY",
        "UTC",
        LocalDate.now(ZoneOffset.UTC).plusDays(2),
        null,
        null,
        AssignmentStrategy.ROUND_ROBIN,
        null,
        List.of(participantId),
        1);
  }

  private org.springframework.security.core.Authentication authentication(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
        email, null);
  }

  private List<String> scheduleParticipantIds(UUID scheduleId) {
    return jdbc.query(
        """
        SELECT jsonb_array_elements_text(strategy_config->'participantUserIds') AS user_id
        FROM chore_schedules
        WHERE id=?
        ORDER BY user_id
        """,
        (rs, row) -> rs.getString("user_id"),
        scheduleId);
  }

  private UUID createSchedule(
      UUID choreId, String recurrenceRule, String strategy, List<UUID> participantIds) {
    return createSchedule(choreId, recurrenceRule, strategy, participantIds, 1);
  }

  private UUID createSchedule(
      UUID choreId,
      String recurrenceRule,
      String strategy,
      List<UUID> participantIds,
      int peopleNeeded) {
    UUID id = UUID.randomUUID();
    String participantsJson =
        participantIds.stream()
            .map(UUID::toString)
            .map(value -> "\"" + value + "\"")
            .collect(java.util.stream.Collectors.joining(","));
    jdbc.update(
        """
            INSERT INTO chore_schedules
                (id, household_id, chore_id, recurrence_rule, timezone, starts_on,
                 assignment_strategy, fixed_assignee_user_id, strategy_config)
            VALUES (?, ?, ?, ?, 'UTC', ?, ?, ?, CAST(? AS jsonb))
            """,
        id,
        householdId,
        choreId,
        recurrenceRule,
        LocalDate.now(),
        strategy,
        "FIXED".equals(strategy) ? participantIds.getFirst() : null,
        "{\"peopleNeeded\":"
            + peopleNeeded
            + ",\"participantUserIds\":["
            + participantsJson
            + "]}");
    return id;
  }

  private ChoreSchedule loadSchedule(UUID choreId) {
    return scheduleRepository.findByChore_IdAndHousehold_Id(choreId, householdId).orElseThrow();
  }

  private void synchronizeScheduleForChore(UUID choreId) {
    synchronizeSchedule(loadSchedule(choreId).getId());
  }

  private void synchronizeSchedule(UUID scheduleId) {
    synchronizeSchedule(scheduleId, false, false);
  }

  private void synchronizeSchedule(UUID scheduleId, boolean updatePendingAssignees) {
    synchronizeSchedule(scheduleId, updatePendingAssignees, false);
  }

  private void synchronizeSchedule(
      UUID scheduleId, boolean updatePendingAssignees, boolean userInitiatedEdit) {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            status -> {
              ChoreSchedule schedule = scheduleRepository.findById(scheduleId).orElseThrow();
              occurrenceService.synchronizeSchedule(
                  schedule, updatePendingAssignees, userInitiatedEdit);
            });
  }

  private void generateHousehold() {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(status -> occurrenceService.generateHousehold(householdId));
  }

  private int announcementCount(UUID scheduleId) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*)
            FROM notification_events ne
            WHERE ne.event_type='CHORE_ASSIGNED'
              AND ((ne.reference_type='CHORE_SCHEDULE' AND ne.reference_id=?)
                   OR (ne.reference_type='CHORE_ASSIGNMENT' AND EXISTS (
                       SELECT 1 FROM chore_assignments a
                       WHERE a.id=ne.reference_id AND a.schedule_id=?
                   )))
            """,
        Integer.class,
        scheduleId,
        scheduleId);
  }

  private int occurrenceCount(UUID scheduleId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM chore_assignments WHERE schedule_id=?", Integer.class, scheduleId);
  }

  private int notificationTypeCount(UUID assignmentId, String type) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND type=?
            """,
        Integer.class,
        assignmentId,
        type);
  }

  private int notificationCount(UUID scheduleId, UUID recipientId) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*)
            FROM notifications n
            WHERE n.type='CHORE_ASSIGNED' AND n.recipient_user_id=?
              AND ((n.reference_type='CHORE_SCHEDULE' AND n.reference_id=?)
                   OR (n.reference_type='CHORE_ASSIGNMENT' AND EXISTS (
                       SELECT 1 FROM chore_assignments a
                       WHERE a.id=n.reference_id AND a.schedule_id=?
                   )))
            """,
        Integer.class,
        recipientId,
        scheduleId,
        scheduleId);
  }

  private String notificationTitle(UUID scheduleId, UUID recipientId) {
    return notificationField(scheduleId, recipientId, "title");
  }

  private String notificationMessage(UUID scheduleId, UUID recipientId) {
    return notificationField(scheduleId, recipientId, "message");
  }

  private String notificationField(UUID scheduleId, UUID recipientId, String column) {
    return jdbc.queryForObject(
        """
            SELECT n.%s
            FROM notifications n
            WHERE n.type='CHORE_ASSIGNED' AND n.recipient_user_id=?
              AND ((n.reference_type='CHORE_SCHEDULE' AND n.reference_id=?)
                   OR (n.reference_type='CHORE_ASSIGNMENT' AND EXISTS (
                       SELECT 1 FROM chore_assignments a
                       WHERE a.id=n.reference_id AND a.schedule_id=?
                   )))
            """
            .formatted(column),
        String.class,
        recipientId,
        scheduleId,
        scheduleId);
  }

  private String notificationReferenceType(UUID scheduleId, UUID recipientId) {
    return jdbc.queryForObject(
        """
            SELECT reference_type FROM notifications
            WHERE type='CHORE_ASSIGNED' AND recipient_user_id=? AND reference_id=?
            """,
        String.class,
        recipientId,
        scheduleId);
  }

  private UUID notificationReferenceId(UUID scheduleId, UUID recipientId) {
    return jdbc.queryForObject(
        """
            SELECT reference_id FROM notifications
            WHERE type='CHORE_ASSIGNED' AND recipient_user_id=? AND reference_type='CHORE_SCHEDULE'
              AND reference_id=?
            """,
        UUID.class,
        recipientId,
        scheduleId);
  }

  private UUID notificationAssignmentReferenceId(UUID scheduleId, UUID recipientId) {
    return jdbc.queryForObject(
        """
            SELECT n.reference_id
            FROM notifications n JOIN chore_assignments a ON a.id=n.reference_id
            WHERE n.type='CHORE_ASSIGNED' AND n.recipient_user_id=?
              AND n.reference_type='CHORE_ASSIGNMENT' AND a.schedule_id=?
            """,
        UUID.class,
        recipientId,
        scheduleId);
  }

  private String notificationAssignmentReferenceType(UUID scheduleId, UUID recipientId) {
    return jdbc.queryForObject(
        """
            SELECT n.reference_type
            FROM notifications n JOIN chore_assignments a ON a.id=n.reference_id
            WHERE n.type='CHORE_ASSIGNED' AND n.recipient_user_id=?
              AND n.reference_type='CHORE_ASSIGNMENT' AND a.schedule_id=?
            """,
        String.class,
        recipientId,
        scheduleId);
  }

  private UUID notificationId(UUID scheduleId, UUID recipientId) {
    return jdbc.queryForObject(
        """
            SELECT id FROM notifications
            WHERE type='CHORE_ASSIGNED' AND recipient_user_id=? AND reference_type='CHORE_SCHEDULE'
              AND reference_id=?
            """,
        UUID.class,
        recipientId,
        scheduleId);
  }

  private String notificationStatus(UUID notificationId) {
    return jdbc.queryForObject(
        "SELECT status FROM notifications WHERE id=?", String.class, notificationId);
  }

  private UUID queueReminder(UUID assignmentId, UUID recipientId) {
    publishReminderEvent(assignmentId, recipientId, "CHORE_DUE_SOON", "CHORE_REMINDER");
    UUID notificationId =
        jdbc.queryForObject(
            """
                SELECT id FROM notifications
                WHERE type='CHORE_DUE_SOON' AND reference_id=? AND recipient_user_id=?
                """,
            UUID.class,
            assignmentId,
            recipientId);
    OffsetDateTime future = OffsetDateTime.now(ZoneOffset.UTC).plusHours(1);
    jdbc.update(
        "UPDATE notifications SET status='PENDING', scheduled_at=? WHERE id=?",
        future,
        notificationId);
    jdbc.update(
        """
            UPDATE notification_deliveries SET status='PENDING', sent_at=NULL
            WHERE notification_id=? AND channel='IN_APP'
            """,
        notificationId);
    return notificationId;
  }
}
