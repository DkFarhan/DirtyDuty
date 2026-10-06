package com.dirtyduty.app.dto.chore;

import java.util.List;

public record ChoreManagementOptionsResponse(
    List<ChoreCategoryResponse> categories, List<ChoreMemberOptionResponse> activeMembers) {}
