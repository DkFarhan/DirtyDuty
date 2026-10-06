package com.dirtyduty.app.dto.household;

import jakarta.validation.constraints.NotBlank;

public record DeleteHouseholdRequest(
        @NotBlank(message = "Household name is required.") String householdName,
        @NotBlank(message = "Current password is required.") String password) {}
