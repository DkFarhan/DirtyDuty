package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.ChorePriority;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record AssignmentResponse(
        UUID id,
        UUID householdId,
        UUID choreId,
        String categoryName,
        String categoryIcon,
        String title,
        LocalDate scheduledFor,
        OffsetDateTime dueAt,
        String status,
        ChorePriority priority,
        short difficulty,
        Integer estimatedMinutes,
        List<AssigneeResponse> assignees,
        boolean canComplete,
        boolean overdue,
        OffsetDateTime completedAt,
        String completedByDisplayName) {}
