package com.dirtyduty.app.dto.auth;

import java.util.UUID;

public record AuthResponse(
    UUID userId,
    String displayName,
    String email,
    String accessToken
) {
}
