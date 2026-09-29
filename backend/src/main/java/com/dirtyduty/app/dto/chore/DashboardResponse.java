package com.dirtyduty.app.dto.chore;

import java.util.List;

public record DashboardResponse(WeekSummary weekSummary, List<AssignmentResponse> today,
        List<AssignmentResponse> thisWeek) {
    public record WeekSummary(long completedCount, long totalCount, double completionPercentage) {}
}
