package com.dirtyduty.app.dto.auth;

import java.util.UUID;

public record RegisterResponse(
        UUID userId,
        String displayName,
        String email) {
}
