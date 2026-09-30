package com.dirtyduty.app.notification;

public interface NotificationDeliveryProvider {
    String channel();

    void deliver(NotificationMessage notification, java.util.UUID eventId);
}
