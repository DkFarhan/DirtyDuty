package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.ChorePriority;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record ChoreRequest(
    @NotBlank @Size(max = 160) String title,
    String description,
    UUID categoryId,
    ChorePriority defaultPriority,
    @Min(1) @Max(5) Integer difficulty,
    @Min(1) @Max(1440) Integer estimatedMinutes,
    Boolean requiresVerification,
    @Valid ChoreScheduleRequest schedule) {}
