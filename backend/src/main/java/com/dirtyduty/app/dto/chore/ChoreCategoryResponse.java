package com.dirtyduty.app.dto.chore;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ChoreCategoryResponse(
    UUID id, String name, String iconKey, int sortOrder, OffsetDateTime createdAt) {}
