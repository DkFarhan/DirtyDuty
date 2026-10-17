package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetConfirmRequest(
    @NotBlank @Size(max = 128) String token,
    @NotBlank @Size(min = 12, max = 128) String newPassword) {}
