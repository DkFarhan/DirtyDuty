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
 *
 * <p>{@code everyone} (Take turns, Week by week, Balanced or Mix it up) makes the people every
 * active member, now and later; {@code participantUserIds} is then ignored. {@code rotationWeeks}
 * (1 to 8) makes a calendar Take turns chore "Week by week".
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
    Integer backstopDays,
    Boolean everyone,
    Integer rotationWeeks) {

  /** A schedule as clients sent it before "everyone" and Week by week existed. */
  public ChoreScheduleRequest(
      String recurrenceRule,
      String timezone,
      LocalDate startsOn,
      LocalDate endsOn,
      LocalTime dueTime,
      AssignmentStrategy assignmentStrategy,
      UUID fixedAssigneeUserId,
      List<UUID> participantUserIds,
      Integer peopleNeeded,
      ScheduleKind kind,
      Integer intervalCount,
      IntervalUnit intervalUnit,
      Boolean backstopEnabled,
      Integer backstopDays) {
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
        kind,
        intervalCount,
        intervalUnit,
        backstopEnabled,
        backstopDays,
        null,
        null);
  }

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
        null,
        null,
        null);
  }
}
