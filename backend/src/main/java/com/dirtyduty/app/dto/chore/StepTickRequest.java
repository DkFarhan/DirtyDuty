package com.dirtyduty.app.dto.chore;

import jakarta.validation.constraints.NotNull;

/** Ticks ({@code true}) or unticks one checklist step on an occurrence (E12). */
public record StepTickRequest(@NotNull Boolean ticked) {}
