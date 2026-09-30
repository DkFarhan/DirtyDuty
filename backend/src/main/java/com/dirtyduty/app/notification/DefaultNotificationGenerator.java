package com.dirtyduty.app.notification;

import java.util.List;
import java.util.UUID;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.springframework.stereotype.Component;

@Component
public class DefaultNotificationGenerator implements NotificationGenerator {
    private final NotificationTemplateResolver templateResolver;

    public DefaultNotificationGenerator(NotificationTemplateResolver templateResolver) {
        this.templateResolver = templateResolver;
    }

    @Override
    public List<NotificationMessage> generate(NotificationEvent event) {
        List<UUID> recipients = event.recipientUserIds() == null
                ? List.of() : event.recipientUserIds();
        return recipients.stream()
                .distinct()
                .map(userId -> {
                    NotificationTemplateResolver.ResolvedTemplate template =
                            templateResolver.resolve(event, userId);
                    if (template == null) {
                        return null;
                    }
                    OffsetDateTime scheduledAt = event.variables() == null
                            ? null : parseScheduledAt(event.variables().get("scheduled_at"));
                    OffsetDateTime expiresAt = event.variables() == null
                            ? null : parseScheduledAt(event.variables().get("expires_at"));
                    String deduplicationKey = String.join(":",
                            event.type(),
                            event.referenceId() == null ? "none" : event.referenceId().toString(),
                            userId.toString(),
                            scheduledAt == null ? "event" : scheduledAt.toInstant().toString());
                    return new NotificationMessage(
                            userId, event.type(), event.category(), "NORMAL",
                            template.title(), template.message(), event.referenceType(), event.referenceId(),
                            scheduledAt, expiresAt, deduplicationKey);
                })
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    private OffsetDateTime parseScheduledAt(String value) {
        return value == null ? null : OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC);
    }
}
