package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.notification.WebPushClient;
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

/** V27 backfills effort points on a database that already has completions, and allows BALANCED. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class EffortPointsMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v27BackfillsEffortPointsFromTheOccurrenceSnapshot() {
    schema = "effort_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("26");
      UUID user = UUID.randomUUID();
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
          user, "effort-upgrade-" + user + "@example.test");
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id)"
              + " VALUES (?, 'H', 'UTC', ?)",
          household, user);
      sql(
          "INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)"
              + " VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())",
          household, user);
      // The chore is now effort 4, but it was 2 when this occurrence was done.
      UUID chore = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chores (id, household_id, title, created_by_user_id, difficulty)"
              + " VALUES (?, ?, 'C', ?, 4)",
          chore, household, user);
      UUID occurrence = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chore_assignments (id, household_id, chore_id, scheduled_for, status,"
              + " title_snapshot, priority_snapshot, difficulty_snapshot)"
              + " VALUES (?, ?, ?, CURRENT_DATE - 1, 'COMPLETED', 'C', 'NORMAL', 2)",
          occurrence, household, chore);
      sql(
          "INSERT INTO %s.chore_completions (household_id, assignment_id, completed_by_user_id)"
              + " VALUES (?, ?, ?)",
          household, occurrence, user);

      migrate("27");

      assertThat(
              jdbc.queryForObject(
                  "SELECT effort_points FROM %s.chore_completions".formatted(schema),
                  Integer.class))
          .isEqualTo(2);
      // Required from now on, and within 1-5.
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_completions (household_id, assignment_id,"
                          + " completed_by_user_id, attempt_number) VALUES (?, ?, ?, 2)",
                      household, occurrence, user))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_completions (household_id, assignment_id,"
                          + " completed_by_user_id, attempt_number, effort_points)"
                          + " VALUES (?, ?, ?, 2, 6)",
                      household, occurrence, user))
          .isInstanceOf(DataIntegrityViolationException.class);

      // BALANCED is a valid strategy for calendar chores, never for "When needed".
      sql(
          "INSERT INTO %s.chore_schedules (household_id, chore_id, recurrence_rule, timezone,"
              + " starts_on, assignment_strategy) VALUES (?, ?, 'FREQ=DAILY', 'UTC',"
              + " CURRENT_DATE, 'BALANCED')",
          household, chore);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_schedules (household_id, chore_id, timezone,"
                          + " starts_on, assignment_strategy, kind) VALUES (?, ?, 'UTC',"
                          + " CURRENT_DATE, 'BALANCED', 'AS_NEEDED')",
                      household, chore))
          .isInstanceOf(DataIntegrityViolationException.class);
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private void sql(String statement, Object... args) {
    jdbc.update(statement.formatted(schema), args);
  }

  private void migrate(String version) {
    Flyway.configure()
        .dataSource(Objects.requireNonNull(jdbc.getDataSource()))
        .schemas(schema)
        .defaultSchema(schema)
        .locations("classpath:db/migration")
        .target(MigrationVersion.fromVersion(version))
        .load()
        .migrate();
  }
}
