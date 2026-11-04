package com.dirtyduty.app.dto.notification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record PushTestNotificationRequest(
    @NotBlank @Pattern(regexp = "[a-fA-F0-9]{64}") String endpointFingerprint) {}
