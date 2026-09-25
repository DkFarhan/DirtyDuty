package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HouseholdMembershipRepository extends JpaRepository<HouseholdMembership, UUID> {

    Optional<HouseholdMembership> findByHousehold_IdAndUser_Id(UUID householdId, UUID userId);

    List<HouseholdMembership> findByUser_IdAndStatus(UUID userId, MembershipStatus status);

    List<HouseholdMembership> findByHousehold_IdAndStatus(UUID householdId, MembershipStatus status);

    boolean existsByHousehold_IdAndUser_IdAndStatus(UUID householdId, UUID userId, MembershipStatus status);
}
