package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.household.HouseholdSettingsRequest;
import com.dirtyduty.app.dto.household.HouseholdSettingsResponse;
import com.dirtyduty.app.dto.household.LeaveHouseholdRequest;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.DateTimeException;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HouseholdSettingsService {
  private final JdbcTemplate jdbc;
  private final HouseholdMembershipRepository membershipRepository;
  private final UserRepository userRepository;
  private final MembershipExitCleanupService membershipExitCleanupService;
  private final ObjectMapper objectMapper = new ObjectMapper();

  public HouseholdSettingsService(
      JdbcTemplate jdbc,
      HouseholdMembershipRepository membershipRepository,
      UserRepository userRepository,
      MembershipExitCleanupService membershipExitCleanupService) {
    this.jdbc = jdbc;
    this.membershipRepository = membershipRepository;
    this.userRepository = userRepository;
    this.membershipExitCleanupService = membershipExitCleanupService;
  }

  @Transactional(readOnly = true)
  public HouseholdSettingsResponse get(UUID householdId, Authentication authentication) {
    HouseholdMembership membership = activeMembership(householdId, authentication);
    return jdbc.queryForObject(
        """
                SELECT id, name, description, timezone, notification_style, created_at
                FROM households WHERE id=?
                """,
        (rs, row) ->
            new HouseholdSettingsResponse(
                rs.getObject("id", UUID.class),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("timezone"),
                rs.getString("notification_style"),
                membership.getRole(),
                rs.getObject("created_at", OffsetDateTime.class)),
        householdId);
  }

  @Transactional
  public HouseholdSettingsResponse update(
      UUID householdId, HouseholdSettingsRequest request, Authentication authentication) {
    HouseholdMembership membership = activeMembership(householdId, authentication);
    if (membership.getRole() != HouseholdRole.OWNER) {
      throw new HouseholdAccessDeniedException(
          "Only the household owner can update household settings.");
    }
    String name = request.name().strip();
    String timezone = request.timezone().strip();
    String description =
        request.description() == null || request.description().isBlank()
            ? null
            : request.description().strip();
    if (name.length() < 2 || name.length() > 120) {
      throw new InvalidHouseholdException("Household name must be between 2 and 120 characters.");
    }
    if (description != null && description.length() > 2000) {
      throw new InvalidHouseholdException("Household description must be at most 2000 characters.");
    }
    try {
      ZoneId.of(timezone);
    } catch (DateTimeException exception) {
      throw new InvalidHouseholdException("A valid IANA timezone is required.");
    }
    jdbc.update(
        """
                UPDATE households SET name=?, description=?, timezone=?, updated_at=?
                WHERE id=?
                """,
        name,
        description,
        timezone,
        OffsetDateTime.now(ZoneOffset.UTC),
        householdId);
    return get(householdId, authentication);
  }

  @Transactional
  public void leave(
      UUID householdId, LeaveHouseholdRequest request, Authentication authentication) {
    HouseholdMembership membership = activeMembership(householdId, authentication);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

    if (membership.getRole() == HouseholdRole.OWNER) {
      if (request == null || request.newOwnerUserId() == null) {
        throw new HouseholdAccessDeniedException(
            "Transfer ownership to another active member before leaving the household.");
      }
      UUID newOwnerUserId = request.newOwnerUserId();
      if (newOwnerUserId.equals(membership.getUser().getId())) {
        throw new InvalidHouseholdException(
            "The current owner cannot transfer ownership to themselves.");
      }

      HouseholdMembership targetMembership =
          membershipRepository
              .findByHousehold_IdAndUser_Id(householdId, newOwnerUserId)
              .filter(candidate -> candidate.getStatus() == MembershipStatus.ACTIVE)
              .orElseThrow(
                  () ->
                      new ResourceNotFoundException(
                          "New owner must be an active household member."));

      if (targetMembership.getRole() == HouseholdRole.OWNER) {
        throw new InvalidHouseholdException("The target member is already the household owner.");
      }

      membership.setRole(HouseholdRole.MEMBER);
      membership.setStatus(MembershipStatus.LEFT);
      membership.setLeftAt(now);
      targetMembership.setRole(HouseholdRole.OWNER);
      membershipRepository.saveAll(java.util.List.of(membership, targetMembership));
      membershipExitCleanupService.cleanupMembershipExit(householdId, membership.getUser().getId());
      recordActivityEvent(
          householdId,
          membership.getUser().getId(),
          "OWNERSHIP_TRANSFERRED",
          "HOUSEHOLD_MEMBERSHIP",
          targetMembership.getUser().getId(),
          java.util.Map.of("new_owner_id", targetMembership.getUser().getId().toString()));
      return;
    }

    membership.setStatus(MembershipStatus.LEFT);
    membership.setLeftAt(now);
    membership.setRole(HouseholdRole.MEMBER);
    membershipRepository.save(membership);
    membershipExitCleanupService.cleanupMembershipExit(householdId, membership.getUser().getId());
    recordActivityEvent(
        householdId,
        membership.getUser().getId(),
        "MEMBER_LEFT",
        "HOUSEHOLD_MEMBERSHIP",
        membership.getUser().getId(),
        java.util.Map.of());
  }

  @Transactional
  public void leaveForAccountDeletion(HouseholdMembership membership) {
    if (membership.getStatus() != MembershipStatus.ACTIVE
        || membership.getRole() == HouseholdRole.OWNER) {
      throw new IllegalStateException(
          "Only active non-owner memberships can be left during account deletion.");
    }
    UUID householdId = membership.getHousehold().getId();
    UUID userId = membership.getUser().getId();
    membership.setStatus(MembershipStatus.LEFT);
    membership.setLeftAt(OffsetDateTime.now(ZoneOffset.UTC));
    membership.setRole(HouseholdRole.MEMBER);
    membershipRepository.save(membership);
    membershipExitCleanupService.cleanupMembershipExit(householdId, userId);
    recordActivityEvent(
        householdId, userId, "MEMBER_LEFT", "HOUSEHOLD_MEMBERSHIP", userId, Map.of());
  }

  private void recordActivityEvent(
      UUID householdId,
      UUID actorUserId,
      String eventType,
      String entityType,
      UUID entityId,
      Map<String, String> metadata) {
    String eventKey =
        eventType + ":" + householdId + ":" + entityId + ":" + System.currentTimeMillis();
    String json = "{}";
    try {
      json = objectMapper.writeValueAsString(metadata == null ? Map.of() : metadata);
    } catch (JsonProcessingException ignored) {
      // ignore and fall back to empty metadata
    }
    jdbc.update(
        """
                INSERT INTO activity_events (id, household_id, actor_user_id, event_type, entity_type, entity_id, event_key, metadata)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, CAST(? AS JSONB))
                ON CONFLICT (event_key) DO NOTHING
                """,
        householdId,
        actorUserId,
        eventType,
        entityType,
        entityId,
        eventKey,
        json);
  }

  private HouseholdMembership activeMembership(UUID householdId, Authentication authentication) {
    User user = currentUser(authentication);
    return membershipRepository
        .findByHousehold_IdAndUser_Id(householdId, user.getId())
        .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
        .orElseThrow(
            () ->
                new HouseholdAccessDeniedException(
                    "You are not an active member of this household."));
  }

  private User currentUser(Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new HouseholdAccessDeniedException("Authentication is required.");
    }
    return userRepository
        .findByEmailIgnoreCase(authentication.getName())
        .orElseThrow(() -> new ResourceNotFoundException("Authenticated user was not found."));
  }
}
