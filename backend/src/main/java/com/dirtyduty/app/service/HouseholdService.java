package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.household.CreateHouseholdRequest;
import com.dirtyduty.app.dto.household.CreateInvitationResponse;
import com.dirtyduty.app.dto.household.DeleteHouseholdRequest;
import com.dirtyduty.app.dto.household.HouseholdInvitationSummaryResponse;
import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.dto.household.JoinHouseholdRequest;
import com.dirtyduty.app.dto.household.RemoveMemberResponse;
import com.dirtyduty.app.entity.Household;
import com.dirtyduty.app.entity.HouseholdInvitation;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.InvalidInvitationException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.mapper.HouseholdMapper;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.repository.ChoreCategoryRepository;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.HouseholdInvitationRepository;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.HouseholdRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HouseholdService {

    // TODO: Record HOUSEHOLD_CREATED and HOUSEHOLD_JOINED when activity-event persistence is available.
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int INVITE_TOKEN_BYTES = 32;
    private static final HouseholdRole INVITATION_ROLE = HouseholdRole.MEMBER;
    private final HouseholdRepository householdRepository;
    private final HouseholdMembershipRepository householdMembershipRepository;
    private final HouseholdInvitationRepository householdInvitationRepository;
    private final ChoreCategoryRepository choreCategoryRepository;
    private final ChoreScheduleRepository choreScheduleRepository;
    private final UserRepository userRepository;
    private final NotificationEventService notificationEventService;
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final Duration invitationExpiration;

    public HouseholdService(
            HouseholdRepository householdRepository,
            HouseholdMembershipRepository householdMembershipRepository,
            HouseholdInvitationRepository householdInvitationRepository,
            ChoreCategoryRepository choreCategoryRepository,
            ChoreScheduleRepository choreScheduleRepository,
            UserRepository userRepository,
            NotificationEventService notificationEventService,
            JdbcTemplate jdbc,
            PasswordEncoder passwordEncoder,
            @Value("${app.households.invitation-expiration:7d}") Duration invitationExpiration) {
        this.householdRepository = householdRepository;
        this.householdMembershipRepository = householdMembershipRepository;
        this.householdInvitationRepository = householdInvitationRepository;
        this.choreCategoryRepository = choreCategoryRepository;
        this.choreScheduleRepository = choreScheduleRepository;
        this.userRepository = userRepository;
        this.notificationEventService = notificationEventService;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        if (invitationExpiration.isZero() || invitationExpiration.isNegative()) {
            throw new IllegalArgumentException("Household invitation expiration must be positive.");
        }
        this.invitationExpiration = invitationExpiration;
    }

    @Transactional(readOnly = true)
    public List<HouseholdResponse> listCurrentUserHouseholds(Authentication authentication) {
        User user = resolveUser(authentication);
        return householdMembershipRepository.findHouseholdsByUserAndStatus(user.getId(), MembershipStatus.ACTIVE);
    }

    @Transactional
    public HouseholdResponse createHousehold(CreateHouseholdRequest request, Authentication authentication) {
        User user = resolveUser(authentication);
        String name = request.name().strip();
        String timezone = request.timezone().strip();
        if (name.length() < 2 || name.length() > 120) {
            throw new InvalidHouseholdException("Household name must be between 2 and 120 characters.");
        }
        if (timezone.length() > 100 || !ZoneId.getAvailableZoneIds().contains(timezone)) {
            throw new InvalidHouseholdException("A valid IANA timezone is required.");
        }

        Household household = new Household();
        household.setName(name);
        household.setTimezone(timezone);
        household.setCreatedByUser(user);
        householdRepository.save(household);

        ChoreCategoryDefaults.ensureFor(household, choreCategoryRepository);

        HouseholdMembership ownerMembership = new HouseholdMembership();
        ownerMembership.setHousehold(household);
        ownerMembership.setUser(user);
        ownerMembership.setRole(HouseholdRole.OWNER);
        ownerMembership.setStatus(MembershipStatus.ACTIVE);
        ownerMembership.setJoinedAt(OffsetDateTime.now(ZoneOffset.UTC));
        householdMembershipRepository.save(ownerMembership);

        return HouseholdMapper.toResponse(household, HouseholdRole.OWNER);
    }

    @Transactional
    public CreateInvitationResponse createInvitation(UUID householdId, Authentication authentication) {
        User user = resolveUser(authentication);
        HouseholdMembership membership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(existing -> existing.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not authorized to invite members."));

        if (membership.getRole() != HouseholdRole.OWNER && membership.getRole() != HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("You are not authorized to invite members.");
        }

        byte[] tokenBytes = new byte[INVITE_TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(tokenBytes);
        String inviteCode = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime expiresAt = now.plus(invitationExpiration);

        HouseholdInvitation invitation = new HouseholdInvitation();
        invitation.setHousehold(membership.getHousehold());
        invitation.setCreatedByUser(user);
        invitation.setInviteCode(hashInviteCode(inviteCode));
        invitation.setRoleToAssign(INVITATION_ROLE);
        invitation.setExpiresAt(expiresAt);
        householdInvitationRepository.save(invitation);

        return new CreateInvitationResponse(inviteCode, expiresAt);
    }

    @Transactional(readOnly = true)
    public List<HouseholdInvitationSummaryResponse> listActiveInvitations(UUID householdId, Authentication authentication) {
        User user = resolveUser(authentication);
        HouseholdMembership membership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(existing -> existing.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not authorized to manage household invitations."));

        if (membership.getRole() != HouseholdRole.OWNER && membership.getRole() != HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("You are not authorized to manage household invitations.");
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        return householdInvitationRepository.findByHousehold_IdOrderByCreatedAtDesc(householdId).stream()
                .map(invitation -> {
                    String status = "ACTIVE";
                    if (invitation.getRevokedAt() != null) {
                        status = "REVOKED";
                    } else if (invitation.getUsedAt() != null) {
                        status = "USED";
                    } else if (invitation.getExpiresAt() != null && !now.isBefore(invitation.getExpiresAt())) {
                        status = "EXPIRED";
                    }
                    return new HouseholdInvitationSummaryResponse(
                            invitation.getId(),
                            invitation.getCreatedAt(),
                            invitation.getExpiresAt(),
                            status,
                            invitation.getCreatedByUser() == null ? null : invitation.getCreatedByUser().getDisplayName(),
                            invitation.getRoleToAssign());
                })
                .filter(invitation -> !"USED".equals(invitation.status()) && !"REVOKED".equals(invitation.status()) && !"EXPIRED".equals(invitation.status()))
                .sorted((left, right) -> right.createdAt().compareTo(left.createdAt()))
                .toList();
    }

    @Transactional
    public void revokeInvitation(UUID householdId, UUID invitationId, Authentication authentication) {
        User user = resolveUser(authentication);
        HouseholdMembership membership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(existing -> existing.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not authorized to manage household invitations."));

        if (membership.getRole() != HouseholdRole.OWNER && membership.getRole() != HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("You are not authorized to manage household invitations.");
        }

        HouseholdInvitation invitation = householdInvitationRepository.findById(invitationId)
                .orElseThrow(() -> new ResourceNotFoundException("Invitation was not found."));
        if (!invitation.getHousehold().getId().equals(householdId)) {
            throw new ResourceNotFoundException("Invitation was not found in this household.");
        }
        if (invitation.getUsedAt() != null || invitation.getRevokedAt() != null) {
            return;
        }
        invitation.setRevokedAt(OffsetDateTime.now(ZoneOffset.UTC));
        householdInvitationRepository.save(invitation);
    }

    @Transactional
    public void deleteHousehold(UUID householdId, DeleteHouseholdRequest request, Authentication authentication) {
        if (request == null) {
            throw new InvalidHouseholdException("Household name and password are required.");
        }

        User user = resolveUser(authentication);
        HouseholdMembership membership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(existing -> existing.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not an active member of this household."));
        if (membership.getRole() != HouseholdRole.OWNER) {
            throw new HouseholdAccessDeniedException("Only the household owner can permanently delete it.");
        }

        Household household = householdRepository.findById(householdId)
                .orElseThrow(() -> new ResourceNotFoundException("Household was not found."));
        if (!Objects.equals(household.getName(), request.householdName())) {
            throw new InvalidHouseholdException("Household name does not match.");
        }
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new HouseholdAccessDeniedException("Current password is incorrect.");
        }

        jdbc.update("DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE recipient_user_id IN (SELECT user_id FROM household_memberships WHERE household_id = ?))", householdId);
        jdbc.update("DELETE FROM notifications WHERE recipient_user_id IN (SELECT user_id FROM household_memberships WHERE household_id = ?)", householdId);
        jdbc.update("DELETE FROM notification_events WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM activity_events WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM chore_completions WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM chore_assignments WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM chore_schedules WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM chores WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM chore_categories WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM household_invitations WHERE household_id = ?", householdId);
        jdbc.update("DELETE FROM household_memberships WHERE household_id = ?", householdId);
        householdRepository.delete(household);
    }

    @Transactional
    public HouseholdResponse joinHousehold(JoinHouseholdRequest request, Authentication authentication) {
        String submittedCode = request.inviteCode().strip();
        HouseholdInvitation invitation = householdInvitationRepository
                .findByInviteCodeForUpdate(hashInviteCode(submittedCode))
                .orElseThrow(InvalidInvitationException::new);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        if (invitation.getUsedAt() != null
                || invitation.getRevokedAt() != null
                || invitation.getExpiresAt() == null
                || !now.isBefore(invitation.getExpiresAt())) {
            throw new InvalidInvitationException();
        }

        User user = resolveUser(authentication);
        HouseholdMembership membership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(invitation.getHousehold().getId(), user.getId())
                .orElse(null);
        if (membership != null && membership.getStatus() == MembershipStatus.ACTIVE) {
            throw new DuplicateResourceException("You are already a member of this household.");
        }
        boolean rejoining = membership != null
                && (membership.getStatus() == MembershipStatus.REMOVED
                        || membership.getStatus() == MembershipStatus.LEFT);
        if (membership == null) {
            membership = new HouseholdMembership();
            membership.setHousehold(invitation.getHousehold());
            membership.setUser(user);
        }

        membership.setRole(rejoining ? HouseholdRole.MEMBER : invitation.getRoleToAssign());
        membership.setStatus(MembershipStatus.ACTIVE);
        membership.setJoinedAt(now);
        membership.setLeftAt(null);
        householdMembershipRepository.save(membership);

        invitation.setUsedAt(now);
        householdInvitationRepository.save(invitation);

        UUID householdId = invitation.getHousehold().getId();
        if (rejoining) {
            recordActivityEvent(householdId, user.getId(), "MEMBER_REJOINED", "HOUSEHOLD_MEMBERSHIP",
                    membership.getUser().getId(), java.util.Map.of());
        }
        List<UUID> otherMembers = householdMembershipRepository
                .findByHousehold_IdAndStatus(householdId, MembershipStatus.ACTIVE).stream()
                .map(HouseholdMembership::getUser)
                .map(User::getId)
                .filter(memberId -> !memberId.equals(user.getId()))
                .toList();
        notificationEventService.publish(new NotificationEvent(
                "HOUSEHOLD_JOINED",
                user.getId(),
                householdId,
                "HOUSEHOLD",
                householdId,
                "HOUSEHOLD_UPDATE",
                java.util.Map.of(),
                otherMembers));
        notificationEventService.publish(new NotificationEvent(
                "INVITE_ACCEPTED",
                user.getId(),
                householdId,
                "INVITATION",
                invitation.getId(),
                "HOUSEHOLD_UPDATE",
                java.util.Map.of(),
                List.of(invitation.getCreatedByUser().getId())));

        return HouseholdMapper.toResponse(invitation.getHousehold(), membership.getRole());
    }

    @Transactional
    public void updateMemberRole(UUID householdId, UUID targetUserId, HouseholdRole newRole, Authentication authentication) {
        User actorUser = resolveUser(authentication);
        HouseholdMembership actorMembership = requireActiveMembership(householdId, actorUser.getId());
        if (actorMembership.getRole() != HouseholdRole.OWNER && actorMembership.getRole() != HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("Only owners and admins can manage household roles.");
        }
        if (newRole == null) {
            throw new InvalidHouseholdException("A valid role is required.");
        }
        if (newRole == HouseholdRole.OWNER) {
            throw new InvalidHouseholdException("Ownership must be transferred through the ownership transfer flow.");
        }

        HouseholdMembership targetMembership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, targetUserId)
                .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Target member was not found in this household."));

        if (targetMembership.getUser().getId().equals(actorUser.getId())) {
            throw new HouseholdAccessDeniedException("A member cannot change their own role here.");
        }
        if (actorMembership.getRole() == HouseholdRole.ADMIN && targetMembership.getRole() == HouseholdRole.OWNER) {
            throw new HouseholdAccessDeniedException("Admins cannot change the household owner.");
        }
        if (actorMembership.getRole() == HouseholdRole.ADMIN && targetMembership.getRole() == HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("Admins cannot change another admin's role.");
        }

        targetMembership.setRole(newRole);
        householdMembershipRepository.save(targetMembership);
        recordActivityEvent(householdId, actorUser.getId(),
                newRole == HouseholdRole.ADMIN ? "MEMBER_PROMOTED" : "MEMBER_DEMOTED",
                "HOUSEHOLD_MEMBERSHIP",
                targetUserId,
                java.util.Map.of("role", newRole.name()));
    }

    @Transactional
    public RemoveMemberResponse removeMember(UUID householdId, UUID targetUserId, Authentication authentication) {
        User actorUser = resolveUser(authentication);
        HouseholdMembership actorMembership = requireActiveMembership(householdId, actorUser.getId());
        if (actorMembership.getRole() != HouseholdRole.OWNER && actorMembership.getRole() != HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("Only owners and admins can remove household members.");
        }

        HouseholdMembership targetMembership = householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, targetUserId)
                .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Target member was not found in this household."));

        if (targetMembership.getUser().getId().equals(actorUser.getId())) {
            throw new HouseholdAccessDeniedException("Use the leave flow to remove yourself from a household.");
        }
        if (targetMembership.getRole() == HouseholdRole.OWNER) {
            throw new HouseholdAccessDeniedException("Transfer ownership before removing the household owner.");
        }
        if (actorMembership.getRole() == HouseholdRole.ADMIN && targetMembership.getRole() == HouseholdRole.ADMIN) {
            throw new HouseholdAccessDeniedException("Admins cannot remove other admins.");
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        targetMembership.setStatus(MembershipStatus.REMOVED);
        targetMembership.setLeftAt(now);
        targetMembership.setRole(HouseholdRole.MEMBER);
        householdMembershipRepository.save(targetMembership);
        int pausedScheduleCount = disableRemovedMemberParticipation(householdId, targetUserId);

        jdbc.update("UPDATE notifications SET status='CANCELLED', read_at=NOW() WHERE recipient_user_id=? AND status='PENDING'",
                targetUserId);
        jdbc.update("UPDATE notifications SET status='CANCELLED', read_at=NOW() WHERE recipient_user_id=? AND status='SENT' AND scheduled_at > NOW()",
                targetUserId);
        recordActivityEvent(householdId, actorUser.getId(), "MEMBER_REMOVED", "HOUSEHOLD_MEMBERSHIP", targetUserId,
                java.util.Map.of("removed_user_id", targetUserId.toString(), "paused_schedules", String.valueOf(pausedScheduleCount)));
        return new RemoveMemberResponse(
                pausedScheduleCount > 0
                        ? "Member removed. " + pausedScheduleCount + " chore schedule" + (pausedScheduleCount == 1 ? " was" : "s were") + " paused because they no longer had enough eligible members."
                        : "Member removed from the household.",
                pausedScheduleCount);
    }

    @Transactional
    public void transferOwnership(UUID householdId, UUID targetUserId, Authentication authentication) {
        User actorUser = resolveUser(authentication);
        HouseholdMembership actorMembership = requireActiveMembership(householdId, actorUser.getId());
        if (actorMembership.getRole() != HouseholdRole.OWNER) {
            throw new HouseholdAccessDeniedException("Only the household owner can transfer ownership.");
        }
        if (targetUserId.equals(actorUser.getId())) {
            throw new InvalidHouseholdException("The household owner cannot transfer ownership to themselves.");
        }

        List<HouseholdMembership> activeMembers = householdMembershipRepository
                .findByHousehold_IdAndStatusForUpdate(householdId, MembershipStatus.ACTIVE);
        HouseholdMembership targetMembership = activeMembers.stream()
                .filter(membership -> membership.getUser().getId().equals(targetUserId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Target member was not found in this household."));

        if (targetMembership.getRole() == HouseholdRole.OWNER) {
            throw new InvalidHouseholdException("The target member is already the household owner.");
        }

        for (HouseholdMembership membership : activeMembers) {
            if (membership.getUser().getId().equals(targetUserId)) {
                membership.setRole(HouseholdRole.OWNER);
            } else if (membership.getUser().getId().equals(actorUser.getId())) {
                membership.setRole(HouseholdRole.ADMIN);
            } else if (membership.getRole() == HouseholdRole.OWNER) {
                membership.setRole(HouseholdRole.ADMIN);
            }
        }

        householdMembershipRepository.saveAll(activeMembers);
        recordActivityEvent(householdId, actorUser.getId(), "OWNERSHIP_TRANSFERRED", "HOUSEHOLD_MEMBERSHIP", targetUserId,
                java.util.Map.of("new_owner_id", targetUserId.toString()));
    }

    private HouseholdMembership requireActiveMembership(UUID householdId, UUID userId) {
        return householdMembershipRepository
                .findByHousehold_IdAndUser_Id(householdId, userId)
                .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not an active member of this household."));
    }

    private int disableRemovedMemberParticipation(UUID householdId, UUID removedUserId) {
        jdbc.update("""
                DELETE FROM chore_assignment_assignees
                WHERE household_id=? AND user_id=?
                  AND assignment_id IN (
                      SELECT id FROM chore_assignments
                      WHERE household_id=? AND scheduled_for >= CURRENT_DATE
                        AND status IN ('PENDING', 'SUBMITTED')
                  )
                """, householdId, removedUserId, householdId);

        jdbc.update("""
                UPDATE chore_assignments
                SET status='CANCELLED', updated_at=NOW()
                WHERE household_id=?
                  AND scheduled_for >= CURRENT_DATE
                  AND status IN ('PENDING', 'SUBMITTED')
                  AND (
                      assigned_to_user_id = ?
                      OR NOT EXISTS (SELECT 1 FROM chore_assignment_assignees WHERE assignment_id = chore_assignments.id)
                  )
                """, householdId, removedUserId);

        int pausedScheduleCount = 0;
        for (var schedule : choreScheduleRepository.findByHousehold_IdAndActiveTrue(householdId)) {
            boolean invalidated = false;
            if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
                if (schedule.getFixedAssignee() != null && schedule.getFixedAssignee().getId().equals(removedUserId)) {
                    schedule.setFixedAssignee(null);
                    schedule.setActive(false);
                    invalidated = true;
                }
            } else if (schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN
                    || schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM) {
                List<UUID> participantIds = new ArrayList<>();
                Object configured = schedule.getStrategyConfig() == null ? null : schedule.getStrategyConfig().get("participantUserIds");
                if (configured instanceof List<?> list) {
                    for (Object item : list) {
                        if (item != null) {
                            participantIds.add(UUID.fromString(item.toString()));
                        }
                    }
                }
                List<UUID> nextParticipantIds = participantIds.stream()
                        .filter(id -> !id.equals(removedUserId))
                        .distinct()
                        .toList();
                if (!nextParticipantIds.equals(participantIds)) {
                    schedule.getStrategyConfig().put("participantUserIds", nextParticipantIds.stream().map(UUID::toString).toList());
                    if (nextParticipantIds.isEmpty() || nextParticipantIds.size() < peopleNeeded(schedule)) {
                        schedule.setActive(false);
                        invalidated = true;
                    } else {
                        schedule.setActive(true);
                    }
                }
            }
            if (invalidated) {
                choreScheduleRepository.save(schedule);
                pausedScheduleCount++;
            }
        }
        return pausedScheduleCount;
    }

    private int peopleNeeded(com.dirtyduty.app.entity.ChoreSchedule schedule) {
        Object value = schedule.getStrategyConfig() == null ? null : schedule.getStrategyConfig().get("peopleNeeded");
        return value instanceof Number number ? Math.max(1, number.intValue()) : 1;
    }

    private void recordActivityEvent(UUID householdId, UUID actorUserId, String eventType, String entityType, UUID entityId, java.util.Map<String, String> metadata) {
        String eventKey = eventType + ":" + householdId + ":" + entityId + ":" + System.currentTimeMillis();
        jdbc.update("""
                INSERT INTO activity_events (id, household_id, actor_user_id, event_type, entity_type, entity_id, event_key)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?)
                ON CONFLICT (event_key) DO NOTHING
                """,
                householdId, actorUserId, eventType, entityType, entityId, eventKey);
    }

    private User resolveUser(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new HouseholdAccessDeniedException("Authentication is required.");
        }
        return userRepository.findByEmailIgnoreCase(authentication.getName())
                .orElseThrow(() -> new HouseholdAccessDeniedException("Authenticated user is unavailable."));
    }

    private String hashInviteCode(String inviteCode) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(inviteCode.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

}
