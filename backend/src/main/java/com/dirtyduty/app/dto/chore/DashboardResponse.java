package com.dirtyduty.app.dto.chore;

import java.util.List;

/**
 * Home. {@code householdJobs} lists the open occurrence of every active "When needed" chore, for
 * every member (participants or not); those chores are not repeated in {@code today} or {@code
 * thisWeek}.
 */
public record DashboardResponse(
    WeekSummary weekSummary,
    List<AssignmentResponse> today,
    List<AssignmentResponse> thisWeek,
    List<AssignmentResponse> overdue,
    List<AssignmentResponse> householdJobs) {
  public record WeekSummary(long completedCount, long totalCount, double completionPercentage) {}
}
