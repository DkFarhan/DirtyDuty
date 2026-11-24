package com.dirtyduty.app.dto.chore;

/**
 * Whether the household has any chore (active or paused, not archived). A new household with none
 * shows "Start with the basics" instead of its empty states.
 */
public record ChoreStatusResponse(boolean hasChores) {}
