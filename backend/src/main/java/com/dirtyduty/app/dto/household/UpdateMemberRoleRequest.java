package com.dirtyduty.app.dto.household;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import jakarta.validation.constraints.NotNull;

public record UpdateMemberRoleRequest(@NotNull HouseholdRole role) {}
