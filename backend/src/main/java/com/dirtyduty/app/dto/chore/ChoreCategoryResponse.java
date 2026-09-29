package com.dirtyduty.app.dto.chore;

import java.util.UUID;
import java.time.OffsetDateTime;

public record ChoreCategoryResponse(UUID id, String name, String iconKey, int sortOrder, OffsetDateTime createdAt) {
}
