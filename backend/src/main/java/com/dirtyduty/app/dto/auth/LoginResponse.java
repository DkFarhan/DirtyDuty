package com.dirtyduty.app.dto.auth;

import java.util.UUID;

public record LoginResponse(
        UUID userId,
        String displayName,
        String email,
        boolean emailVerified) {
}