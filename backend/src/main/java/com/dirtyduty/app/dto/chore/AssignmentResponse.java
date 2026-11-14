package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.ChorePriority;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * One chore occurrence as the viewer sees it.
 *
 * <p>{@code status} is PENDING (also covering submitted work), COMPLETED, SKIPPED or CANCELLED.
 * {@code originalDate} is set when the occurrence was moved to another day; {@code moved} also
 * covers a changed due time. {@code actions} says what the viewer may do, so clients do not repeat
 * the permission rules.
 */
public record AssignmentResponse(
    UUID id,
    UUID householdId,
    UUID choreId,
    String categoryName,
    String categoryIcon,
    String title,
    LocalDate scheduledFor,
    OffsetDateTime dueAt,
    String status,
    ChorePriority priority,
    short difficulty,
    Integer estimatedMinutes,
    List<AssigneeResponse> assignees,
    boolean canComplete,
    boolean overdue,
    OffsetDateTime completedAt,
    String completedByDisplayName,
    LocalDate originalDate,
    boolean moved,
    boolean reassigned,
    Actions actions) {

  /**
   * @param moveEarliest first date the viewer may move to (inclusive), when {@code canMove}
   * @param moveLatest last date the viewer may move to (inclusive), or null for no limit
   * @param maxAssignees how many people a reassign may choose (the chore's people needed)
   */
  public record Actions(
      boolean canMove,
      boolean canSkip,
      boolean canUnskip,
      boolean canReassign,
      LocalDate moveEarliest,
      LocalDate moveLatest,
      int maxAssignees) {}
}
