package com.dirtyduty.app.notification;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DefaultNotificationGenerator implements NotificationGenerator {
  private final NotificationTemplateResolver templateResolver;
  private final JdbcTemplate jdbc;

  public DefaultNotificationGenerator(
      NotificationTemplateResolver templateResolver, JdbcTemplate jdbc) {
    this.templateResolver = templateResolver;
    this.jdbc = jdbc;
  }

  @Override
  public List<NotificationMessage> generate(NotificationEvent event) {
    List<UUID> recipients = event.recipientUserIds() == null ? List.of() : event.recipientUserIds();
    if (event.householdId() != null && !recipients.isEmpty()) {
      Set<UUID> activeRecipients =
          Set.copyOf(
              jdbc.query(
                  "SELECT user_id FROM household_memberships WHERE household_id=? AND status='ACTIVE'",
                  (rs, rowNum) -> rs.getObject("user_id", UUID.class),
                  event.householdId()));
      recipients = recipients.stream().filter(activeRecipients::contains).toList();
    }
    return recipients.stream()
        .distinct()
        .map(
            userId -> {
              NotificationTemplateResolver.ResolvedTemplate template =
                  templateResolver.resolve(event, userId);
              if (template == null) {
                return null;
              }
              OffsetDateTime scheduledAt =
                  event.variables() == null
                      ? null
                      : parseScheduledAt(event.variables().get("scheduled_at"));
              OffsetDateTime expiresAt =
                  event.variables() == null
                      ? null
                      : parseScheduledAt(event.variables().get("expires_at"));
              String deduplicationKey =
                  String.join(
                      ":",
                      event.type(),
                      event.referenceId() == null ? "none" : event.referenceId().toString(),
                      userId.toString(),
                      scheduledAt == null ? "event" : scheduledAt.toInstant().toString());
              return new NotificationMessage(
                  userId,
                  event.type(),
                  event.category(),
                  "NORMAL",
                  template.title(),
                  template.message(),
                  event.referenceType(),
                  event.referenceId(),
                  scheduledAt,
                  expiresAt,
                  deduplicationKey);
            })
        .filter(java.util.Objects::nonNull)
        .toList();
  }

  private OffsetDateTime parseScheduledAt(String value) {
    return value == null ? null : OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC);
  }
}
