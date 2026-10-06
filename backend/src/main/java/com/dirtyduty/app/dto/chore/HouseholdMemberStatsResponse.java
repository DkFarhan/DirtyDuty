package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import java.time.OffsetDateTime;
import java.util.UUID;

public record HouseholdMemberStatsResponse(
    UUID userId,
    String displayName,
    HouseholdRole role,
    OffsetDateTime joinedAt,
    long assignedThisWeek,
    long completedThisWeek) {}
