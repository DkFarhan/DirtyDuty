package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.household.CreateHouseholdRequest;
import com.dirtyduty.app.dto.household.CreateInvitationResponse;
import com.dirtyduty.app.dto.household.DeleteHouseholdRequest;
import com.dirtyduty.app.dto.household.HouseholdInvitationSummaryResponse;
import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.dto.household.JoinHouseholdRequest;
import com.dirtyduty.app.dto.household.RemoveMemberResponse;
import com.dirtyduty.app.dto.household.UpdateMemberRoleRequest;
import com.dirtyduty.app.service.HouseholdService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/households")
public class HouseholdController {

  private final HouseholdService householdService;

  public HouseholdController(HouseholdService householdService) {
    this.householdService = householdService;
  }

  @GetMapping
  public List<HouseholdResponse> listHouseholds(Authentication authentication) {
    return householdService.listCurrentUserHouseholds(authentication);
  }

  @PostMapping
  public ResponseEntity<HouseholdResponse> createHousehold(
      @Valid @RequestBody CreateHouseholdRequest request, Authentication authentication) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(householdService.createHousehold(request, authentication));
  }

  @PostMapping("/{householdId}/invitations")
  public ResponseEntity<CreateInvitationResponse> createInvitation(
      @PathVariable UUID householdId, Authentication authentication) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(householdService.createInvitation(householdId, authentication));
  }

  @GetMapping("/{householdId}/invitations")
  public List<HouseholdInvitationSummaryResponse> listInvitations(
      @PathVariable UUID householdId, Authentication authentication) {
    return householdService.listActiveInvitations(householdId, authentication);
  }

  @DeleteMapping("/{householdId}/invitations/{invitationId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revokeInvitation(
      @PathVariable UUID householdId,
      @PathVariable UUID invitationId,
      Authentication authentication) {
    householdService.revokeInvitation(householdId, invitationId, authentication);
  }

  @DeleteMapping("/{householdId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteHousehold(
      @PathVariable UUID householdId,
      @Valid @RequestBody DeleteHouseholdRequest request,
      Authentication authentication) {
    householdService.deleteHousehold(householdId, request, authentication);
  }

  @PutMapping("/{householdId}/members/{userId}/role")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void updateMemberRole(
      @PathVariable UUID householdId,
      @PathVariable UUID userId,
      @Valid @RequestBody UpdateMemberRoleRequest request,
      Authentication authentication) {
    householdService.updateMemberRole(householdId, userId, request.role(), authentication);
  }

  @DeleteMapping("/{householdId}/members/{userId}")
  public RemoveMemberResponse removeMember(
      @PathVariable UUID householdId, @PathVariable UUID userId, Authentication authentication) {
    return householdService.removeMember(householdId, userId, authentication);
  }

  @PostMapping("/{householdId}/members/{userId}/remove")
  public RemoveMemberResponse removeMemberAlternate(
      @PathVariable UUID householdId, @PathVariable UUID userId, Authentication authentication) {
    return householdService.removeMember(householdId, userId, authentication);
  }

  @PostMapping("/{householdId}/members/{userId}/transfer-ownership")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void transferOwnership(
      @PathVariable UUID householdId, @PathVariable UUID userId, Authentication authentication) {
    householdService.transferOwnership(householdId, userId, authentication);
  }

  @PostMapping("/{householdId}/transfer-ownership")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void transferOwnershipBody(
      @PathVariable UUID householdId,
      @Valid @RequestBody java.util.Map<String, UUID> payload,
      Authentication authentication) {
    UUID userId = payload.get("userId");
    if (userId == null) {
      throw new IllegalArgumentException("userId is required.");
    }
    householdService.transferOwnership(householdId, userId, authentication);
  }

  @PostMapping("/join")
  public HouseholdResponse joinHousehold(
      @Valid @RequestBody JoinHouseholdRequest request, Authentication authentication) {
    return householdService.joinHousehold(request, authentication);
  }
}
