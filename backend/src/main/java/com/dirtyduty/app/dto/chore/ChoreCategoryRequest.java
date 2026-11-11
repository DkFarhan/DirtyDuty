package com.dirtyduty.app.dto.chore;

/** Create or update a chore category. Validation lives in the service for consistent messages. */
public record ChoreCategoryRequest(String name, String iconKey) {}
