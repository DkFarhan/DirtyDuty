package com.dirtyduty.app.dto.household;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import java.time.OffsetDateTime;
import java.util.UUID;

public record HouseholdInvitationSummaryResponse(
        UUID id,
        OffsetDateTime createdAt,
        OffsetDateTime expiresAt,
        String status,
        String createdByDisplayName,
        HouseholdRole roleToAssign) {}
