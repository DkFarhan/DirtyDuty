package com.dirtyduty.app.dto.auth;

import java.util.UUID;

public record RegisterResponse(
    UUID userId,
    String displayName,
    String email,
    boolean emailVerified,
    String verificationDeliveryState) {

  public RegisterResponse(UUID userId, String displayName, String email) {
    this(userId, displayName, email, false, null);
  }
}
