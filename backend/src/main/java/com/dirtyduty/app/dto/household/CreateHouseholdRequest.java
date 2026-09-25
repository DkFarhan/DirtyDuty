package com.dirtyduty.app.dto.household;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateHouseholdRequest(
        @NotBlank(message = "Household name is required") @Size(max = 120, message = "Household name must be 120 characters or fewer") String name,

        @NotBlank(message = "Timezone is required") @Size(max = 100, message = "Timezone must be 100 characters or fewer") String timezone) {
}
