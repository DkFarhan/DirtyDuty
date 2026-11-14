package com.dirtyduty.app.entity.enums;

/**
 * How a chore repeats.
 *
 * <ul>
 *   <li>{@code CALENDAR}: dates come from the recurrence rule (including one-time chores).
 *   <li>{@code AFTER_COMPLETION}: one open occurrence; the next is due an interval after the last
 *       completion.
 *   <li>{@code AS_NEEDED}: one open occurrence anyone in the rotation can do, with an optional
 *       backstop deadline and a "Needs doing" flag.
 * </ul>
 */
public enum ScheduleKind {
  CALENDAR,
  AFTER_COMPLETION,
  AS_NEEDED
}
