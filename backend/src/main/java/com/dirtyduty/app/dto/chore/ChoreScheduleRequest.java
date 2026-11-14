package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * A chore's schedule. {@code kind} defaults to CALENDAR, which uses {@code recurrenceRule}.
 * AFTER_COMPLETION uses {@code intervalCount} and {@code intervalUnit}, with {@code startsOn} as
 * the first due date. AS_NEEDED uses {@code backstopEnabled} (default on) and {@code backstopDays}
 * (default 2). Range checks live in ChoreService so the messages are specific.
 */
public record ChoreScheduleRequest(
    String recurrenceRule,
    @Size(max = 100) String timezone,
    LocalDate startsOn,
    LocalDate endsOn,
    LocalTime dueTime,
    AssignmentStrategy assignmentStrategy,
    UUID fixedAssigneeUserId,
    List<@NotNull UUID> participantUserIds,
    @Min(1) @Max(50) Integer peopleNeeded,
    ScheduleKind kind,
    Integer intervalCount,
    IntervalUnit intervalUnit,
    Boolean backstopEnabled,
    Integer backstopDays) {

  /** A calendar schedule, as clients sent it before chore kinds existed. */
  public ChoreScheduleRequest(
      String recurrenceRule,
      String timezone,
      LocalDate startsOn,
      LocalDate endsOn,
      LocalTime dueTime,
      AssignmentStrategy assignmentStrategy,
      UUID fixedAssigneeUserId,
      List<UUID> participantUserIds,
      Integer peopleNeeded) {
    this(
        recurrenceRule,
        timezone,
        startsOn,
        endsOn,
        dueTime,
        assignmentStrategy,
        fixedAssigneeUserId,
        participantUserIds,
        peopleNeeded,
        null,
        null,
        null,
        null,
        null);
  }
}
