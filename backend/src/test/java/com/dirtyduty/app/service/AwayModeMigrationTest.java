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

/** V26 adds away periods to a database that already has chores and Board posts. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class AwayModeMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v26AddsAwayPeriodsWithoutChangingExistingChoresOrPosts() {
    schema = "away_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("25");
      UUID user = UUID.randomUUID();
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
          user, "away-upgrade-" + user + "@example.test");
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id)"
              + " VALUES (?, 'H', 'UTC', ?)",
          household, user);
      sql(
          "INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)"
              + " VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())",
          household, user);
      UUID chore = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chores (id, household_id, title, created_by_user_id) VALUES (?, ?, 'C', ?)",
          chore, household, user);
      sql(
          "INSERT INTO %s.chore_assignments (household_id, chore_id, scheduled_for, status,"
              + " title_snapshot, priority_snapshot, difficulty_snapshot) VALUES (?, ?, CURRENT_DATE,"
              + " 'PENDING', 'C', 'NORMAL', 1)",
          household, chore);
      sql(
          "INSERT INTO %s.board_posts (household_id, author_user_id, type, title)"
              + " VALUES (?, ?, 'HEADS_UP', 'Old post')",
          household, user);

      migrate("26");

      assertThat(
              jdbc.queryForObject(
                  ("SELECT away_paused::text || '|' || COALESCE(away_from_user_id::text, '')"
                          + " FROM %s.chore_assignments")
                      .formatted(schema),
                  String.class))
          .isEqualTo("false|");
      assertThat(
              jdbc.queryForObject(
                  "SELECT active_until FROM %s.board_posts".formatted(schema), Object.class))
          .isNull();
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.notification_templates WHERE event_type='AWAY_MODE_ENDING'"
                      .formatted(schema),
                  Integer.class))
          .isEqualTo(1);

      String period =
          "INSERT INTO %s.member_away_periods (household_id, user_id, starts_on, ends_on)"
              + " VALUES (?, ?, CURRENT_DATE, CURRENT_DATE + ?)";
      sql(period, household, user, 90);
      assertThatThrownBy(() -> sql(period, household, user, 91))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(() -> sql(period, household, user, -1))
          .isInstanceOf(DataIntegrityViolationException.class);
      // Only a heads-up stays until a date.
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.board_posts (household_id, type, title, event_date,"
                          + " active_until) VALUES (?, 'EVENT', 'E', CURRENT_DATE, CURRENT_DATE)",
                      household))
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
