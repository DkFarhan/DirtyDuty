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

/** V23 adds the board to a database that already has households, chores and notifications. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class BoardPostsMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v23AddsBoardTablesTemplatesAndTypeChecksWithoutTouchingExistingData() {
    schema = "board_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("22");
      UUID user = UUID.randomUUID();
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
          user, "board-upgrade-" + user + "@example.test");
      sql(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id) VALUES (?, 'H', 'UTC', ?)",
          household, user);
      sql(
          """
              INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)
              VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
              """,
          household, user);
      int templatesBefore = single("SELECT COUNT(*) FROM %s.notification_templates");

      migrate("23");

      assertThat(single("SELECT COUNT(*) FROM %s.household_memberships")).isEqualTo(1);
      assertThat(single("SELECT COUNT(*) FROM %s.notification_templates"))
          .isEqualTo(templatesBefore + 4);
      assertThat(
              jdbc.queryForList(
                  "SELECT indexname FROM pg_indexes WHERE schemaname=? AND tablename='board_posts'",
                  String.class,
                  schema))
          .contains(
              "ix_board_posts_household_active",
              "ix_board_posts_household_past",
              "ix_board_posts_past_at");

      // Every event has a date; nothing else does.
      LocalDate day = LocalDate.of(2026, 12, 1);
      assertThatThrownBy(() -> insert(household, user, "EVENT", null, false, null))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(() -> insert(household, user, "PROBLEM", day, false, null))
          .isInstanceOf(DataIntegrityViolationException.class);
      UUID event = insert(household, user, "EVENT", day, false, null);
      // Only problems have a handler or get fixed; pinned posts never move to Past.
      assertThatThrownBy(
              () -> sql("UPDATE %s.board_posts SET handler_user_id=? WHERE id=?", user, event))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(() -> sql("UPDATE %s.board_posts SET fixed_at=NOW() WHERE id=?", event))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(() -> insert(household, user, "HEADS_UP", null, true, "NOW()"))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(() -> sql("UPDATE %s.board_posts SET end_time='09:00' WHERE id=?", event))
          .isInstanceOf(DataIntegrityViolationException.class);

      // Reads are unique per person; deleting the household takes its posts and reads along.
      sql(
          "INSERT INTO %s.board_post_reads (post_id, user_id, seen_at) VALUES (?, ?, NOW())",
          event, user);
      assertThatThrownBy(
              () ->
                  sql(
                      "INSERT INTO %s.board_post_reads (post_id, user_id, seen_at) VALUES (?, ?, NOW())",
                      event, user))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql("DELETE FROM %s.household_memberships WHERE household_id=?", household);
      sql("DELETE FROM %s.households WHERE id=?", household);
      assertThat(single("SELECT COUNT(*) FROM %s.board_posts")).isZero();
      assertThat(single("SELECT COUNT(*) FROM %s.board_post_reads")).isZero();
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private UUID insert(
      UUID household, UUID user, String type, LocalDate day, boolean pinned, String pastAt) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        ("INSERT INTO %s.board_posts (id, household_id, author_user_id, type, title, event_date,"
                + " pinned, past_at) VALUES (?, ?, ?, ?, 'Post', ?, ?, "
                + (pastAt == null ? "NULL" : pastAt)
                + ")")
            .formatted(schema),
        id,
        household,
        user,
        type,
        day,
        pinned);
    return id;
  }

  private void sql(String statement, Object... args) {
    jdbc.update(statement.formatted(schema), args);
  }

  private int single(String query) {
    Integer value = jdbc.queryForObject(query.formatted(schema), Integer.class);
    return value == null ? 0 : value;
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
