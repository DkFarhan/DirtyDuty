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
 *
 * <p>For AFTER_COMPLETION and AS_NEEDED chores ({@code kind}), {@code turn} is whose turn the open
 * occurrence is, {@code lastDone} the latest completion of the chore before this occurrence, {@code
 * flag} the current "Needs doing" flag (AS_NEEDED, open only), and {@code repeat} the interval or
 * backstop setting. These are null for calendar chores.
 *
 * <p>{@code awayFrom} is the member whose slot this pending occurrence covers because they are away
 * (Away mode); the card says "{awayFrom} is away, so it skipped to {first assignee}".
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
    Actions actions,
    String kind,
    Person turn,
    LastDone lastDone,
    Flag flag,
    Repeat repeat,
    Person awayFrom) {

  public record Person(UUID userId, String displayName) {}

  public record LastDone(OffsetDateTime at, UUID byUserId, String byDisplayName) {}

  public record Flag(OffsetDateTime at, UUID byUserId, String byDisplayName) {}

  /**
   * @param intervalCount AFTER_COMPLETION: every N units after it's done
   * @param intervalUnit DAY or WEEK
   * @param backstopDays AS_NEEDED: at least every N days, or null when the backstop is off
   * @param dueTime the chore's due time ("HH:mm"), or null
   */
  public record Repeat(
      Integer intervalCount, String intervalUnit, Integer backstopDays, String dueTime) {}

  /**
   * @param moveEarliest first date the viewer may move to (inclusive), when {@code canMove}
   * @param moveLatest last date the viewer may move to (inclusive), or null for no limit
   * @param maxAssignees how many people a reassign may choose (the chore's people needed)
   * @param canFlag whether the viewer may press "Needs doing" (any member, AS_NEEDED, open)
   */
  public record Actions(
      boolean canMove,
      boolean canSkip,
      boolean canUnskip,
      boolean canReassign,
      LocalDate moveEarliest,
      LocalDate moveLatest,
      int maxAssignees,
      boolean canFlag) {}
}
