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

/** V24 adds board lists to a database that already has households, posts and notifications. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class BoardListsMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  private String schema;

  @Test
  void v24AddsListTablesConstraintsAndTheTodayTemplateWithoutTouchingExistingData() {
    schema = "lists_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate("23");
      UUID user = UUID.randomUUID();
      UUID household = UUID.randomUUID();
      sql(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')",
          user, "lists-upgrade-" + user + "@example.test");
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
          "INSERT INTO %s.board_posts (household_id, author_user_id, type, title)"
              + " VALUES (?, ?, 'HEADS_UP', 'Existing post')",
          household, user);
      int templatesBefore = single("SELECT COUNT(*) FROM %s.notification_templates");

      migrate("24");

      // Existing data stays; no list is backfilled (Shopping is created on first use).
      assertThat(single("SELECT COUNT(*) FROM %s.board_posts")).isEqualTo(1);
      assertThat(single("SELECT COUNT(*) FROM %s.board_lists")).isZero();
      assertThat(single("SELECT COUNT(*) FROM %s.notification_templates"))
          .isEqualTo(templatesBefore + 1);
      assertThat(
              jdbc.queryForObject(
                  ("SELECT message_template FROM %s.notification_templates"
                          + " WHERE event_type='BOARD_LIST_NEEDED_TODAY'")
                      .formatted(schema),
                  String.class))
          .isEqualTo("{user_name} needs {item_names} today");

      // One default list per household, never archived.
      UUID shopping = list(household, "Shopping", true);
      assertThatThrownBy(() -> list(household, "Other default", true))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () -> sql("UPDATE %s.board_lists SET archived_at=NOW() WHERE id=?", shopping))
          .isInstanceOf(DataIntegrityViolationException.class);
      // Active names are unique ignoring case; an archived name can be used again.
      UUID party = list(household, "Party", false);
      assertThatThrownBy(() -> list(household, " PARTY ", false))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql("UPDATE %s.board_lists SET archived_at=NOW() WHERE id=?", party);
      list(household, "party", false);

      // An open name is on a list once; a bought one doesn't block it.
      UUID milk = item(shopping, household, "Milk");
      assertThatThrownBy(() -> item(shopping, household, "milk"))
          .isInstanceOf(DataIntegrityViolationException.class);
      sql(
          "UPDATE %s.board_list_items SET bought_at=NOW(), bought_on=CURRENT_DATE WHERE id=?",
          milk);
      item(shopping, household, "milk");
      // A flag has its day; a bought time has its day.
      assertThatThrownBy(
              () -> sql("UPDATE %s.board_list_items SET needed_today_at=NOW() WHERE id=?", milk))
          .isInstanceOf(DataIntegrityViolationException.class);
      assertThatThrownBy(
              () -> sql("UPDATE %s.board_list_items SET bought_on=NULL WHERE id=?", milk))
          .isInstanceOf(DataIntegrityViolationException.class);

      // Deleting the household takes its lists, items and remembered names along.
      sql(
          "INSERT INTO %s.board_list_item_names (household_id, name_key, name, last_added_at)"
              + " VALUES (?, 'milk', 'Milk', NOW())",
          household);
      sql("DELETE FROM %s.board_posts WHERE household_id=?", household);
      sql("DELETE FROM %s.household_memberships WHERE household_id=?", household);
      sql("DELETE FROM %s.households WHERE id=?", household);
      assertThat(single("SELECT COUNT(*) FROM %s.board_lists")).isZero();
      assertThat(single("SELECT COUNT(*) FROM %s.board_list_items")).isZero();
      assertThat(single("SELECT COUNT(*) FROM %s.board_list_item_names")).isZero();
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private UUID list(UUID household, String name, boolean isDefault) {
    UUID id = UUID.randomUUID();
    sql(
        "INSERT INTO %s.board_lists (id, household_id, name, is_default) VALUES (?, ?, ?, ?)",
        id, household, name, isDefault);
    return id;
  }

  private UUID item(UUID list, UUID household, String name) {
    UUID id = UUID.randomUUID();
    sql(
        "INSERT INTO %s.board_list_items (id, list_id, household_id, name) VALUES (?, ?, ?, ?)",
        id, list, household, name);
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
