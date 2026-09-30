package com.dirtyduty.app.dto.notification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PushUnsubscribeRequest(@NotBlank @Size(max = 2048) String endpoint) {}
