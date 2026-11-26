package com.dirtyduty.app.service;

import com.dirtyduty.app.exception.InvalidHouseholdException;
import java.util.List;

/**
 * Reminder levels (E13), as stored: OFF (Off), FRIENDLY (Light), STANDARD (Standard), AGGRESSIVE
 * (Full) and INTENSE (Intense). Each level's timed reminders are its rows in
 * notification_reminder_rules; OFF has none. CUSTOM is allowed by the database but can't be chosen.
 */
public final class ReminderModes {
  public static final String DEFAULT = "STANDARD";
  public static final List<String> CHOOSABLE =
      List.of("OFF", "FRIENDLY", "STANDARD", "AGGRESSIVE", "INTENSE");
  static final String INVALID = "Choose a reminder level.";

  private ReminderModes() {}

  /** The level a request names, checked; null stays null ("not given"). */
  public static String parse(String mode) {
    if (mode == null) {
      return null;
    }
    String normalized = mode.strip().toUpperCase(java.util.Locale.ROOT);
    if (!CHOOSABLE.contains(normalized)) {
      throw new InvalidHouseholdException(INVALID);
    }
    return normalized;
  }
}
