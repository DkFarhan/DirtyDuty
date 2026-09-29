package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

public record ChoreScheduleRequest(
        String recurrenceRule,
        @Size(max = 100) String timezone,
        LocalDate startsOn,
        LocalDate endsOn,
        LocalTime dueTime,
        AssignmentStrategy assignmentStrategy,
        UUID fixedAssigneeUserId,
        List<@NotNull UUID> participantUserIds,
        @Min(1) @Max(50) Integer peopleNeeded) {
}
