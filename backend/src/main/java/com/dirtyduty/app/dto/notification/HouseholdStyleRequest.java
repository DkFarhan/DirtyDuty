package com.dirtyduty.app.dto.notification;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.NotBlank;

public record HouseholdStyleRequest(
        @NotBlank @Pattern(regexp = "NORMAL|FUNNY|MOTIVATIONAL|COMPETITIVE|MINIMAL") String style) {}
