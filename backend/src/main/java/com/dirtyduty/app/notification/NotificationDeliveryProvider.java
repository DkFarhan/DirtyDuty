package com.dirtyduty.app.notification;

public interface NotificationDeliveryProvider {
    void deliver(NotificationMessage notification, java.util.UUID eventId);
}
