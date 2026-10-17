package com.dirtyduty.app.dto.auth;

import java.time.OffsetDateTime;

public record LegalAcceptanceResponse(
    String termsVersion, String privacyPolicyVersion, OffsetDateTime acceptedAt) {}
