package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.HouseholdInvitation;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface HouseholdInvitationRepository extends JpaRepository<HouseholdInvitation, UUID> {

  List<HouseholdInvitation> findByHousehold_IdOrderByCreatedAtDesc(UUID householdId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "select invitation from HouseholdInvitation invitation where invitation.inviteCode = :inviteCode")
  Optional<HouseholdInvitation> findByInviteCodeForUpdate(@Param("inviteCode") String inviteCode);
}
