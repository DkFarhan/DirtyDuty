package com.dirtyduty.app.notification;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class NotificationTemplateResolver {
  private static final Logger logger = LoggerFactory.getLogger(NotificationTemplateResolver.class);
  private static final Pattern VARIABLE = Pattern.compile("\\{([a-z][a-z0-9_]*)}");

  private final JdbcTemplate jdbc;

  public NotificationTemplateResolver(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public ResolvedTemplate resolve(NotificationEvent event, UUID recipientUserId) {
    RecipientContext context =
        jdbc.queryForObject(
            """
                SELECT u.display_name,
                       COALESCE(p.notification_style_override,
                           CASE WHEN COALESCE(p.funny_notifications_enabled, FALSE) THEN 'FUNNY' END,
                           h.notification_style, 'NORMAL') AS style,
                       COALESCE(p.competitive_notifications_enabled, TRUE) AS competitive_enabled,
                       h.name AS household_name
                FROM users u
                LEFT JOIN notification_preferences p ON p.user_id=u.id
                LEFT JOIN household_memberships hm
                    ON hm.user_id=u.id AND hm.household_id=? AND hm.status='ACTIVE'
                LEFT JOIN households h ON h.id=hm.household_id
                WHERE u.id=?
                """,
            (rs, row) ->
                new RecipientContext(
                    rs.getString("display_name"), rs.getString("style"),
                    rs.getBoolean("competitive_enabled"), rs.getString("household_name")),
            event.householdId(),
            recipientUserId);

    if ("COMPETITIVE".equals(event.category()) && !context.competitiveEnabled()) {
      return null;
    }

    Template template =
        jdbc.query(
            """
                SELECT title_template, message_template
                FROM notification_templates
                WHERE event_type=? AND enabled=TRUE AND style IN ('SYSTEM', ?)
                ORDER BY CASE WHEN style=? THEN 0 ELSE 1 END, random()
                LIMIT 1
                """,
            rs ->
                rs.next()
                    ? new Template(rs.getString("title_template"), rs.getString("message_template"))
                    : null,
            event.type(),
            context.style(),
            context.style());
    if (template == null) {
      logger.debug(
          "No enabled notification template for event type {} and style {}",
          event.type(),
          context.style());
      return null;
    }

    Map<String, String> variables = new HashMap<>();
    if (event.variables() != null) {
      variables.putAll(event.variables());
    }
    if (event.actorUserId() != null) {
      String actorName =
          jdbc.queryForObject(
              "SELECT display_name FROM users WHERE id=?", String.class, event.actorUserId());
      variables.put("user_name", actorName);
    } else {
      variables.putIfAbsent("user_name", context.displayName());
    }
    if (context.householdName() != null) {
      variables.put("household_name", context.householdName());
    }

    return new ResolvedTemplate(
        render(template.title(), variables), render(template.message(), variables));
  }

  public boolean hasEnabledTemplate(String eventType, UUID householdId, UUID recipientUserId) {
    Boolean exists =
        jdbc.queryForObject(
            """
                SELECT EXISTS(
                    SELECT 1
                    FROM notification_templates t
                    WHERE t.event_type=? AND t.enabled=TRUE
                      AND t.style IN (
                          'SYSTEM',
                          COALESCE((
                              SELECT COALESCE(p.notification_style_override,
                                  CASE WHEN COALESCE(p.funny_notifications_enabled, FALSE)
                                       THEN 'FUNNY' END,
                                  h.notification_style, 'NORMAL')
                              FROM users u
                              LEFT JOIN notification_preferences p ON p.user_id=u.id
                              LEFT JOIN household_memberships hm
                                  ON hm.user_id=u.id AND hm.household_id=? AND hm.status='ACTIVE'
                              LEFT JOIN households h ON h.id=hm.household_id
                              WHERE u.id=?
                          ), 'NORMAL')
                      )
                )
                """,
            Boolean.class,
            eventType,
            householdId,
            recipientUserId);
    return Boolean.TRUE.equals(exists);
  }

  private String render(String content, Map<String, String> variables) {
    Matcher matcher = VARIABLE.matcher(content);
    StringBuffer rendered = new StringBuffer();
    while (matcher.find()) {
      String value = variables.get(matcher.group(1));
      if (value == null) {
        throw new IllegalStateException(
            "Missing notification template variable: " + matcher.group(1));
      }
      matcher.appendReplacement(rendered, Matcher.quoteReplacement(value));
    }
    matcher.appendTail(rendered);
    return rendered.toString();
  }

  public record ResolvedTemplate(String title, String message) {}

  private record Template(String title, String message) {}

  private record RecipientContext(
      String displayName, String style, boolean competitiveEnabled, String householdName) {}
}
