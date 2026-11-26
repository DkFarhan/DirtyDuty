package com.dirtyduty.app.dto.chore;

import java.util.List;

/**
 * What the chore form needs. {@code defaultReminderMode} is the level a new chore starts with
 * (E13).
 */
public record ChoreManagementOptionsResponse(
    List<ChoreCategoryResponse> categories,
    List<ChoreMemberOptionResponse> activeMembers,
    String defaultReminderMode) {}
