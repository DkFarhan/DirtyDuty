package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@ExtendWith(OutputCaptureExtension.class)
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key"
    })
class RecurrenceGenerationIntegrationTest {
  private static final int HORIZON_DAYS = 30;
  private static final ZoneId HALIFAX = ZoneId.of("America/Halifax");

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private OccurrenceGenerationScheduler generationScheduler;
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
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
    householdIds.clear();
    userIds.clear();
  }

  @Test
  void eachNewRuleTypeGeneratesExactlyItsDatesWithinTheHorizonAndIsStoredCanonically() {
    Fixture home = createHousehold("rule-types", "UTC");
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    LocalDate inTen = today.plusDays(10);
    String currentMonth = Integer.toString(today.getMonthValue());
    String nextMonth = Integer.toString(today.plusMonths(1).getMonthValue());
    List<String> rules =
        List.of(
            "FREQ=DAILY;INTERVAL=3",
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO",
            "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYMONTH=" + nextMonth + "," + currentMonth,
            "FREQ=MONTHLY;BYDAY=-1FR",
            "FREQ=MONTHLY;BYMONTHDAY=31",
            "FREQ=MONTHLY;BYDAY=2TU",
            "FREQ=YEARLY;BYMONTH=" + inTen.getMonthValue() + ";BYMONTHDAY=" + inTen.getDayOfMonth(),
            "FREQ=DAILY;COUNT=4");

    for (String input : rules) {
      UUID choreId = createChore(home, input, today, null, LocalTime.of(18, 0));
      String stored = storedRule(choreId);
      RecurrenceRule rule = RecurrenceRule.parse(input);

      assertThat(stored).as(input).isEqualTo(rule.toString());
      assertThat(liveDates(choreId))
          .as(input)
          .containsExactlyElementsOf(rule.datesBetween(today, today, today.plusDays(HORIZON_DAYS)));
    }
    assertThat(storedRule(choreIdFor(home, "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO")))
        .isEqualTo("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH");
    assertThat(liveDates(choreIdFor(home, "FREQ=DAILY;COUNT=4"))).hasSize(4);
  }

  @Test
  void invalidRulesAreRejectedWithClearMessages() {
    Fixture home = createHousehold("rule-invalid", "UTC");
    LocalDate today = LocalDate.now(ZoneOffset.UTC);

    assertThatThrownBy(
            () -> createChore(home, "FREQ=MONTHLY;BYDAY=5MO", today, null, LocalTime.NOON))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Choose the 1st, 2nd, 3rd, 4th or last weekday of the month.");
    assertThatThrownBy(
            () ->
                createChore(home, "FREQ=DAILY;COUNT=5", today, today.plusDays(20), LocalTime.NOON))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Choose either an end date or a number of times, not both.");
    LocalDate january = LocalDate.of(today.getYear() + 1, 1, 1);
    assertThatThrownBy(
            () ->
                createChore(
                    home,
                    "FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=1;BYMONTH=6",
                    january,
                    null,
                    LocalTime.NOON))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("This schedule never produces a date. Check its start date and active months.");
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chores WHERE household_id=?",
                Integer.class,
                home.householdId()))
        .isZero();
  }

  @Test
  void ruleEditCancelsDroppedDatesAndTheirRemindersAndPlansTheNewOnes() {
    Fixture home = createHousehold("rule-edit", "UTC");
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    LocalDate start = today.plusDays(1);
    UUID choreId = createChore(home, "FREQ=DAILY", start, null, LocalTime.of(18, 0));
    notificationScheduler.run();
    List<LocalDate> dailyDates = liveDates(choreId);
    UUID submitted = occurrenceOn(choreId, dailyDates.get(1));
    UUID completed = occurrenceOn(choreId, dailyDates.get(2));
    jdbc.update("UPDATE chore_assignments SET status='SUBMITTED' WHERE id=?", submitted);
    jdbc.update("UPDATE chore_assignments SET status='COMPLETED' WHERE id=?", completed);

    RecurrenceRule monthly = RecurrenceRule.parse("FREQ=MONTHLY;BYMONTHDAY=-1");
    updateRule(home, choreId, monthly.toString(), start);

    List<LocalDate> expected = monthly.datesBetween(start, start, today.plusDays(HORIZON_DAYS));
    List<UUID> dropped =
        jdbc.queryForList(
            "SELECT id FROM chore_assignments WHERE chore_id=? AND status='CANCELLED'",
            UUID.class,
            choreId);
    assertThat(dropped).isNotEmpty();
    for (UUID droppedId : dropped) {
      assertThat(pendingReminderCount(droppedId)).as("reminders of %s", droppedId).isZero();
    }
    assertThat(status(submitted)).isEqualTo("SUBMITTED");
    assertThat(status(completed)).isEqualTo("COMPLETED");
    assertThat(
            jdbc.queryForList(
                """
                    SELECT scheduled_for FROM chore_assignments
                    WHERE chore_id=? AND status='PENDING' ORDER BY scheduled_for
                    """,
                LocalDate.class,
                choreId))
        .containsExactlyElementsOf(
            expected.stream()
                .filter(date -> !date.equals(dailyDates.get(1)) && !date.equals(dailyDates.get(2)))
                .toList());

    notificationScheduler.run();
    for (LocalDate date : expected) {
      if (date.equals(dailyDates.get(2))) {
        continue; // completed work has no reminders
      }
      assertThat(pendingReminderCount(occurrenceOn(choreId, date))).isPositive();
    }
  }

  @Test
  void backgroundGenerationHandlesEveryNewRuleType() {
    Fixture home = createHousehold("rule-background", "UTC");
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    List<String> rules =
        List.of(
            "FREQ=DAILY;INTERVAL=2;COUNT=5",
            "FREQ=WEEKLY;BYDAY=SA,SU",
            "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15",
            "FREQ=MONTHLY;BYDAY=1MO",
            "FREQ=YEARLY;BYMONTH="
                + today.plusDays(5).getMonthValue()
                + ";BYMONTHDAY="
                + today.plusDays(5).getDayOfMonth());
    List<UUID> scheduleIds = new ArrayList<>();
    for (String rule : rules) {
      scheduleIds.add(insertSchedule(home, rule, today.minusDays(40), null));
    }

    generationScheduler.run();

    for (int i = 0; i < rules.size(); i++) {
      RecurrenceRule rule = RecurrenceRule.parse(rules.get(i));
      assertThat(
              jdbc.queryForList(
                  """
                      SELECT scheduled_for FROM chore_assignments
                      WHERE schedule_id=? ORDER BY scheduled_for
                      """,
                  LocalDate.class,
                  scheduleIds.get(i)))
          .as(rules.get(i))
          .containsExactlyElementsOf(
              rule.datesBetween(today.minusDays(40), today, today.plusDays(HORIZON_DAYS)));
    }
  }

  @Test
  void halifaxDueTimesStayAtTheSameLocalWallClockTimeAcrossDst() {
    // Halifax moves from AST (UTC-4) to ADT (UTC-3) on 2027-03-14.
    RecurrenceRule sundays = RecurrenceRule.parse("FREQ=WEEKLY;BYDAY=SU");
    LocalDate start = LocalDate.of(2027, 3, 1);
    List<LocalDate> dates = sundays.datesBetween(start, start, LocalDate.of(2027, 3, 22));
    assertThat(dates)
        .containsExactly(
            LocalDate.of(2027, 3, 7), LocalDate.of(2027, 3, 14), LocalDate.of(2027, 3, 21));
    List<OffsetDateTime> dueTimes =
        dates.stream()
            .map(date -> OccurrenceService.dueAt(date, LocalTime.of(18, 0), HALIFAX))
            .toList();
    assertThat(dueTimes.get(0).getOffset()).isEqualTo(ZoneOffset.ofHours(-4));
    assertThat(dueTimes.get(1).getOffset()).isEqualTo(ZoneOffset.ofHours(-3));
    assertThat(dueTimes)
        .allSatisfy(
            due ->
                assertThat(due.atZoneSameInstant(HALIFAX).toLocalTime())
                    .isEqualTo(LocalTime.of(18, 0)));

    // Real occurrences on both sides of the change keep 18:00 local in the stored deadline.
    Fixture home = createHousehold("rule-dst", HALIFAX.getId());
    UUID before =
        createChore(home, "FREQ=ONCE", LocalDate.of(2027, 3, 7), null, LocalTime.of(18, 0));
    UUID after =
        createChore(home, "FREQ=ONCE", LocalDate.of(2027, 3, 21), null, LocalTime.of(18, 0));
    UUID recurring =
        createChore(
            home,
            "FREQ=MONTHLY;BYMONTHDAY=" + LocalDate.now(HALIFAX).getDayOfMonth(),
            LocalDate.now(HALIFAX),
            null,
            LocalTime.of(18, 0));
    for (UUID choreId : List.of(before, after, recurring)) {
      OffsetDateTime stored =
          jdbc.queryForObject(
              "SELECT due_at FROM chore_assignments WHERE chore_id=? ORDER BY scheduled_for LIMIT 1",
              OffsetDateTime.class,
              choreId);
      assertThat(stored.atZoneSameInstant(HALIFAX).toLocalTime()).isEqualTo(LocalTime.of(18, 0));
    }
    assertThat(
            jdbc.queryForObject(
                    "SELECT due_at FROM chore_assignments WHERE chore_id=?",
                    OffsetDateTime.class,
                    before)
                .toInstant())
        .isEqualTo(dueTimes.get(0).toInstant());
    assertThat(
            jdbc.queryForObject(
                    "SELECT due_at FROM chore_assignments WHERE chore_id=?",
                    OffsetDateTime.class,
                    after)
                .toInstant())
        .isEqualTo(dueTimes.get(2).toInstant());
  }

  @Test
  void roundRobinOnASchedulesStartedYearsAgoStaysFastAndAlternates() {
    Fixture home = createHousehold("rule-round-robin", "UTC");
    UUID memberId = createUser("rule-round-robin-member");
    addMember(home.householdId(), memberId, "MEMBER");
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    UUID scheduleId = insertSchedule(home, "FREQ=DAILY", today.minusYears(2).minusDays(37), null);
    jdbc.update(
        """
            UPDATE chore_schedules
            SET assignment_strategy='ROUND_ROBIN', fixed_assignee_user_id=NULL,
                strategy_config=jsonb_build_object(
                    'peopleNeeded', 1,
                    'participantUserIds', jsonb_build_array(?::text, ?::text))
            WHERE id=?
            """,
        home.ownerId().toString(),
        memberId.toString(),
        scheduleId);

    long began = System.nanoTime();
    new TransactionTemplate(transactionManager)
        .executeWithoutResult(tx -> occurrenceService.generateHousehold(home.householdId()));
    long elapsedMillis = (System.nanoTime() - began) / 1_000_000;

    List<UUID> assignees =
        jdbc.queryForList(
            """
                SELECT assigned_to_user_id FROM chore_assignments
                WHERE schedule_id=? ORDER BY scheduled_for
                """,
            UUID.class,
            scheduleId);
    assertThat(assignees).hasSize(HORIZON_DAYS);
    for (int i = 1; i < assignees.size(); i++) {
      assertThat(assignees.get(i)).isNotEqualTo(assignees.get(i - 1));
    }
    assertThat(elapsedMillis).isLessThan(10_000);
  }

  // ---- fixtures ----

  private record Fixture(UUID householdId, UUID ownerId) {}

  private final java.util.Map<String, UUID> choresByRule = new java.util.HashMap<>();

  private UUID choreIdFor(Fixture home, String rule) {
    return choresByRule.get(home.householdId() + rule);
  }

  private UUID createChore(
      Fixture home, String rule, LocalDate startsOn, LocalDate endsOn, LocalTime dueTime) {
    UUID choreId =
        choreService
            .createChore(
                home.householdId(),
                request(rule, startsOn, endsOn, dueTime, home.ownerId()),
                auth(home.ownerId()))
            .id();
    choresByRule.put(home.householdId() + rule, choreId);
    return choreId;
  }

  @Test
  void anUnparseableStoredRuleIsSkippedWithoutBreakingTheRestOfTheHousehold(CapturedOutput output) {
    Fixture home = createHousehold("rule-unparseable", "UTC");
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    // Generate occurrences for the soon-to-be-broken schedule while its rule is still valid.
    UUID brokenSchedule = insertSchedule(home, "FREQ=DAILY", today, null);
    occurrenceService.generateHousehold(home.householdId());
    List<UUID> existing = scheduleOccurrenceIds(brokenSchedule);
    assertThat(existing).isNotEmpty();
    String unparseable = "FREQ=WEEKLY;BYDAY=WE;WKST=MO";
    jdbc.update(
        "UPDATE chore_schedules SET recurrence_rule=? WHERE id=?", unparseable, brokenSchedule);
    UUID brokenChore = choreOf(brokenSchedule);

    // Dashboard: succeeds, generates the valid schedule, still shows the broken one's occurrences.
    UUID dashboardSchedule = insertSchedule(home, "FREQ=DAILY", today, null);
    var dashboard = occurrenceService.dashboard(home.householdId(), auth(home.ownerId()));
    assertThat(scheduleOccurrenceIds(dashboardSchedule)).isNotEmpty();
    assertThat(dashboard.today()).extracting(a -> a.choreId()).contains(brokenChore);

    // My Chores: same.
    UUID myChoresSchedule = insertSchedule(home, "FREQ=DAILY", today, null);
    var myChores = occurrenceService.myChores(home.householdId(), "UPCOMING", auth(home.ownerId()));
    assertThat(scheduleOccurrenceIds(myChoresSchedule)).isNotEmpty();
    assertThat(myChores).extracting(a -> a.choreId()).contains(brokenChore);

    // Background job: the household counts as generated, not failed.
    UUID backgroundSchedule = insertSchedule(home, "FREQ=DAILY", today, null);
    OccurrenceGenerationScheduler.Result result = generationScheduler.run();
    assertThat(result.failed()).isZero();
    assertThat(scheduleOccurrenceIds(backgroundSchedule)).isNotEmpty();

    // The broken schedule is untouched: same occurrences, none cancelled, rule kept verbatim.
    assertThat(scheduleOccurrenceIds(brokenSchedule)).containsExactlyElementsOf(existing);
    assertThat(existing).allSatisfy(id -> assertThat(status(id)).isEqualTo("PENDING"));
    assertThat(storedRule(brokenChore)).isEqualTo(unparseable);
    assertThat(
            choreService.listChores(home.householdId(), false, auth(home.ownerId())).stream()
                .filter(chore -> chore.id().equals(brokenChore)))
        .singleElement()
        .satisfies(chore -> assertThat(chore.schedule().recurrenceRule()).isEqualTo(unparseable));

    // WARN names the schedule id only, never the rule text.
    assertThat(output.getOut())
        .contains("Skipping occurrence generation for schedule " + brokenSchedule)
        .doesNotContain(unparseable);

    // Saving the same rule through the service is still rejected.
    assertThatThrownBy(() -> updateRule(home, brokenChore, unparseable, today))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("This repeat rule is not supported.");
  }

  private List<UUID> scheduleOccurrenceIds(UUID scheduleId) {
    return jdbc.queryForList(
        "SELECT id FROM chore_assignments WHERE schedule_id=? ORDER BY scheduled_for",
        UUID.class,
        scheduleId);
  }

  private UUID choreOf(UUID scheduleId) {
    return jdbc.queryForObject(
        "SELECT chore_id FROM chore_schedules WHERE id=?", UUID.class, scheduleId);
  }

  private void updateRule(Fixture home, UUID choreId, String rule, LocalDate startsOn) {
    choreService.updateChore(
        home.householdId(),
        choreId,
        request(rule, startsOn, null, LocalTime.of(18, 0), home.ownerId()),
        auth(home.ownerId()));
  }

  private static ChoreRequest request(
      String rule, LocalDate startsOn, LocalDate endsOn, LocalTime dueTime, UUID assignee) {
    return new ChoreRequest(
        "Recurrence chore",
        null,
        null,
        null,
        null,
        null,
        false,
        new ChoreScheduleRequest(
            rule, null, startsOn, endsOn, dueTime, AssignmentStrategy.FIXED, assignee, null, null));
  }

  private UUID insertSchedule(Fixture home, String rule, LocalDate startsOn, LocalDate endsOn) {
    UUID choreId = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
            VALUES (?, ?, 'Background recurrence', 'NORMAL', 1, ?)
            """,
        choreId,
        home.householdId(),
        home.ownerId());
    UUID scheduleId = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO chore_schedules
                (id, household_id, chore_id, recurrence_rule, timezone, starts_on, ends_on,
                 due_time, assignment_strategy, fixed_assignee_user_id, strategy_config)
            VALUES (?, ?, ?, ?, 'UTC', ?, ?, '18:00', 'FIXED', ?, '{"peopleNeeded":1}'::jsonb)
            """,
        scheduleId,
        home.householdId(),
        choreId,
        rule,
        startsOn,
        endsOn,
        home.ownerId());
    return scheduleId;
  }

  private Fixture createHousehold(String label, String timezone) {
    UUID ownerId = createUser(label + "-owner");
    UUID householdId = UUID.randomUUID();
    householdIds.add(householdId);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Recurrence test', ?, ?)",
        householdId,
        timezone,
        ownerId);
    addMember(householdId, ownerId, "OWNER");
    return new Fixture(householdId, ownerId);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'test-hash', 'Recurrence test')",
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

  private String storedRule(UUID choreId) {
    return jdbc.queryForObject(
        "SELECT recurrence_rule FROM chore_schedules WHERE chore_id=?", String.class, choreId);
  }

  private List<LocalDate> liveDates(UUID choreId) {
    return jdbc.queryForList(
        """
            SELECT scheduled_for FROM chore_assignments
            WHERE chore_id=? AND status<>'CANCELLED' ORDER BY scheduled_for
            """,
        LocalDate.class,
        choreId);
  }

  private UUID occurrenceOn(UUID choreId, LocalDate date) {
    return jdbc.queryForObject(
        "SELECT id FROM chore_assignments WHERE chore_id=? AND scheduled_for=?",
        UUID.class,
        choreId,
        date);
  }

  private String status(UUID assignmentId) {
    return jdbc.queryForObject(
        "SELECT status FROM chore_assignments WHERE id=?", String.class, assignmentId);
  }

  private int pendingReminderCount(UUID assignmentId) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications
            WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
              AND type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
            """,
        Integer.class,
        assignmentId);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
