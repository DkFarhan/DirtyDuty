package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.notification.WebPushClient;
import java.util.List;
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

/** V30 adds reminder levels (E13) to a database that already has households and chores. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class ReminderLevelsMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v30WidensTheModesSeedsTheRulesAndKeepsExistingChoresOnFull() {
    schema = "reminder_levels_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("29");
      UUID ana = UUID.randomUUID();
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'Ana')",
          ana, "levels-upgrade-" + ana + "@example.test");
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

      migrate("30");

      // Existing chores keep the reminders they had; the household default is Standard.
      assertThat(value("SELECT reminder_mode FROM %s.chores WHERE id=?", chore))
          .isEqualTo("AGGRESSIVE");
      assertThat(value("SELECT default_reminder_mode FROM %s.households WHERE id=?", household))
          .isEqualTo("STANDARD");
      assertThat(value("SELECT reminder_mode FROM %s.households WHERE id=?", household))
          .isEqualTo("AGGRESSIVE");
      UUID fresh = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chores (id, household_id, title, created_by_user_id) VALUES (?, ?, 'N', ?)",
          fresh, household, ana);
      assertThat(value("SELECT reminder_mode FROM %s.chores WHERE id=?", fresh))
          .isEqualTo("STANDARD");

      // Every reminder-mode CHECK takes OFF and INTENSE (CUSTOM stays), and nothing else.
      for (String mode : List.of("OFF", "INTENSE", "CUSTOM")) {
        sql("UPDATE %s.chores SET reminder_mode=? WHERE id=?", mode, chore);
        sql(
            "UPDATE %s.households SET reminder_mode=?, default_reminder_mode=? WHERE id=?",
            mode, mode, household);
      }
      assertThatThrownBy(() -> sql("UPDATE %s.chores SET reminder_mode='LOUD' WHERE id=?", chore))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "UPDATE %s.households SET default_reminder_mode='LOUD' WHERE id=?",
                      household))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () -> sql("UPDATE %s.households SET reminder_mode='LOUD' WHERE id=?", household))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.notification_reminder_rules"
                          + " (mode, event_type, minutes_before_due) VALUES ('LOUD', 'X', 1)"))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql(
          "INSERT INTO %s.notification_reminder_rules (mode, event_type, minutes_before_due)"
              + " VALUES ('OFF', 'PROBE', 1)");
      sql("DELETE FROM %s.notification_reminder_rules WHERE event_type='PROBE'");

      assertThat(
              jdbc.queryForList(
                  """
                      SELECT mode || ':' || event_type || ':' || minutes_before_due
                      FROM %s.notification_reminder_rules WHERE enabled
                      ORDER BY mode, event_type, minutes_before_due DESC
                      """
                      .formatted(schema),
                  String.class))
          .containsExactly(
              "AGGRESSIVE:CHORE_DUE_NOW:0",
              "AGGRESSIVE:CHORE_DUE_SOON:1440",
              "AGGRESSIVE:CHORE_DUE_SOON:360",
              "AGGRESSIVE:CHORE_DUE_SOON:60",
              "AGGRESSIVE:CHORE_OVERDUE:-60",
              "AGGRESSIVE:CHORE_OVERDUE:-180",
              "FRIENDLY:CHORE_DUE_NOW:0",
              "FRIENDLY:CHORE_OVERDUE:-720",
              "INTENSE:CHORE_DUE_NOW:0",
              "INTENSE:CHORE_DUE_SOON:2880",
              "INTENSE:CHORE_DUE_SOON:1440",
              "INTENSE:CHORE_DUE_SOON:720",
              "INTENSE:CHORE_DUE_SOON:360",
              "INTENSE:CHORE_DUE_SOON:120",
              "INTENSE:CHORE_DUE_SOON:60",
              "INTENSE:CHORE_OVERDUE:-60",
              "INTENSE:CHORE_OVERDUE:-180",
              "INTENSE:CHORE_OVERDUE:-360",
              "INTENSE:CHORE_OVERDUE:-600",
              "STANDARD:CHORE_DUE_NOW:0",
              "STANDARD:CHORE_DUE_SOON:360",
              "STANDARD:CHORE_OVERDUE:-180");
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private String value(String query, UUID id) {
    return jdbc.queryForObject(query.formatted(schema), String.class, id);
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
