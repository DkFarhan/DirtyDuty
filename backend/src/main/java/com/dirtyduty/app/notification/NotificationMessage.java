package com.dirtyduty.app.notification;

import java.time.OffsetDateTime;
import java.util.UUID;

public record NotificationMessage(
    UUID recipientUserId,
    String type,
    String category,
    String priority,
    String title,
    String message,
    String referenceType,
    UUID referenceId,
    OffsetDateTime scheduledAt,
    OffsetDateTime expiresAt,
    String deduplicationKey) {}
