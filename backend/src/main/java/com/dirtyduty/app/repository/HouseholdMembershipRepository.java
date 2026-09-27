package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface HouseholdMembershipRepository extends JpaRepository<HouseholdMembership, UUID> {

    Optional<HouseholdMembership> findByHousehold_IdAndUser_Id(UUID householdId, UUID userId);

    List<HouseholdMembership> findByUser_IdAndStatus(UUID userId, MembershipStatus status);

    List<HouseholdMembership> findByHousehold_IdAndStatus(UUID householdId, MembershipStatus status);

    boolean existsByHousehold_IdAndUser_IdAndStatus(UUID householdId, UUID userId, MembershipStatus status);

    @Query("""
            select new com.dirtyduty.app.dto.household.HouseholdResponse(
                household.id, household.name, household.timezone, membership.role, household.createdAt)
            from HouseholdMembership membership
            join membership.household household
            where membership.user.id = :userId and membership.status = :status
            order by household.createdAt
            """)
    List<HouseholdResponse> findHouseholdsByUserAndStatus(
            @Param("userId") UUID userId,
            @Param("status") MembershipStatus status);
}
