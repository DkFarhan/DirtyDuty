package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.household.HouseholdSettingsRequest;
import com.dirtyduty.app.dto.household.HouseholdSettingsResponse;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.time.DateTimeException;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
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

    public HouseholdSettingsService(
            JdbcTemplate jdbc,
            HouseholdMembershipRepository membershipRepository,
            UserRepository userRepository) {
        this.jdbc = jdbc;
        this.membershipRepository = membershipRepository;
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public HouseholdSettingsResponse get(UUID householdId, Authentication authentication) {
        HouseholdMembership membership = activeMembership(householdId, authentication);
        return jdbc.queryForObject("""
                SELECT id, name, description, timezone, notification_style, created_at
                FROM households WHERE id=?
                """, (rs, row) -> new HouseholdSettingsResponse(
                rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("description"),
                rs.getString("timezone"), rs.getString("notification_style"), membership.getRole(),
                rs.getObject("created_at", OffsetDateTime.class)), householdId);
    }

    @Transactional
    public HouseholdSettingsResponse update(
            UUID householdId, HouseholdSettingsRequest request, Authentication authentication) {
        HouseholdMembership membership = activeMembership(householdId, authentication);
        if (membership.getRole() != HouseholdRole.OWNER) {
            throw new HouseholdAccessDeniedException("Only the household owner can update household settings.");
        }
        String name = request.name().strip();
        String timezone = request.timezone().strip();
        String description = request.description() == null || request.description().isBlank()
                ? null : request.description().strip();
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
        jdbc.update("""
                UPDATE households SET name=?, description=?, timezone=?, updated_at=?
                WHERE id=?
                """, name, description, timezone, OffsetDateTime.now(ZoneOffset.UTC), householdId);
        return get(householdId, authentication);
    }

    @Transactional
    public void leave(UUID householdId, Authentication authentication) {
        HouseholdMembership membership = activeMembership(householdId, authentication);
        if (membership.getRole() == HouseholdRole.OWNER) {
            throw new HouseholdAccessDeniedException(
                    "The household owner cannot leave until ownership transfer is supported.");
        }
        membership.setStatus(MembershipStatus.LEFT);
        membership.setLeftAt(OffsetDateTime.now(ZoneOffset.UTC));
        membershipRepository.save(membership);
    }

    private HouseholdMembership activeMembership(UUID householdId, Authentication authentication) {
        User user = currentUser(authentication);
        return membershipRepository.findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException(
                        "You are not an active member of this household."));
    }

    private User currentUser(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new HouseholdAccessDeniedException("Authentication is required.");
        }
        return userRepository.findByEmailIgnoreCase(authentication.getName())
                .orElseThrow(() -> new ResourceNotFoundException("Authenticated user was not found."));
    }
}
