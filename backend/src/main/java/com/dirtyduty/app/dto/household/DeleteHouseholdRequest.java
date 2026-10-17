package com.dirtyduty.app.dto.household;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DeleteHouseholdRequest(
    @NotBlank(message = "Household name is required.") String householdName,
    @Size(max = 128, message = "Password must be 128 characters or fewer.") String password) {}
