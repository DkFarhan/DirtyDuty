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

/** V29 adds checklists (E12) to a database that already has chores and occurrences. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class ChecklistMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v29AddsStepsAndPerOccurrenceTicksWithoutTouchingExistingChores() {
    schema = "checklist_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("28");
      UUID ana = UUID.randomUUID();
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'Ana')",
          ana, "checklist-upgrade-" + ana + "@example.test");
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id)"
              + " VALUES (?, 'H', 'UTC', ?)",
          household, ana);
      sql(
          "INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)"
              + " VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())",
          household, ana);
      UUID chore = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chores (id, household_id, title, created_by_user_id) VALUES (?, ?, 'C', ?)",
          chore, household, ana);
      UUID done = UUID.randomUUID();
      UUID open = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chore_assignments (id, household_id, chore_id, scheduled_for, status,"
              + " title_snapshot, priority_snapshot, difficulty_snapshot)"
              + " VALUES (?, ?, ?, CURRENT_DATE - 1, 'COMPLETED', 'C', 'NORMAL', 2),"
              + " (?, ?, ?, CURRENT_DATE + 1, 'PENDING', 'C', 'NORMAL', 2)",
          done, household, chore, open, household, chore);

      migrate("29");

      // Existing occurrences have no checklist and no snapshot.
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.chore_assignments WHERE steps_total IS NULL"
                      .formatted(schema),
                  Integer.class))
          .isEqualTo(2);

      UUID step = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chore_steps (id, chore_id, position, text) VALUES (?, ?, 0, 'Sink')",
          step, chore);
      // 1 to 80 characters, at most 15 positions, one step per position.
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_steps (chore_id, position, text) VALUES (?, 1, ?)",
                      chore, "x".repeat(81)))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_steps (chore_id, position, text) VALUES (?, 1, '  ')",
                      chore))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_steps (chore_id, position, text) VALUES (?, 15, 'x')",
                      chore))
          .isInstanceOf(DataIntegrityViolationException.class);

      String tick =
          "INSERT INTO %s.chore_step_ticks (occurrence_id, step_id, ticked_by_user_id)"
              + " VALUES (?, ?, ?)";
      sql(tick, open, step, ana);
      // One tick per occurrence and step.
      assertThatThrownBy(() -> sql(tick, open, step, ana))
          .isInstanceOf(DataIntegrityViolationException.class);
      // The snapshot never claims more ticked than there were steps.
      assertThatThrownBy(
              () ->
                  sql(
                      "UPDATE %s.chore_assignments SET steps_total=2, steps_ticked=3 WHERE id=?",
                      done))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql("UPDATE %s.chore_assignments SET steps_total=5, steps_ticked=4 WHERE id=?", done);

      // Removing a step takes its ticks; the snapshot stays.
      sql("DELETE FROM %s.chore_steps WHERE id=?", step);
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.chore_step_ticks".formatted(schema), Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "SELECT steps_ticked FROM %s.chore_assignments WHERE id=?".formatted(schema),
                  Integer.class,
                  done))
          .isEqualTo(4);
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
