package com.dirtyduty.app.dto.chore;

import java.util.List;
import java.util.UUID;

/** Every category id of the household, in the new display order. */
public record ChoreCategoryOrderRequest(List<UUID> categoryIds) {}
