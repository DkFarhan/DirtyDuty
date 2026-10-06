package com.dirtyduty.app.dto.profile;

import java.util.UUID;

public record ProfileResponse(
    UUID id,
    String displayName,
    String email,
    String avatarUrl,
    String householdName,
    long assigned,
    long completed,
    double completionRate) {}
