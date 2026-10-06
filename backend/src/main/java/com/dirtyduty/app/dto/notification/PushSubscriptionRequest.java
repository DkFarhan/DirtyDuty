package com.dirtyduty.app.dto.notification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PushSubscriptionRequest(
    @NotBlank @Size(max = 2048) String endpoint,
    @NotBlank @Size(max = 256) String publicKey,
    @NotBlank @Size(max = 256) String authSecret) {}
