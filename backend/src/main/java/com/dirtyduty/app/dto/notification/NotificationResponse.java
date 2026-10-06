package com.dirtyduty.app.dto.notification;

import java.time.OffsetDateTime;
import java.util.UUID;

public record NotificationResponse(
    UUID id,
    String type,
    String category,
    String priority,
    String title,
    String message,
    String referenceType,
    UUID referenceId,
    String status,
    OffsetDateTime scheduledAt,
    OffsetDateTime sentAt,
    OffsetDateTime deliveredAt,
    OffsetDateTime readAt,
    OffsetDateTime createdAt) {}
