package com.dirtyduty.app.dto.household;

import java.time.OffsetDateTime;

public record CreateInvitationResponse(String inviteCode, OffsetDateTime expiresAt) {}
