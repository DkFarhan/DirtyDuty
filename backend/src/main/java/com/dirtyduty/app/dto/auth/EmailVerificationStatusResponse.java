package com.dirtyduty.app.dto.auth;

import java.time.OffsetDateTime;

public record EmailVerificationStatusResponse(
    String email,
    boolean emailVerified,
    OffsetDateTime codeExpiresAt,
    OffsetDateTime resendAvailableAt,
    String deliveryState) {}
