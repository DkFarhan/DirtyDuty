package com.dirtyduty.app.dto.chore;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A household chore category. {@code choreCount} counts the household's non-archived chores (active
 * or paused) that use it.
 */
public record ChoreCategoryResponse(
    UUID id,
    String name,
    String iconKey,
    int sortOrder,
    OffsetDateTime createdAt,
    long choreCount) {}
