package com.dirtyduty.app.dto.household;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import java.time.OffsetDateTime;
import java.util.UUID;

public record HouseholdResponse(
    UUID id,
    String name,
    String timezone,
    HouseholdRole currentUserRole,
    OffsetDateTime createdAt
) {
}
