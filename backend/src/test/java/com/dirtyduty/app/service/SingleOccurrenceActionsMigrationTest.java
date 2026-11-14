package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.notification.WebPushClient;
import java.time.LocalDate;
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

/** V21 upgrades a database that already has occurrences without changing their meaning. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class SingleOccurrenceActionsMigrationTest {
  @Autowired private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;

  @Test
  void v21BackfillsPlannedDatesMovesTheUniqueIndexAndKeepsOldInsertsWorking() {
    String schema = "occurrence_upgrade_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.execute("CREATE SCHEMA " + schema);
    try {
      migrate(schema, "20");
      UUID user = UUID.randomUUID();
      UUID household = UUID.randomUUID();
      UUID chore = UUID.randomUUID();
      UUID schedule = UUID.randomUUID();
      LocalDate day = LocalDate.of(2026, 11, 2);
      jdbc.update(
          "INSERT INTO %s.users (id, email, password_hash, display_name) VALUES (?, ?, 'h', 'U')"
              .formatted(schema),
          user,
          "upgrade-" + user + "@example.test");
      jdbc.update(
          "INSERT INTO %s.households (id, name, timezone, created_by_user_id) VALUES (?, 'H', 'UTC', ?)"
              .formatted(schema),
          household,
          user);
      jdbc.update(
          """
              INSERT INTO %s.household_memberships (household_id, user_id, role, status, joined_at)
              VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
              """
              .formatted(schema),
          household,
          user);
      jdbc.update(
          """
              INSERT INTO %s.chores (id, household_id, title, default_priority, difficulty,
                                     created_by_user_id)
              VALUES (?, ?, 'Bins', 'NORMAL', 1, ?)
              """
              .formatted(schema),
          chore,
          household,
          user);
      jdbc.update(
          """
              INSERT INTO %s.chore_schedules
                  (id, household_id, chore_id, recurrence_rule, timezone, starts_on,
                   assignment_strategy, fixed_assignee_user_id, strategy_config)
              VALUES (?, ?, ?, 'FREQ=WEEKLY;BYDAY=MO', 'UTC', ?, 'FIXED', ?,
                      '{"peopleNeeded":1}'::jsonb)
              """
              .formatted(schema),
          schedule,
          household,
          chore,
          day,
          user);
      List<String> statuses = List.of("COMPLETED", "CANCELLED", "PENDING");
      for (int week = 0; week < statuses.size(); week++) {
        insertOccurrence(
            schema, household, chore, schedule, user, day.plusWeeks(week), statuses.get(week));
      }

      migrate(schema, "21");

      assertThat(
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM %s.chore_assignments WHERE planned_for=scheduled_for"
                      .formatted(schema),
                  Integer.class))
          .isEqualTo(3);
      assertThat(
              jdbc.queryForList(
                  "SELECT status FROM %s.chore_assignments ORDER BY scheduled_for"
                      .formatted(schema),
                  String.class))
          .containsExactlyElementsOf(statuses);
      assertThat(
              jdbc.queryForObject(
                  """
                      SELECT COUNT(*) FROM %s.chore_assignments
                      WHERE date_overridden OR assignees_overridden
                      """
                      .formatted(schema),
                  Integer.class))
          .isZero();
      assertThat(indexes(schema))
          .contains("ux_schedule_planned_occurrence", "ix_assignments_schedule_day")
          .doesNotContain("ux_schedule_occurrence");

      // An insert written before V21 (no planned_for) is planned on its own day by the trigger.
      UUID later =
          insertOccurrence(schema, household, chore, schedule, user, day.plusWeeks(3), "PENDING");
      assertThat(
              jdbc.queryForObject(
                  "SELECT planned_for FROM %s.chore_assignments WHERE id=?".formatted(schema),
                  LocalDate.class,
                  later))
          .isEqualTo(day.plusWeeks(3));
      // One occurrence per planned day; a moved one may share an effective day with another.
      assertThatThrownBy(
              () ->
                  insertOccurrence(
                      schema, household, chore, schedule, user, day.plusWeeks(3), "PENDING"))
          .isInstanceOf(DataIntegrityViolationException.class);
      jdbc.update(
          "UPDATE %s.chore_assignments SET scheduled_for=? WHERE id=?".formatted(schema),
          day.plusWeeks(2),
          later);

      assertThat(
              jdbc.queryForList(
                  """
                      SELECT event_type FROM %s.notification_templates
                      WHERE event_type IN ('CHORE_OCCURRENCE_MOVED','CHORE_OCCURRENCE_SKIPPED')
                      ORDER BY event_type
                      """
                      .formatted(schema),
                  String.class))
          .containsExactly("CHORE_OCCURRENCE_MOVED", "CHORE_OCCURRENCE_SKIPPED");
      assertThat(
              jdbc.queryForList(
                  """
                      SELECT column_name FROM information_schema.columns
                      WHERE table_schema=? AND table_name='chore_schedules'
                        AND column_name IN ('count_rebased_on','count_produced_before')
                      """,
                  String.class,
                  schema))
          .hasSize(2);
    } finally {
      jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private void migrate(String schema, String version) {
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

  private List<String> indexes(String schema) {
    return jdbc.queryForList(
        "SELECT indexname FROM pg_indexes WHERE schemaname=? AND tablename='chore_assignments'",
        String.class,
        schema);
  }
}
