package com.dirtyduty.app.dto.board;

import java.util.UUID;

public record BoardMemberResponse(UUID userId, String displayName, String role) {}
