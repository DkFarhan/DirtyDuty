package com.dirtyduty.app.dto.household;

import com.dirtyduty.app.service.OccurrenceService;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A member's away mode: their current or upcoming period (null when off) and what it does to their
 * chores. {@code chores} lists each affected chore with {@code effect} SKIPS_YOU, COVERED (by
 * {@code coveredBy}) or PAUSED (resumes {@code resumesOn}).
 */
public record AwayStatusResponse(
    UUID userId, String displayName, Period period, List<OccurrenceService.AwayEffect> chores) {

  /** {@code status} is UPCOMING or ACTIVE; {@code returnsOn} is the day after {@code endsOn}. */
  public record Period(
      UUID id,
      LocalDate startsOn,
      LocalDate endsOn,
      LocalDate returnsOn,
      boolean untilBack,
      String status) {}
}
