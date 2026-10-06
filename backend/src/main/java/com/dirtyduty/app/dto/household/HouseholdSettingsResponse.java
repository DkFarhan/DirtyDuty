package com.dirtyduty.app.dto.household;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import java.time.OffsetDateTime;
import java.util.UUID;

public record HouseholdSettingsResponse(
    UUID id,
    String name,
    String description,
    String timezone,
    String notificationStyle,
    HouseholdRole currentUserRole,
    OffsetDateTime createdAt) {}
