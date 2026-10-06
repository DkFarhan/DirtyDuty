package com.dirtyduty.app.dto.notification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record HouseholdStyleRequest(
    @NotBlank @Pattern(regexp = "NORMAL|FUNNY|MOTIVATIONAL|COMPETITIVE|MINIMAL") String style) {}
