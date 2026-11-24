package com.dirtyduty.app.dto.chore;

import java.util.List;

/**
 * Home. {@code householdJobs} lists the open occurrence of every active "When needed" chore, for
 * every member (participants or not); those chores are not repeated in {@code today} or {@code
 * thisWeek}. Week numbers follow the week credit rules in OccurrenceService. {@code myWeeks} lists
 * the Week by week chores the viewer has this period. {@code hasChores}: whether the household has
 * any chore (active or paused).
 */
public record DashboardResponse(
    WeekSummary weekSummary,
    PersonalWeek personalWeek,
    List<AssignmentResponse> today,
    List<AssignmentResponse> thisWeek,
    List<AssignmentResponse> overdue,
    List<AssignmentResponse> householdJobs,
    List<MyWeek> myWeeks,
    boolean hasChores) {
  public record WeekSummary(long completedCount, long totalCount, double completionPercentage) {}

  /**
   * The viewer's week: what was planned for them plus what they did for others or early, and what
   * they completed (credit goes to whoever completed it, in the week they did).
   */
  public record PersonalWeek(long assignedCount, long completedCount) {}

  /**
   * A Week by week chore the viewer has until {@code until} (inclusive); {@code next} has it after
   * that (null when nobody else is in the rotation).
   */
  public record MyWeek(
      java.util.UUID choreId,
      String title,
      String categoryName,
      java.time.LocalDate until,
      AssignmentResponse.Person next) {}
}
