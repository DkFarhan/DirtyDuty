package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
class NotificationPersonalityPackIntegrationTest {
  private static final List<String> EVENTS =
      List.of("CHORE_DUE_SOON", "CHORE_DUE_NOW", "CHORE_OVERDUE");
  private static final List<String> STYLES =
      List.of("NORMAL", "FUNNY", "MOTIVATIONAL", "COMPETITIVE", "MINIMAL");
  private static final Map<String, Integer> EXPECTED_STYLE_COUNTS =
      Map.of("NORMAL", 15, "FUNNY", 50, "MOTIVATIONAL", 15, "COMPETITIVE", 15, "MINIMAL", 15);
  private static final Map<String, String> TITLES =
      Map.of(
          "CHORE_DUE_SOON",
          "Chore due soon",
          "CHORE_DUE_NOW",
          "Chore due now",
          "CHORE_OVERDUE",
          "Chore overdue");

  @Autowired private JdbcTemplate jdbc;

  @Autowired private NotificationTemplateResolver resolver;

  @Test
  void seedsEveryPersonalityPoolAndResolvesEveryEventStyleCombination() {
    assertThat(
            jdbc.queryForObject(
                """
                SELECT COUNT(*)
                FROM notification_templates
                WHERE enabled=TRUE
                  AND event_type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                  AND style IN ('NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')
                """,
                Integer.class))
        .isEqualTo(330);
    assertThat(
            jdbc.queryForObject(
                """
                SELECT COUNT(DISTINCT (event_type, style, message_template))
                FROM notification_templates
                WHERE enabled=TRUE
                  AND event_type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                  AND style IN ('NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')
                """,
                Integer.class))
        .isEqualTo(330);

    for (String eventType : EVENTS) {
      for (String style : STYLES) {
        assertThat(
                jdbc.queryForObject(
                    """
                        SELECT COUNT(*)
                        FROM notification_templates
                        WHERE event_type=? AND style=? AND enabled=TRUE
                        """,
                    Integer.class,
                    eventType,
                    style))
            .as("%s/%s active templates", eventType, style)
            .isEqualTo(EXPECTED_STYLE_COUNTS.get(style));
      }
    }

    assertSimpleSystemTemplatesRemainUnchanged();
    assertResolverUsesPersonalityTemplates();
  }

  private void assertSimpleSystemTemplatesRemainUnchanged() {
    Map<String, String> systemTemplates =
        jdbc.query(
            """
                SELECT event_type, message_template
                FROM notification_templates
                WHERE style='SYSTEM'
                  AND event_type IN ('CHORE_ASSIGNED', 'CHORE_COMPLETED', 'HOUSEHOLD_JOINED', 'INVITE_ACCEPTED')
                """,
            rs -> {
              Map<String, String> templates = new java.util.HashMap<>();
              while (rs.next()) {
                templates.put(rs.getString("event_type"), rs.getString("message_template"));
              }
              return templates;
            });
    assertThat(systemTemplates)
        .containsExactlyInAnyOrderEntriesOf(
            Map.of(
                "CHORE_ASSIGNED", "You have been assigned {chore_name}",
                "CHORE_COMPLETED", "{user_name} completed {chore_name}",
                "HOUSEHOLD_JOINED", "{user_name} joined your household",
                "INVITE_ACCEPTED", "{user_name} accepted your invitation"));
  }

  private void assertResolverUsesPersonalityTemplates() {
    UUID userId = UUID.randomUUID();
    UUID householdId = UUID.randomUUID();
    try {
      jdbc.update(
          """
                    INSERT INTO users (id, email, password_hash, display_name)
                    VALUES (?, ?, 'verification-only', 'Pack Test User')
                    """,
          userId,
          "pack-test-" + userId + "@example.com");
      jdbc.update(
          """
                    INSERT INTO households (id, name, created_by_user_id)
                    VALUES (?, 'Pack Verification Home', ?)
                    """,
          householdId,
          userId);
      jdbc.update(
          """
                    INSERT INTO household_memberships (household_id, user_id, role, status)
                    VALUES (?, ?, 'OWNER', 'ACTIVE')
                    """,
          householdId,
          userId);

      for (String style : STYLES) {
        jdbc.update("UPDATE households SET notification_style=? WHERE id=?", style, householdId);
        for (String eventType : EVENTS) {
          NotificationEvent event =
              new NotificationEvent(
                  eventType,
                  null,
                  householdId,
                  "CHORE_ASSIGNMENT",
                  UUID.randomUUID(),
                  "CHORE_REMINDER",
                  Map.of("chore_name", "Kitchen", "due_time", "18:30", "hours_late", "2"),
                  List.of(userId));

          NotificationTemplateResolver.ResolvedTemplate resolved = resolver.resolve(event, userId);
          assertThat(resolved).isNotNull();
          assertThat(resolved.title()).isEqualTo(TITLES.get(eventType));
          assertThat(resolved.message()).doesNotContain("{", "}");
        }
      }
    } finally {
      jdbc.update(
          "DELETE FROM household_memberships WHERE household_id=? AND user_id=?",
          householdId,
          userId);
      jdbc.update("DELETE FROM households WHERE id=?", householdId);
      jdbc.update("DELETE FROM users WHERE id=?", userId);
    }
  }
}
