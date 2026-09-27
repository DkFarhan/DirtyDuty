package com.dirtyduty.app.dto.household;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateHouseholdRequest(
        @NotBlank(message = "Household name is required") @Size(min = 2, max = 120, message = "Household name must be between 2 and 120 characters") String name,

        @NotBlank(message = "Timezone is required") @Size(max = 100, message = "Timezone must be 100 characters or fewer") String timezone) {

    public CreateHouseholdRequest {
        if (name != null) {
            name = name.strip();
        }
        if (timezone != null) {
            timezone = timezone.strip();
        }
    }
}
