package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.notification.WebPushClient;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** V22 upgrades a database with chores, occurrences and completions without changing them. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class ChoreKindsMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  @Test
  void v22MakesEveryExistingChoreCalendarAndEnforcesOneOpenCopyForTheNewKinds() {
    String schema = "kinds_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate(schema, "21");
      UUID user = UUID.randomUUID();
      UUID household = UUID.randomUUID();
      UUID chore = UUID.randomUUID();
      UUID schedule = UUID.randomUUID();
      LocalDate day = LocalDate.of(2026, 11, 2);
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
          user, "kinds-upgrade-" + user + "@example.test");
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id) VALUES (?, 'H', 'UTC', ?)",
          household, user);
      sql(
          """
              INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)
              VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
              """,
          household, user);
      sql(
          """
              INSERT INTO %s.chores (id, household_id, title, default_priority, difficulty,
                                     created_by_user_id)
              VALUES (?, ?, 'Bins', 'NORMAL', 1, ?)
              """,
          chore, household, user);
      sql(
          """
              INSERT INTO %s.chore_schedules
                  (id, household_id, chore_id, recurrence_rule, timezone, starts_on,
                   assignment_strategy, fixed_assignee_user_id, strategy_config)
              VALUES (?, ?, ?, 'FREQ=WEEKLY;BYDAY=MO', 'UTC', ?, 'FIXED', ?,
                      '{"peopleNeeded":1}'::jsonb)
              """,
          schedule, household, chore, day, user);
      UUID done = insertOccurrence(schema, household, chore, schedule, user, day, "COMPLETED");
      insertOccurrence(schema, household, chore, schedule, user, day.plusWeeks(1), "PENDING");
      sql(
          """
              INSERT INTO %s.chore_completions (household_id, assignment_id, completed_by_user_id)
              VALUES (?, ?, ?)
              """,
          household, done, user);

      migrate(schema, "22");

      assertThat(single("SELECT kind FROM %s.chore_schedules", String.class)).isEqualTo("CALENDAR");
      assertThat(
              jdbc.queryForList(
                  "SELECT DISTINCT kind_snapshot FROM %s.chore_assignments".formatted(schema),
                  String.class))
          .containsExactly("CALENDAR");
      assertThat(
              single(
                  "SELECT COUNT(*) FROM %s.chore_assignments WHERE flagged_at IS NOT NULL",
                  Integer.class))
          .isZero();
      assertThat(single("SELECT COUNT(*) FROM %s.chore_completions", Integer.class)).isEqualTo(1);
      assertThat(
              jdbc.queryForList(
                  "SELECT indexname FROM pg_indexes WHERE schemaname=? AND tablename='chore_assignments'",
                  String.class,
                  schema))
          .contains("ux_schedule_planned_occurrence", "ux_schedule_single_open_occurrence");
      assertThat(
              jdbc.queryForList(
                  """
                      SELECT event_type FROM %s.notification_templates
                      WHERE event_type IN ('CHORE_NEEDS_DOING','CHORE_TURN') ORDER BY event_type
                      """
                      .formatted(schema),
                  String.class))
          .containsExactly("CHORE_NEEDS_DOING", "CHORE_TURN");

      // Calendar rows keep one occurrence per planned day.
      assertThatThrownBy(
              () -> insertOccurrence(schema, household, chore, schedule, user, day, "PENDING"))
          .isInstanceOf(DataIntegrityViolationException.class);

      // Settings must match the kind.
      assertThatThrownBy(
              () -> sql("UPDATE %s.chore_schedules SET kind='AS_NEEDED' WHERE id=?", schedule))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql(
          """
              UPDATE %s.chore_schedules
              SET kind='AFTER_COMPLETION', recurrence_rule=NULL, interval_count=3,
                  interval_unit='DAY'
              WHERE id=?
              """,
          schedule);
      assertThatThrownBy(
              () -> sql("UPDATE %s.chore_schedules SET interval_count=366 WHERE id=?", schedule))
          .isInstanceOf(DataIntegrityViolationException.class);

      // The new kinds may plan the same day again but never have two open copies.
      sql("UPDATE %s.chore_assignments SET status='CANCELLED' WHERE status='PENDING'");
      UUID open =
          insertOccurrence(
              schema, household, chore, schedule, user, day, "PENDING", "AFTER_COMPLETION");
      assertThatThrownBy(
              () ->
                  insertOccurrence(
                      schema,
                      household,
                      chore,
                      schedule,
                      user,
                      day.plusDays(1),
                      "PENDING",
                      "AFTER_COMPLETION"))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql("UPDATE %s.chore_assignments SET status='COMPLETED' WHERE id=?", open);
      insertOccurrence(
          schema, household, chore, schedule, user, day, "PENDING", "AFTER_COMPLETION");

      // A flag needs who and when, and only exists on When needed occurrences.
      assertThatThrownBy(
              () ->
                  sql(
                      "UPDATE %s.chore_assignments SET flagged_at=NOW(), flagged_by_user_id=? WHERE id=?",
                      user, open))
          .isInstanceOf(DataIntegrityViolationException.class);
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private void sql(String statement, Object... args) {
    jdbc.update(statement.formatted(currentSchema), args);
  }

  private <T> T single(String query, Class<T> type) {
    return jdbc.queryForObject(query.formatted(currentSchema), type);
  }

  private String currentSchema;

  private void migrate(String schema, String version) {
    currentSchema = schema;
    Flyway.configure()
        .dataSource(Objects.requireNonNull(jdbc.getDataSource()))
        .schemas(schema)
        .defaultSchema(schema)
        .locations("classpath:db/migration")
        .target(MigrationVersion.fromVersion(version))
        .load()
        .migrate();
  }

  private UUID insertOccurrence(
      String schema,
      UUID household,
      UUID chore,
      UUID schedule,
      UUID user,
      LocalDate day,
      String status) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO %s.chore_assignments
                (id, household_id, chore_id, schedule_id, assigned_to_user_id, scheduled_for,
                 status, title_snapshot, priority_snapshot, difficulty_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Bins', 'NORMAL', 1)
            """
            .formatted(schema),
        id,
        household,
        chore,
        schedule,
        user,
        day,
        status);
    return id;
  }

  private UUID insertOccurrence(
      String schema,
      UUID household,
      UUID chore,
      UUID schedule,
      UUID user,
      LocalDate day,
      String status,
      String kind) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO %s.chore_assignments
                (id, household_id, chore_id, schedule_id, assigned_to_user_id, scheduled_for,
                 status, title_snapshot, priority_snapshot, difficulty_snapshot, kind_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Bins', 'NORMAL', 1, ?)
            """
            .formatted(schema),
        id,
        household,
        chore,
        schedule,
        user,
        day,
        status,
        kind);
    return id;
  }
}
