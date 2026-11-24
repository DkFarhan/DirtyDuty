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

/** V28 adds hand-off and swap requests to a database that already has chores (E11). */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class ChoreRequestMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v28AddsRequestsWithOneOpenRequestPerOccurrenceAndTheirTemplates() {
    schema = "requests_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("27");
      UUID ana = UUID.randomUUID();
      UUID ben = UUID.randomUUID();
      for (UUID user : new UUID[] {ana, ben}) {
        sql(
            "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
            user, "requests-upgrade-" + user + "@example.test");
      }
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id)"
              + " VALUES (?, 'H', 'UTC', ?)",
          household, ana);
      for (UUID user : new UUID[] {ana, ben}) {
        sql(
            "INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)"
                + " VALUES (?, ?, 'MEMBER', 'ACTIVE', NOW())",
            household, user);
      }
      UUID chore = UUID.randomUUID();
      sql(
          "INSERT INTO %s.chores (id, household_id, title, created_by_user_id) VALUES (?, ?, 'C', ?)",
          chore, household, ana);
      UUID first = UUID.randomUUID();
      UUID second = UUID.randomUUID();
      for (UUID occurrence : new UUID[] {first, second}) {
        sql(
            "INSERT INTO %s.chore_assignments (id, household_id, chore_id, scheduled_for, status,"
                + " title_snapshot, priority_snapshot, difficulty_snapshot)"
                + " VALUES (?, ?, ?, CURRENT_DATE + 1, 'PENDING', 'C', 'NORMAL', 2)",
            occurrence, household, chore);
      }

      migrate("28");

      // Existing chores are untouched.
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.chore_assignments WHERE status='PENDING'"
                      .formatted(schema),
                  Integer.class))
          .isEqualTo(2);
      assertThat(
              jdbc.queryForList(
                  "SELECT event_type FROM %s.notification_templates WHERE event_type LIKE 'REQUEST_%%'"
                      .formatted(schema),
                  String.class))
          .contains(
              "REQUEST_HANDOFF_ASK",
              "REQUEST_SWAP_ASK",
              "REQUEST_ACCEPTED",
              "REQUEST_DECLINED",
              "REQUEST_UNCLAIMED");

      String handOff =
          "INSERT INTO %s.chore_requests (household_id, type, requester_user_id, occurrence_id,"
              + " occurrence_day, occurrence_people, expires_at)"
              + " VALUES (?, 'HANDOFF', ?, ?, CURRENT_DATE + 1, ARRAY[?]::uuid[], NOW() + INTERVAL '1 day')";
      sql(handOff, household, ana, first, ana);
      // One open request per occurrence.
      assertThatThrownBy(() -> sql(handOff, household, ana, first, ana))
          .isInstanceOf(DataIntegrityViolationException.class);
      // A swap names its target and the other chore; nobody asks themselves.
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_requests (household_id, type, requester_user_id,"
                          + " occurrence_id, occurrence_day, occurrence_people, expires_at)"
                          + " VALUES (?, 'SWAP', ?, ?, CURRENT_DATE, ARRAY[?]::uuid[], NOW())",
                      household, ana, second, ana))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.chore_requests (household_id, type, requester_user_id,"
                          + " target_user_id, occurrence_id, occurrence_day, occurrence_people,"
                          + " expires_at) VALUES (?, 'HANDOFF', ?, ?, ?, CURRENT_DATE,"
                          + " ARRAY[?]::uuid[], NOW())",
                      household, ana, ana, second, ana))
          .isInstanceOf(DataIntegrityViolationException.class);
      // Once closed, the occurrence can be asked about again.
      sql(
          "UPDATE %s.chore_requests SET status='CANCELLED', resolved_at=NOW() WHERE occurrence_id=?",
          first);
      sql(handOff, household, ana, first, ana);
      jdbc.update(
          "INSERT INTO %1$s.chore_request_declines (request_id, user_id)".formatted(schema)
              + " SELECT id, ? FROM %1$s.chore_requests WHERE status='OPEN'".formatted(schema),
          ben);
      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.chore_request_declines".formatted(schema),
                  Integer.class))
          .isEqualTo(1);
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
