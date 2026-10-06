package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
    @NotBlank(message = "Email is required")
        @Email(message = "Email must be valid")
        @Size(max = 320, message = "Email must be 320 characters or fewer")
        String email,
    @NotBlank(message = "Password is required")
        @Size(max = 128, message = "Password must be 128 characters or fewer")
        String password) {}
