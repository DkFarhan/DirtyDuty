package com.dirtyduty.app.dto.board;

import java.util.UUID;

/**
 * The Shopping list for Home's Board section: open items and how many are needed today. {@code
 * listId} is null until someone first opens Lists (the list is created then).
 */
public record BoardShoppingSummary(UUID listId, int openCount, int todayCount) {}
