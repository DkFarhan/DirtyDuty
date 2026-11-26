package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.household.HouseholdRemindersRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.QuietHoursService;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
 * Reminder levels (E13) on real PostgreSQL: each level plans exactly its rule set, new chores take
 * the household default, and changing a chore's level re-plans what hasn't been sent. Deadlines are
 * days ahead of the real clock (the scheduler plans from it); the quiet-hours clock is pinned.
 */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.notifications.web-push.public-key=test-public-key",
      "app.notifications.web-push.private-key=test-private-key",
      "app.chores.generation.enabled=false"
    })
class ReminderLevelsIntegrationTest {
  private static final Map<String, Set<String>> RULES =
      Map.of(
          "OFF", Set.of(),
          "FRIENDLY", Set.of("CHORE_DUE_NOW@0", "CHORE_OVERDUE@-720"),
          "STANDARD", Set.of("CHORE_DUE_SOON@360", "CHORE_DUE_NOW@0", "CHORE_OVERDUE@-180"),
          "AGGRESSIVE",
              Set.of(
                  "CHORE_DUE_SOON@1440",
                  "CHORE_DUE_SOON@360",
                  "CHORE_DUE_SOON@60",
                  "CHORE_DUE_NOW@0",
                  "CHORE_OVERDUE@-60",
                  "CHORE_OVERDUE@-180"),
          "INTENSE",
              Set.of(
                  "CHORE_DUE_SOON@2880",
                  "CHORE_DUE_SOON@1440",
                  "CHORE_DUE_SOON@720",
                  "CHORE_DUE_SOON@360",
                  "CHORE_DUE_SOON@120",
                  "CHORE_DUE_SOON@60",
                  "CHORE_DUE_NOW@0",
                  "CHORE_OVERDUE@-60",
                  "CHORE_OVERDUE@-180",
                  "CHORE_OVERDUE@-360",
                  "CHORE_OVERDUE@-600"));

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private HouseholdSettingsService settings;
  @Autowired private NotificationScheduler scheduler;
  @Autowired private QuietHoursService quietHours;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID ana;
  private UUID ben;
  private LocalDate dueDate;

  @BeforeEach
  void setUp() throws Exception {
    when(webPushClient.send(
            anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), any()))
        .thenReturn(201);
    ana = user("Ana");
    ben = user("Ben");
    householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Levels', 'UTC', ?)",
        householdId,
        ana);
    member(ana, "OWNER");
    member(ben, "MEMBER");
    // Far enough ahead that every level's earliest reminder (two days before) is still to come.
    dueDate = LocalDate.now(ZoneOffset.UTC).plusDays(5);
  }

  @AfterEach
  void cleanUp() {
    quietHours.useClock(null);
    jdbc.update(
        """
            DELETE FROM notifications
            WHERE (reference_type='CHORE_ASSIGNMENT'
                   AND reference_id IN (SELECT id FROM chore_assignments WHERE household_id=?))
               OR event_id IN (SELECT id FROM notification_events WHERE household_id=?)
            """,
        householdId,
        householdId);
    for (String table :
        List.of(
            "notification_events",
            "activity_events",
            "chore_completions",
            "chore_assignment_assignees",
            "chore_assignments")) {
      jdbc.update("DELETE FROM " + table + " WHERE household_id=?", householdId);
    }
    jdbc.update(
        "DELETE FROM recurring_chore_assignment_announcements WHERE schedule_id IN"
            + " (SELECT id FROM chore_schedules WHERE household_id=?)",
        householdId);
    jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
    jdbc.update("DELETE FROM households WHERE id=?", householdId);
    for (UUID id : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", id);
      jdbc.update("DELETE FROM push_subscriptions WHERE user_id=?", id);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", id);
      jdbc.update("DELETE FROM users WHERE id=?", id);
    }
  }

  @Test
  void eachLevelPlansExactlyItsRuleSetAndOffPlansNone() {
    Map<String, UUID> occurrences = new java.util.HashMap<>();
    for (String mode : RULES.keySet()) {
      occurrences.put(mode, onlyOccurrence(oneTimeChore(mode, mode, ana)));
    }

    scheduler.run();

    RULES.forEach(
        (mode, rules) -> assertThat(plannedSlots(occurrences.get(mode))).as(mode).isEqualTo(rules));
  }

  @Test
  void newChoresTakeTheHouseholdDefaultAndChangingItLeavesExistingChoresAlone() {
    assertThat(settings.get(householdId, auth(ben)).defaultReminderMode()).isEqualTo("STANDARD");
    UUID before = oneTimeChore("Before", null, ana);
    assertThat(choreMode(before)).isEqualTo("STANDARD");

    assertThat(
            settings
                .updateReminders(householdId, new HouseholdRemindersRequest("FRIENDLY"), auth(ana))
                .defaultReminderMode())
        .isEqualTo("FRIENDLY");

    assertThat(choreMode(before)).isEqualTo("STANDARD");
    UUID after = oneTimeChore("After", null, ana);
    assertThat(choreMode(after)).isEqualTo("FRIENDLY");
    assertThat(choreService.getChore(householdId, after, auth(ana)).reminderMode())
        .isEqualTo("FRIENDLY");
    // A level chosen on create wins over the default.
    assertThat(choreMode(oneTimeChore("Chosen", "INTENSE", ana))).isEqualTo("INTENSE");

    // Owners and admins only; only the five levels.
    assertThatThrownBy(
            () ->
                settings.updateReminders(
                    householdId, new HouseholdRemindersRequest("OFF"), auth(ben)))
        .isInstanceOf(HouseholdAccessDeniedException.class)
        .hasMessage("Only the household owner or an admin can change reminders for new chores.");
    member(ben, "ADMIN");
    assertThat(
            settings
                .updateReminders(householdId, new HouseholdRemindersRequest("OFF"), auth(ben))
                .defaultReminderMode())
        .isEqualTo("OFF");
    assertThatThrownBy(
            () ->
                settings.updateReminders(
                    householdId, new HouseholdRemindersRequest("CUSTOM"), auth(ana)))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Choose a reminder level.");
    assertThatThrownBy(() -> oneTimeChore("Loud", "LOUD", ana))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Choose a reminder level.");
  }

  @Test
  void changingAChoresLevelReplansWhatHasNotBeenSentAndNeverResendsWhatHas() {
    UUID chore = oneTimeChore("Dishes", "STANDARD", ana);
    UUID occurrence = onlyOccurrence(chore);
    scheduler.run();
    assertThat(plannedSlots(occurrence)).isEqualTo(RULES.get("STANDARD"));
    // The six-hours-before heads-up has already gone out.
    UUID sent = reminderId(occurrence, "CHORE_DUE_SOON", 360);
    jdbc.update("UPDATE notifications SET status='SENT', sent_at=NOW() WHERE id=?", sent);
    jdbc.update(
        "UPDATE notification_deliveries SET status='SENT', sent_at=NOW(), attempts=1"
            + " WHERE notification_id=?",
        sent);

    // Saving without a level, or with the same one, changes nothing.
    choreService.updateChore(householdId, chore, request("Dishes", null, ana), auth(ana));
    choreService.updateChore(householdId, chore, request("Dishes", "STANDARD", ana), auth(ana));
    assertThat(plannedSlots(occurrence))
        .containsExactlyInAnyOrder("CHORE_DUE_NOW@0", "CHORE_OVERDUE@-180");

    choreService.updateChore(householdId, chore, request("Dishes", "INTENSE", ana), auth(ana));

    assertThat(choreMode(chore)).isEqualTo("INTENSE");
    assertThat(plannedSlots(occurrence)).isEmpty();
    assertThat(status(sent)).isEqualTo("SENT");
    assertThat(occurrenceService.occurrence(householdId, occurrence, auth(ana)).reminderMode())
        .isEqualTo("INTENSE");

    scheduler.run();

    Set<String> intense = new java.util.HashSet<>(RULES.get("INTENSE"));
    intense.remove("CHORE_DUE_SOON@360");
    assertThat(plannedSlots(occurrence)).isEqualTo(intense);
    assertThat(rowsFor(occurrence, "CHORE_DUE_SOON", 360)).isEqualTo(1);
    assertThat(status(sent)).isEqualTo("SENT");

    // Off cancels the rest, and nothing new is planned.
    choreService.updateChore(householdId, chore, request("Dishes", "OFF", ana), auth(ana));
    scheduler.run();
    assertThat(plannedSlots(occurrence)).isEmpty();
    assertThat(status(sent)).isEqualTo("SENT");
  }

  @Test
  void offSuppressesTimedRemindersButNotAssignedOrNeedsDoing() {
    UUID chore = oneTimeChore("Bins", "OFF", ben);
    UUID occurrence = onlyOccurrence(chore);
    UUID job = choreService.createChore(householdId, asNeeded("Towels", "OFF"), auth(ana)).id();
    UUID open = onlyOccurrence(job);

    scheduler.run();
    occurrenceService.flag(householdId, open, auth(ana));
    scheduler.run();

    assertThat(types(occurrence, ben)).contains("CHORE_ASSIGNED").doesNotContain(timed());
    assertThat(types(open, ben)).contains("CHORE_NEEDS_DOING").doesNotContain(timed());
  }

  @Test
  void aLevelsRemindersStillWaitForQuietHours() throws Exception {
    jdbc.update(
        "INSERT INTO notification_preferences (user_id, push_enabled, quiet_hours_enabled,"
            + " quiet_hours_start, quiet_hours_end) VALUES (?, TRUE, TRUE, '22:00', '08:00')",
        ana);
    jdbc.update(
        "INSERT INTO push_subscriptions (id, user_id, endpoint, public_key, auth_secret)"
            + " VALUES (?, ?, ?, 'test-subscription-key', 'test-auth-secret')",
        UUID.randomUUID(),
        ana,
        "https://push.example.test/" + UUID.randomUUID());
    UUID occurrence = onlyOccurrence(oneTimeChore("Floors", "FRIENDLY", ana));
    scheduler.run();
    UUID dueNow = reminderId(occurrence, "CHORE_DUE_NOW", 0);
    jdbc.update(
        "UPDATE notifications SET scheduled_at=NOW() - INTERVAL '1 minute',"
            + " expires_at=NOW() + INTERVAL '1 hour' WHERE id=?",
        dueNow);
    // 23:00 in the household's time zone (UTC), inside Ana's quiet hours.
    OffsetDateTime night = dueDate.atTime(23, 0).atOffset(ZoneOffset.UTC);
    quietHours.useClock(Clock.fixed(night.toInstant(), ZoneOffset.UTC));

    scheduler.run();

    assertThat(status(dueNow)).isEqualTo("SENT");
    Map<String, Object> push =
        jdbc.queryForMap(
            "SELECT status, quiet_held_until FROM notification_deliveries"
                + " WHERE notification_id=? AND channel='WEB_PUSH'",
            dueNow);
    assertThat(push).containsEntry("status", "PENDING");
    assertThat(((java.sql.Timestamp) push.get("quiet_held_until")).toInstant())
        .isEqualTo(dueDate.plusDays(1).atTime(8, 0).toInstant(ZoneOffset.UTC));
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private static String[] timed() {
    return new String[] {"CHORE_DUE_SOON", "CHORE_DUE_NOW", "CHORE_OVERDUE"};
  }

  private UUID oneTimeChore(String title, String mode, UUID assignee) {
    return choreService.createChore(householdId, request(title, mode, assignee), auth(ana)).id();
  }

  private ChoreRequest request(String title, String mode, UUID assignee) {
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
            assignee,
            null,
            null),
        null,
        mode);
  }

  private ChoreRequest asNeeded(String title, String mode) {
    return new ChoreRequest(
        title,
        null,
        null,
        null,
        null,
        null,
        false,
        new ChoreScheduleRequest(
            null,
            null,
            null,
            null,
            LocalTime.of(20, 0),
            AssignmentStrategy.ROUND_ROBIN,
            null,
            List.of(ben),
            1,
            ScheduleKind.AS_NEEDED,
            null,
            null,
            true,
            2),
        null,
        mode);
  }

  /** Pending reminders of one occurrence, as "TYPE@minutes before due". */
  private Set<String> plannedSlots(UUID occurrence) {
    return jdbc
        .query(
            """
                SELECT n.type, n.scheduled_at, a.due_at FROM notifications n
                JOIN chore_assignments a ON a.id=n.reference_id
                WHERE n.reference_type='CHORE_ASSIGNMENT' AND n.reference_id=?
                  AND n.status='PENDING'
                  AND n.type IN ('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')
                """,
            (rs, row) ->
                rs.getString("type")
                    + "@"
                    + Duration.between(
                            rs.getObject("scheduled_at", OffsetDateTime.class),
                            rs.getObject("due_at", OffsetDateTime.class))
                        .toMinutes(),
            occurrence)
        .stream()
        .collect(Collectors.toSet());
  }

  private UUID reminderId(UUID occurrence, String type, int minutesBefore) {
    return jdbc.queryForObject(
        """
            SELECT n.id FROM notifications n JOIN chore_assignments a ON a.id=n.reference_id
            WHERE n.reference_id=? AND n.type=? AND n.status='PENDING'
              AND n.scheduled_at = a.due_at - make_interval(mins => ?)
            """,
        UUID.class,
        occurrence,
        type,
        minutesBefore);
  }

  private int rowsFor(UUID occurrence, String type, int minutesBefore) {
    return jdbc.queryForObject(
        """
            SELECT COUNT(*) FROM notifications n JOIN chore_assignments a ON a.id=n.reference_id
            WHERE n.reference_id=? AND n.type=?
              AND n.scheduled_at = a.due_at - make_interval(mins => ?)
            """,
        Integer.class,
        occurrence,
        type,
        minutesBefore);
  }

  private List<String> types(UUID occurrence, UUID recipient) {
    return jdbc.queryForList(
        "SELECT type FROM notifications WHERE reference_type='CHORE_ASSIGNMENT'"
            + " AND reference_id=? AND recipient_user_id=?",
        String.class,
        occurrence,
        recipient);
  }

  private String status(UUID notification) {
    return jdbc.queryForObject(
        "SELECT status FROM notifications WHERE id=?", String.class, notification);
  }

  private String choreMode(UUID chore) {
    return jdbc.queryForObject("SELECT reminder_mode FROM chores WHERE id=?", String.class, chore);
  }

  private UUID onlyOccurrence(UUID chore) {
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT id FROM chore_assignments WHERE chore_id=? AND status='PENDING'",
            UUID.class,
            chore);
    assertThat(ids).hasSize(1);
    return ids.getFirst();
  }

  private UUID user(String name) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'h', ?)",
        id,
        "levels-" + id + "@example.test",
        name);
    return id;
  }

  private void member(UUID user, String role) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', NOW())
            ON CONFLICT (household_id, user_id) DO UPDATE SET role=EXCLUDED.role
            """,
        householdId,
        user,
        role);
  }

  private Authentication auth(UUID user) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, user);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
