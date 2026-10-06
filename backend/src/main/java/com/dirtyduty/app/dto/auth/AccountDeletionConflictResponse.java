package com.dirtyduty.app.dto.auth;

import java.time.OffsetDateTime;
import java.util.List;

public record AccountDeletionConflictResponse(
    int status,
    String error,
    String message,
    String path,
    OffsetDateTime timestamp,
    List<OwnedHouseholdResponse> ownedHouseholds) {}
