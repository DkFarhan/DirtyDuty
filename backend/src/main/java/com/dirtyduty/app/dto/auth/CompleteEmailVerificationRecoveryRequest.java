package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CompleteEmailVerificationRecoveryRequest(
    @NotBlank @Email @Size(max = 320) String email,
    @NotBlank @Pattern(regexp = "[0-9]{6}") String code,
    @NotBlank
        @Size(min = 12, max = 128, message = "Password must be between 12 and 128 characters.")
        String newPassword) {}
