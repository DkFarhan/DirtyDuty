package com.dirtyduty.app.service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.Map;

/**
 * Rotation settings kept in a schedule's {@code strategy_config} (no column of their own):
 *
 * <ul>
 *   <li>{@value #EVERYONE}: the people are every active member, worked out again whenever the
 *       schedule is generated, so people who join are added (level) and people who leave drop out.
 *       {@code participantUserIds} still holds the current list, in rotation order.
 *   <li>{@value #WEEKS} and {@value #STARTS_ON}: "Week by week" on a calendar Take turns chore. One
 *       person has every occurrence for {@code rotationWeeks} weeks, then the next. Periods start
 *       on Mondays (in the household's calendar), counted from {@code rotationStartsOn}, a Monday.
 * </ul>
 */
final class RotationConfig {
  static final String EVERYONE = "everyone";
  static final String WEEKS = "rotationWeeks";
  static final String STARTS_ON = "rotationStartsOn";
  static final int MAX_WEEKS = 8;

  private RotationConfig() {}

  static boolean everyone(Map<String, Object> config) {
    return config != null && Boolean.TRUE.equals(config.get(EVERYONE));
  }

  /** The Week by week length in weeks, or null when the chore isn't Week by week. */
  static Integer weeks(Map<String, Object> config) {
    Object value = config == null ? null : config.get(WEEKS);
    if (value instanceof Number number && number.intValue() >= 1) {
      return Math.min(MAX_WEEKS, number.intValue());
    }
    return null;
  }

  /** The Monday the Week by week periods are counted from, or null. */
  static LocalDate startsOn(Map<String, Object> config) {
    Object value = config == null ? null : config.get(STARTS_ON);
    if (value == null) {
      return null;
    }
    try {
      return monday(LocalDate.parse(String.valueOf(value)));
    } catch (DateTimeParseException ignored) {
      return null;
    }
  }

  static LocalDate monday(LocalDate date) {
    return date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
  }

  /** The first Monday after {@code date} (a week later when it is a Monday). */
  static LocalDate nextMonday(LocalDate date) {
    return date.with(TemporalAdjusters.next(DayOfWeek.MONDAY));
  }

  /** Which period {@code date} falls in, counted from {@code anchor} (negative before it). */
  static long periodIndex(LocalDate anchor, int weeks, LocalDate date) {
    long weeksSince = ChronoUnit.WEEKS.between(anchor, monday(date));
    return Math.floorDiv(weeksSince, weeks);
  }

  /** The Monday the period holding {@code date} starts on. */
  static LocalDate periodStart(LocalDate anchor, int weeks, LocalDate date) {
    return anchor.plusWeeks(periodIndex(anchor, weeks, date) * weeks);
  }

  /** The Monday the next period starts on (strictly after {@code date}'s period). */
  static LocalDate nextBoundary(LocalDate anchor, int weeks, LocalDate date) {
    return periodStart(anchor, weeks, date).plusWeeks(weeks);
  }
}
