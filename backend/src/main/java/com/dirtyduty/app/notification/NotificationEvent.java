package com.dirtyduty.app.notification;

import java.util.List;
import java.util.UUID;

public record NotificationEvent(
        String type,
        UUID actorUserId,
        UUID householdId,
        String referenceType,
        UUID referenceId,
        String category,
        String title,
        String message,
        List<UUID> recipientUserIds) {}
