package com.dirtyduty.app.notification;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class NotificationEngine {
    private final NotificationGenerator generator;
    private final List<NotificationDeliveryProvider> providers;

    public NotificationEngine(
            NotificationGenerator generator,
            List<NotificationDeliveryProvider> providers) {
        this.generator = generator;
        this.providers = providers;
    }

    public void process(NotificationEvent event, UUID eventId) {
        for (NotificationMessage message : generator.generate(event)) {
            for (NotificationDeliveryProvider provider : providers) {
                provider.deliver(message, eventId);
            }
        }
    }
}
