package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DeleteAccountRequest(
    @Size(max = 128, message = "Password must be 128 characters or fewer.") String password,
    @NotBlank(message = "Email confirmation is required.")
        @Email(message = "Email confirmation must be valid.")
        String email) {
  public DeleteAccountRequest {
    if (email != null) {
      email = email.trim();
    }
  }
}
