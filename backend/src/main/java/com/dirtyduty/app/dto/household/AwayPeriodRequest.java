package com.dirtyduty.app.dto.household;

import java.time.LocalDate;

/**
 * Away dates for a member: inclusive, in the household's time zone. With {@code untilBack} the end
 * date is left open (it is stored as the 90-day limit). {@code postToBoard} (set only) also posts a
 * heads-up on the Board.
 */
public record AwayPeriodRequest(
    LocalDate startsOn, LocalDate endsOn, Boolean untilBack, Boolean postToBoard) {}
