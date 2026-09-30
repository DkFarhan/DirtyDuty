package com.dirtyduty.app.notification;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record NotificationEvent(
        String type,
        UUID actorUserId,
        UUID householdId,
        String referenceType,
        UUID referenceId,
        String category,
        Map<String, String> variables,
        List<UUID> recipientUserIds) {}
