package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

public record LegalAcceptanceRequest(
    @NotNull @AssertTrue Boolean termsAccepted,
    @NotNull @AssertTrue Boolean privacyPolicyAcknowledged) {}
