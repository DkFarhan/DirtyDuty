package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.profile.ProfileResponse;
import com.dirtyduty.app.dto.profile.UpdateProfileRequest;
import com.dirtyduty.app.service.ProfileService;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {
    private final ProfileService profileService;

    public ProfileController(ProfileService profileService) {
        this.profileService = profileService;
    }

    @GetMapping
    public ProfileResponse get(Authentication authentication) {
        return profileService.get(authentication);
    }

    @PutMapping
    public ProfileResponse update(
            @Valid @RequestBody UpdateProfileRequest request, Authentication authentication) {
        return profileService.update(request, authentication);
    }
}
