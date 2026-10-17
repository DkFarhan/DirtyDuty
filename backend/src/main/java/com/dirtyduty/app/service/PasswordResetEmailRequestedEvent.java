package com.dirtyduty.app.service;

import java.time.Duration;

public record PasswordResetEmailRequestedEvent(
    String email, String token, Duration expiresIn, String tokenHash) {}
