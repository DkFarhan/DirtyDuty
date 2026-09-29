package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.household.CreateHouseholdRequest;
import com.dirtyduty.app.dto.household.CreateInvitationResponse;
import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.dto.household.JoinHouseholdRequest;
import com.dirtyduty.app.entity.Household;
import com.dirtyduty.app.entity.HouseholdInvitation;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.InvalidInvitationException;
import com.dirtyduty.app.mapper.HouseholdMapper;
import com.dirtyduty.app.repository.HouseholdInvitationRepository;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.HouseholdRepository;
import com.dirtyduty.app.repository.ChoreCategoryRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
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
    private final UserRepository userRepository;
    private final Duration invitationExpiration;

    public HouseholdService(
            HouseholdRepository householdRepository,
            HouseholdMembershipRepository householdMembershipRepository,
            HouseholdInvitationRepository householdInvitationRepository,
            ChoreCategoryRepository choreCategoryRepository,
            UserRepository userRepository,
            @Value("${app.households.invitation-expiration:7d}") Duration invitationExpiration) {
        this.householdRepository = householdRepository;
        this.householdMembershipRepository = householdMembershipRepository;
        this.householdInvitationRepository = householdInvitationRepository;
        this.choreCategoryRepository = choreCategoryRepository;
        this.userRepository = userRepository;
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
        if (membership != null && membership.getStatus() == MembershipStatus.REMOVED) {
            throw new HouseholdAccessDeniedException("Unable to join this household.");
        }
        if (membership == null) {
            membership = new HouseholdMembership();
            membership.setHousehold(invitation.getHousehold());
            membership.setUser(user);
        }

        membership.setRole(invitation.getRoleToAssign());
        membership.setStatus(MembershipStatus.ACTIVE);
        membership.setJoinedAt(now);
        membership.setLeftAt(null);
        householdMembershipRepository.save(membership);

        invitation.setUsedAt(now);
        householdInvitationRepository.save(invitation);

        return HouseholdMapper.toResponse(invitation.getHousehold(), membership.getRole());
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
