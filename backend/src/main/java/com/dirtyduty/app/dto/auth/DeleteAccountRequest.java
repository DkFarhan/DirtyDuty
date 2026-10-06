package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Email;

public record DeleteAccountRequest(
        @NotBlank(message = "Password is required.")
        String password,

        @NotBlank(message = "Email confirmation is required.")
        @Email(message = "Email confirmation must be valid.")
        String email) {}
