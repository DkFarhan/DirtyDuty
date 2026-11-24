package com.dirtyduty.app.dto.chore;

import java.util.UUID;

/**
 * A hand-off or swap request (E11). {@code type} is HANDOFF or SWAP. A hand-off with no {@code
 * targetUserId} goes to anyone who can take it; a swap needs the target and {@code
 * swapOccurrenceId}, one of their pending chores.
 */
public record ChoreRequestCreate(
    String type, UUID occurrenceId, UUID targetUserId, UUID swapOccurrenceId) {}
