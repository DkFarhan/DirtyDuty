package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A member with this week's counts. {@code awayStartsOn}/{@code awayEndsOn} are their current or
 * upcoming away period (inclusive, household dates), or null.
 */
public record HouseholdMemberStatsResponse(
    UUID userId,
    String displayName,
    HouseholdRole role,
    OffsetDateTime joinedAt,
    long assignedThisWeek,
    long completedThisWeek,
    LocalDate awayStartsOn,
    LocalDate awayEndsOn) {}
