package com.dirtyduty.app.dto.notification;

import java.time.OffsetDateTime;

public record PushSubscriptionHealthResponse(Status status, OffsetDateTime lastClientConfirmedAt) {
  public enum Status {
    CONFIRMED,
    SYNC_REQUIRED,
    DISABLED
  }
}
