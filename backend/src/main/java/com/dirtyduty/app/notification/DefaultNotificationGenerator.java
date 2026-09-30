package com.dirtyduty.app.notification;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class DefaultNotificationGenerator implements NotificationGenerator {
    @Override
    public List<NotificationMessage> generate(NotificationEvent event) {
        List<UUID> recipients = event.recipientUserIds() == null
                ? List.of() : event.recipientUserIds();
        return recipients.stream()
                .distinct()
                .map(userId -> new NotificationMessage(
                        userId,
                        event.type(),
                        event.category(),
                        "NORMAL",
                        event.title(),
                        event.message(),
                        event.referenceType(),
                        event.referenceId(),
                        null))
                .toList();
    }
}
