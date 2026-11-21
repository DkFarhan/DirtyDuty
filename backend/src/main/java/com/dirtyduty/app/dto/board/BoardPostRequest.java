package com.dirtyduty.app.dto.board;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * Create or edit a board post. {@code type} defaults to HEADS_UP and {@code notifyMode} to
 * EVERYONE; the date and times apply to events only.
 */
public record BoardPostRequest(
    String type,
    String title,
    String details,
    LocalDate eventDate,
    LocalTime startTime,
    LocalTime endTime,
    Boolean pinned,
    String notifyMode,
    List<UUID> recipientUserIds) {}
