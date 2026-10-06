package com.dirtyduty.app.mapper;

import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.entity.Household;
import com.dirtyduty.app.entity.enums.HouseholdRole;

public class HouseholdMapper {

  private HouseholdMapper() {}

  public static HouseholdResponse toResponse(Household household, HouseholdRole currentUserRole) {
    return new HouseholdResponse(
        household.getId(),
        household.getName(),
        household.getTimezone(),
        currentUserRole,
        household.getCreatedAt());
  }
}
