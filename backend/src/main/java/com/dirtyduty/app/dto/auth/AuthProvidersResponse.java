package com.dirtyduty.app.dto.auth;

public record AuthProvidersResponse(
    boolean google, boolean passwordReset, boolean emailVerification) {}
