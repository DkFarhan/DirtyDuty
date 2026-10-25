package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
  @Autowired private NotificationEventService notificationEventService;
  @Autowired private NotificationScheduler notificationScheduler;
  @Autowired private PlatformTransactionManager transactionManager;

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
                  : "You've joined a chore rotation!");
      assertThat(notificationMessage(scheduleId, firstUser))
          .as(strategy)
          .contains(
              "FIXED".equals(strategy)
                  ? "has been added to your recurring chores"
                  : "You'll be reminded when it's your turn");

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
        .isEqualTo("You'll be reminded when it's your turn to complete Random recurring chore.");
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
    synchronizeSchedule(scheduleId, false);
  }

  private void synchronizeSchedule(UUID scheduleId, boolean updatePendingAssignees) {
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(
            status -> {
              ChoreSchedule schedule = scheduleRepository.findById(scheduleId).orElseThrow();
              occurrenceService.synchronizeSchedule(schedule, updatePendingAssignees);
            });
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
