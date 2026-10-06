package com.dirtyduty.app.dto.household;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record HouseholdSettingsRequest(
    @NotBlank @Size(min = 2, max = 120) String name,
    @Size(max = 2000) String description,
    @NotBlank @Size(max = 100) String timezone) {}
