package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.household.HouseholdSettingsRequest;
import com.dirtyduty.app.dto.household.HouseholdSettingsResponse;
import com.dirtyduty.app.dto.household.LeaveHouseholdRequest;
import com.dirtyduty.app.service.HouseholdSettingsService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/households/{householdId}")
public class HouseholdSettingsController {
    private final HouseholdSettingsService settingsService;

    public HouseholdSettingsController(HouseholdSettingsService settingsService) {
        this.settingsService = settingsService;
    }

    @GetMapping("/settings")
    public HouseholdSettingsResponse get(
            @PathVariable UUID householdId, Authentication authentication) {
        return settingsService.get(householdId, authentication);
    }

    @PutMapping("/settings")
    public HouseholdSettingsResponse update(
            @PathVariable UUID householdId,
            @Valid @RequestBody HouseholdSettingsRequest request,
            Authentication authentication) {
        return settingsService.update(householdId, request, authentication);
    }

    @PostMapping("/leave")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(
            @PathVariable UUID householdId,
            @RequestBody(required = false) LeaveHouseholdRequest request,
            Authentication authentication) {
        settingsService.leave(householdId, request, authentication);
    }
}
