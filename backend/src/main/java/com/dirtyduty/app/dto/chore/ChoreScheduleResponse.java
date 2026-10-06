package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

public record ChoreScheduleResponse(
    String recurrenceRule,
    String timezone,
    LocalDate startsOn,
    LocalDate endsOn,
    LocalTime dueTime,
    AssignmentStrategy assignmentStrategy,
    UUID fixedAssigneeUserId,
    List<UUID> participantUserIds,
    boolean active,
    int peopleNeeded) {}
