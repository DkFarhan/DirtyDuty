package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.household.CreateHouseholdRequest;
import com.dirtyduty.app.dto.household.CreateInvitationResponse;
import com.dirtyduty.app.dto.household.HouseholdResponse;
import com.dirtyduty.app.dto.household.JoinHouseholdRequest;
import com.dirtyduty.app.service.HouseholdService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
            @Valid @RequestBody CreateHouseholdRequest request,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(householdService.createHousehold(request, authentication));
    }

    @PostMapping("/{householdId}/invitations")
    public ResponseEntity<CreateInvitationResponse> createInvitation(
            @PathVariable UUID householdId,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(householdService.createInvitation(householdId, authentication));
    }

    @PostMapping("/join")
    public HouseholdResponse joinHousehold(
            @Valid @RequestBody JoinHouseholdRequest request,
            Authentication authentication) {
        return householdService.joinHousehold(request, authentication);
    }
}
