package com.dirtyduty.app.dto.household;

import com.dirtyduty.app.service.OccurrenceService;
import java.time.LocalDate;
import java.util.List;

/**
 * What setting these away dates would do: the dates as they'd be saved, and each chore's effect.
 */
public record AwayPreviewResponse(
    LocalDate startsOn,
    LocalDate endsOn,
    LocalDate returnsOn,
    int days,
    List<OccurrenceService.AwayEffect> chores) {}
