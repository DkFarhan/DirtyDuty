package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/** {@code recurrenceRule} is null for AFTER_COMPLETION and AS_NEEDED schedules. */
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
    int peopleNeeded,
    ScheduleKind kind,
    Integer intervalCount,
    IntervalUnit intervalUnit,
    Integer backstopDays) {}
