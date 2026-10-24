package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record VerifyEmailRequest(
    @NotBlank @Pattern(regexp = "[0-9]{6}", message = "Enter the six-digit code.") String code) {}
