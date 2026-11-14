package com.dirtyduty.app.dto.chore;

import java.time.LocalDate;
import java.time.LocalTime;

/** Move one occurrence to {@code date}; {@code time} optionally changes its due time too. */
public record MoveAssignmentRequest(LocalDate date, LocalTime time) {}
