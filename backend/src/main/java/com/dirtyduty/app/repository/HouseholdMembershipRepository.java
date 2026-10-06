package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface HouseholdMembershipRepository extends JpaRepository<HouseholdMembership, UUID> {

    Optional<HouseholdMembership> findByHousehold_IdAndUser_Id(UUID householdId, UUID userId);

    List<HouseholdMembership> findByUser_IdAndStatus(UUID userId, MembershipStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select membership from HouseholdMembership membership where membership.user.id = :userId and membership.status = :status")
    List<HouseholdMembership> findByUser_IdAndStatusForUpdate(
            @Param("userId") UUID userId,
            @Param("status") MembershipStatus status);

    List<HouseholdMembership> findByHousehold_IdAndStatus(UUID householdId, MembershipStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select membership from HouseholdMembership membership where membership.household.id = :householdId and membership.status = :status")
    List<HouseholdMembership> findByHousehold_IdAndStatusForUpdate(
            @Param("householdId") UUID householdId,
            @Param("status") MembershipStatus status);

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
