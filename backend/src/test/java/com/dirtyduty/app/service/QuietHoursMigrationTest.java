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

/** V25 turns quiet hours on only for people who had saved both times, and adds urgent posts. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class QuietHoursMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v25EnablesQuietHoursOnlyWhereBothTimesWereSaved() {
    schema = "quiet_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("24");
      UUID withTimes = user("with");
      UUID withoutTimes = user("without");
      UUID noRow = user("norow");
      UUID sameTimes = user("same");
      sql(
          "INSERT INTO %s.notification_preferences (user_id, quiet_hours_start, quiet_hours_end)"
              + " VALUES (?, '22:00', '07:00')",
          withTimes);
      sql("INSERT INTO %s.notification_preferences (user_id) VALUES (?)", withoutTimes);
      sql(
          "INSERT INTO %s.notification_preferences (user_id, quiet_hours_start, quiet_hours_end)"
              + " VALUES (?, '09:00', '09:00')",
          sameTimes);
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id)"
              + " VALUES (?, 'H', 'UTC', ?)",
          household, withTimes);
      sql(
          "INSERT INTO %s.board_posts (household_id, author_user_id, type, title)"
              + " VALUES (?, ?, 'HEADS_UP', 'Old post')",
          household, withTimes);

      migrate("25");

      assertThat(enabled(withTimes)).isEqualTo("true|22:00:00|07:00:00");
      assertThat(enabled(withoutTimes)).isEqualTo("false||");
      // A start equal to its end never described a window: cleared, and off.
      assertThat(enabled(sameTimes)).isEqualTo("false||");
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.notification_preferences WHERE user_id=?"
                      .formatted(schema),
                  Integer.class,
                  noRow))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "SELECT urgent FROM %s.board_posts".formatted(schema), Boolean.class))
          .isFalse();

      // On needs times; a window's start and end differ.
      assertThatThrownBy(
              () ->
                  sql(
                      "UPDATE %s.notification_preferences SET quiet_hours_enabled=TRUE"
                          + " WHERE user_id=?",
                      withoutTimes))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "UPDATE %s.notification_preferences SET quiet_hours_end='22:00'"
                          + " WHERE user_id=?",
                      withTimes))
          .isInstanceOf(DataIntegrityViolationException.class);
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private String enabled(UUID user) {
    return jdbc.queryForObject(
        ("SELECT quiet_hours_enabled::text || '|' || COALESCE(quiet_hours_start::text, '') || '|'"
                + " || COALESCE(quiet_hours_end::text, '') FROM %s.notification_preferences"
                + " WHERE user_id=?")
            .formatted(schema),
        String.class,
        user);
  }

  private UUID user(String label) {
    UUID id = UUID.randomUUID();
    sql(
        "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
        id, "quiet-upgrade-" + label + "-" + id + "@example.test");
    return id;
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
