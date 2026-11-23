package com.dirtyduty.app.dto.board;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * Create or edit a board post. {@code type} defaults to HEADS_UP and {@code notifyMode} to
 * EVERYONE; the date and times apply to events only. {@code urgent} (on create) notifies everyone
 * even during quiet hours, at most one urgent post per member per hour.
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
    List<UUID> recipientUserIds,
    Boolean urgent) {

  /** A post that isn't urgent. */
  public BoardPostRequest(
      String type,
      String title,
      String details,
      LocalDate eventDate,
      LocalTime startTime,
      LocalTime endTime,
      Boolean pinned,
      String notifyMode,
      List<UUID> recipientUserIds) {
    this(
        type,
        title,
        details,
        eventDate,
        startTime,
        endTime,
        pinned,
        notifyMode,
        recipientUserIds,
        null);
  }
}
