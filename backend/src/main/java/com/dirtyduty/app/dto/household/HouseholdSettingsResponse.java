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
    /* The reminder level new chores get (E13): OFF, FRIENDLY, STANDARD, AGGRESSIVE or INTENSE. */
    String defaultReminderMode,
    HouseholdRole currentUserRole,
    OffsetDateTime createdAt) {}
