package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.ChorePriority;
import java.time.OffsetDateTime;
import java.util.UUID;

public record ChoreResponse(
    UUID id,
    UUID householdId,
    UUID categoryId,
    String title,
    String description,
    ChorePriority defaultPriority,
    short difficulty,
    Integer estimatedMinutes,
    boolean requiresVerification,
    boolean active,
    OffsetDateTime archivedAt,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    ChoreScheduleResponse schedule) {}
