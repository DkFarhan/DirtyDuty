package com.dirtyduty.app.service;

import com.dirtyduty.app.exception.InvalidHouseholdException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.Month;
import java.time.YearMonth;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * A chore recurrence rule: a strict, normalized subset of RFC 5545 RRULE stored in {@code
 * chore_schedules.recurrence_rule}. Parsed once into this value, validated, normalized to a
 * canonical string and evaluated in the schedule's local calendar (dates only; due times are
 * applied separately in the schedule timezone).
 *
 * <p>Supported forms ({@code [..]} is optional):
 *
 * <ul>
 *   <li>{@code FREQ=ONCE} (one-time chores; nothing else allowed)
 *   <li>{@code FREQ=DAILY[;INTERVAL=n]}
 *   <li>{@code FREQ=WEEKLY[;INTERVAL=n];BYDAY=MO,TU,...}
 *   <li>{@code FREQ=MONTHLY[;INTERVAL=n];BYMONTHDAY=d} with d in 1..31 or -1 (last day)
 *   <li>{@code FREQ=MONTHLY[;INTERVAL=n];BYDAY=<ordinal><day>} with ordinal 1..4 or -1
 *   <li>{@code FREQ=YEARLY[;INTERVAL=n];BYMONTH=m;BYMONTHDAY=d}
 * </ul>
 *
 * plus {@code [;BYMONTH=m1,m2,...]} as a seasonality filter on DAILY, WEEKLY and MONTHLY, and
 * {@code [;COUNT=n]} on any repeating rule.
 *
 * <p>Product rules that deliberately differ from, or pin down, RFC 5545:
 *
 * <ul>
 *   <li><b>Month days 29 to 31 clamp</b> to the last day of shorter months (Feb 28, or Feb 29 in
 *       leap years) instead of skipping the month. RFC 5545 would skip it.
 *   <li><b>INTERVAL anchors on starts_on</b>: every n days from the start date, every n weeks
 *       counted from the Monday of the start week (the legacy weekly behaviour), every n months
 *       from the start month, every n years from the start year.
 *   <li><b>Seasonality (BYMONTH)</b> only filters dates the rule produces; it never shifts them.
 *   <li><b>COUNT</b> counts the dates the rule actually produces from starts_on, after the
 *       seasonality filter, regardless of completions. After the n-th date nothing more is
 *       produced. It is evaluated against the current rule, so editing a rule recomputes which
 *       dates are the first n (past occurrences already stored are never touched).
 * </ul>
 */
public final class RecurrenceRule {
  public enum Frequency {
    ONCE,
    DAILY,
    WEEKLY,
    MONTHLY,
    YEARLY
  }

  public static final int MAX_COUNT = 999;

  /** A valid repeating rule must produce at least one date within this many years. */
  static final int FIRST_DATE_SEARCH_YEARS = 10;

  /** Hard stop for date iteration, so a malformed stored rule can never loop forever. */
  private static final int ITERATION_LIMIT_YEARS = 200;

  private static final Pattern INTEGER = Pattern.compile("-?[0-9]{1,4}");
  private static final Pattern ORDINAL_DAY = Pattern.compile("(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)");
  private static final Map<String, DayOfWeek> DAYS =
      Map.of(
          "MO", DayOfWeek.MONDAY,
          "TU", DayOfWeek.TUESDAY,
          "WE", DayOfWeek.WEDNESDAY,
          "TH", DayOfWeek.THURSDAY,
          "FR", DayOfWeek.FRIDAY,
          "SA", DayOfWeek.SATURDAY,
          "SU", DayOfWeek.SUNDAY);
  private static final Set<String> KEYS =
      Set.of("FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT");

  private final Frequency frequency;
  private final int interval;
  private final List<DayOfWeek> weekdays;
  private final Integer monthDay;
  private final Integer ordinal;
  private final DayOfWeek ordinalWeekday;
  private final Month yearMonth;
  private final Set<Month> activeMonths;
  private final Integer count;

  private RecurrenceRule(
      Frequency frequency,
      int interval,
      List<DayOfWeek> weekdays,
      Integer monthDay,
      Integer ordinal,
      DayOfWeek ordinalWeekday,
      Month yearMonth,
      Set<Month> activeMonths,
      Integer count) {
    this.frequency = frequency;
    this.interval = interval;
    this.weekdays = weekdays;
    this.monthDay = monthDay;
    this.ordinal = ordinal;
    this.ordinalWeekday = ordinalWeekday;
    this.yearMonth = yearMonth;
    this.activeMonths = activeMonths;
    this.count = count;
  }

  /** Parses and validates a rule, throwing a user-facing message when it is not supported. */
  public static RecurrenceRule parse(String rule) {
    if (rule == null || rule.isBlank()) {
      throw invalid("Choose how often the chore repeats.");
    }
    Map<String, String> fields = new LinkedHashMap<>();
    for (String part : rule.strip().split(";", -1)) {
      int separator = part.indexOf('=');
      if (separator <= 0 || separator != part.lastIndexOf('=')) {
        throw invalid("This repeat rule is not supported.");
      }
      String key = part.substring(0, separator);
      String value = part.substring(separator + 1);
      if (!KEYS.contains(key) || value.isEmpty()) {
        throw invalid("This repeat rule is not supported.");
      }
      if (fields.putIfAbsent(key, value) != null) {
        throw invalid("This repeat rule is not supported.");
      }
    }

    Frequency frequency;
    try {
      frequency = Frequency.valueOf(Objects.requireNonNullElse(fields.get("FREQ"), ""));
    } catch (IllegalArgumentException exception) {
      throw invalid("This repeat rule is not supported.");
    }
    if (frequency == Frequency.ONCE) {
      if (fields.size() != 1) {
        throw invalid("A one-time chore cannot have repeat options.");
      }
      return new RecurrenceRule(
          Frequency.ONCE, 1, List.of(), null, null, null, null, Set.of(), null);
    }

    int interval = 1;
    if (fields.containsKey("INTERVAL")) {
      interval = integer(fields.get("INTERVAL"));
      int max = maxInterval(frequency);
      if (interval < 1 || interval > max) {
        throw invalid(
            "Repeat every must be between 1 and %d %s.".formatted(max, unitName(frequency)));
      }
    }

    Integer count = null;
    if (fields.containsKey("COUNT")) {
      count = integer(fields.get("COUNT"));
      if (count < 1 || count > MAX_COUNT) {
        throw invalid("The number of times must be between 1 and %d.".formatted(MAX_COUNT));
      }
    }

    List<DayOfWeek> weekdays = List.of();
    Integer monthDay = null;
    Integer ordinal = null;
    DayOfWeek ordinalWeekday = null;
    Month yearMonth = null;
    Set<Month> activeMonths = Set.of();

    switch (frequency) {
      case DAILY -> {
        reject(fields, "BYDAY", "BYMONTHDAY");
        activeMonths = seasonality(fields.get("BYMONTH"));
      }
      case WEEKLY -> {
        reject(fields, "BYMONTHDAY");
        weekdays = weekdays(fields.get("BYDAY"));
        activeMonths = seasonality(fields.get("BYMONTH"));
      }
      case MONTHLY -> {
        boolean byDay = fields.containsKey("BYDAY");
        boolean byMonthDay = fields.containsKey("BYMONTHDAY");
        if (byDay == byMonthDay) {
          throw invalid("Choose either a day of the month or a weekday of the month.");
        }
        if (byMonthDay) {
          monthDay = monthDay(fields.get("BYMONTHDAY"), true);
        } else {
          var matcher = ORDINAL_DAY.matcher(fields.get("BYDAY"));
          if (!matcher.matches()) {
            throw invalid("Choose the 1st, 2nd, 3rd, 4th or last weekday of the month.");
          }
          ordinal = Integer.parseInt(matcher.group(1));
          ordinalWeekday = DAYS.get(matcher.group(2));
        }
        activeMonths = seasonality(fields.get("BYMONTH"));
      }
      case YEARLY -> {
        reject(fields, "BYDAY");
        if (!fields.containsKey("BYMONTH") || !fields.containsKey("BYMONTHDAY")) {
          throw invalid("Choose the month and day for a yearly chore.");
        }
        String monthValue = fields.get("BYMONTH");
        if (monthValue.contains(",")) {
          throw invalid("Choose one month for a yearly chore.");
        }
        yearMonth = month(monthValue);
        monthDay = monthDay(fields.get("BYMONTHDAY"), false);
        if (monthDay > yearMonth.maxLength()) {
          throw invalid(
              "%s has only %d days.".formatted(displayName(yearMonth), yearMonth.maxLength()));
        }
      }
      default -> throw invalid("This repeat rule is not supported.");
    }

    return new RecurrenceRule(
        frequency,
        interval,
        weekdays,
        monthDay,
        ordinal,
        ordinalWeekday,
        yearMonth,
        activeMonths,
        count);
  }

  public Frequency frequency() {
    return frequency;
  }

  public int interval() {
    return interval;
  }

  public boolean isOneTime() {
    return frequency == Frequency.ONCE;
  }

  public Optional<Integer> count() {
    return Optional.ofNullable(count);
  }

  public Set<Month> activeMonths() {
    return activeMonths;
  }

  /** The canonical string stored for this rule. Existing stored rules keep their meaning. */
  @Override
  public String toString() {
    List<String> parts = new ArrayList<>();
    parts.add("FREQ=" + frequency.name());
    if (frequency == Frequency.ONCE) {
      return parts.getFirst();
    }
    if (interval > 1) {
      parts.add("INTERVAL=" + interval);
    }
    switch (frequency) {
      case WEEKLY ->
          parts.add(
              "BYDAY="
                  + weekdays.stream()
                      .map(day -> day.name().substring(0, 2))
                      .collect(Collectors.joining(",")));
      case MONTHLY -> {
        if (monthDay != null) {
          parts.add("BYMONTHDAY=" + monthDay);
        } else {
          parts.add("BYDAY=" + ordinal + ordinalWeekday.name().substring(0, 2));
        }
      }
      case YEARLY -> {
        parts.add("BYMONTH=" + yearMonth.getValue());
        parts.add("BYMONTHDAY=" + monthDay);
      }
      default -> {}
    }
    if (!activeMonths.isEmpty()) {
      parts.add(
          "BYMONTH="
              + activeMonths.stream()
                  .map(month -> Integer.toString(month.getValue()))
                  .collect(Collectors.joining(",")));
    }
    if (count != null) {
      parts.add("COUNT=" + count);
    }
    return String.join(";", parts);
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof RecurrenceRule rule && toString().equals(rule.toString());
  }

  @Override
  public int hashCode() {
    return toString().hashCode();
  }

  /** Whether the rule produces {@code date} for a schedule starting on {@code startsOn}. */
  public boolean occursOn(LocalDate startsOn, LocalDate date) {
    if (date.isBefore(startsOn)) {
      return false;
    }
    boolean[] found = {false};
    forEachDate(
        startsOn,
        date.plusDays(1),
        produced -> {
          if (produced.equals(date)) {
            found[0] = true;
            return false;
          }
          return true;
        });
    return found[0];
  }

  /** Produced dates in {@code [from, untilExclusive)}, in order, honouring COUNT. */
  public List<LocalDate> datesBetween(
      LocalDate startsOn, LocalDate from, LocalDate untilExclusive) {
    List<LocalDate> dates = new ArrayList<>();
    forEachDate(
        startsOn,
        untilExclusive,
        produced -> {
          if (!produced.isBefore(from)) {
            dates.add(produced);
          }
          return true;
        });
    return dates;
  }

  /** How many dates the rule produces before {@code target} (the occurrence index). */
  public int countBefore(LocalDate startsOn, LocalDate target) {
    int[] index = {0};
    forEachDate(
        startsOn,
        target,
        produced -> {
          index[0]++;
          return true;
        });
    return index[0];
  }

  /** The first produced date, searched up to {@link #FIRST_DATE_SEARCH_YEARS} after start. */
  public Optional<LocalDate> firstDate(LocalDate startsOn) {
    List<LocalDate> first = new ArrayList<>(1);
    forEachDate(
        startsOn,
        startsOn.plusYears(FIRST_DATE_SEARCH_YEARS),
        produced -> {
          first.add(produced);
          return false;
        });
    return first.stream().findFirst();
  }

  /**
   * Walks produced dates from {@code startsOn} in order until {@code untilExclusive}, the COUNT
   * limit, or the consumer returning false. Steps by period (day, week, month or year), so cost
   * grows with the number of periods, not the number of calendar days.
   */
  private void forEachDate(
      LocalDate startsOn, LocalDate untilExclusive, Predicate<LocalDate> consumer) {
    LocalDate stop = minDate(untilExclusive, startsOn.plusYears(ITERATION_LIMIT_YEARS));
    int[] produced = {0};
    Predicate<LocalDate> emit =
        date -> {
          if (!activeMonths.isEmpty() && !activeMonths.contains(date.getMonth())) {
            return true;
          }
          produced[0]++;
          boolean keepGoing = consumer.test(date);
          return keepGoing && (count == null || produced[0] < count);
        };

    switch (frequency) {
      case ONCE -> {
        if (startsOn.isBefore(stop)) {
          consumer.test(startsOn);
        }
      }
      case DAILY -> {
        for (LocalDate date = startsOn; date.isBefore(stop); date = date.plusDays(interval)) {
          if (!emit.test(date)) {
            return;
          }
        }
      }
      case WEEKLY -> {
        for (LocalDate week = startsOn.with(DayOfWeek.MONDAY);
            week.isBefore(stop);
            week = week.plusWeeks(interval)) {
          for (DayOfWeek day : weekdays) {
            LocalDate date = week.plusDays(day.getValue() - 1L);
            if (date.isBefore(startsOn)) {
              continue;
            }
            if (!date.isBefore(stop) || !emit.test(date)) {
              return;
            }
          }
        }
      }
      case MONTHLY -> {
        for (YearMonth month = YearMonth.from(startsOn);
            month.atDay(1).isBefore(stop);
            month = month.plusMonths(interval)) {
          LocalDate date = dayInMonth(month);
          if (date.isBefore(startsOn)) {
            continue;
          }
          if (!date.isBefore(stop) || !emit.test(date)) {
            return;
          }
        }
      }
      case YEARLY -> {
        for (int year = startsOn.getYear(); ; year += interval) {
          YearMonth month = YearMonth.of(year, yearMonth);
          if (!month.atDay(1).isBefore(stop)) {
            return;
          }
          LocalDate date = dayInMonth(month);
          if (date.isBefore(startsOn)) {
            continue;
          }
          if (!date.isBefore(stop) || !emit.test(date)) {
            return;
          }
        }
      }
      default -> throw new IllegalStateException("Unhandled frequency " + frequency);
    }
  }

  private LocalDate dayInMonth(YearMonth month) {
    if (ordinal != null) {
      if (ordinal == -1) {
        return month.atEndOfMonth().with(TemporalAdjusters.lastInMonth(ordinalWeekday));
      }
      return month
          .atDay(1)
          .with(TemporalAdjusters.firstInMonth(ordinalWeekday))
          .plusWeeks(ordinal - 1L);
    }
    // Days 29 to 31 (and -1) clamp to the month's last day; see the class comment.
    int day = monthDay == -1 ? month.lengthOfMonth() : Math.min(monthDay, month.lengthOfMonth());
    return month.atDay(day);
  }

  private static LocalDate minDate(LocalDate first, LocalDate second) {
    return first.isBefore(second) ? first : second;
  }

  private static int maxInterval(Frequency frequency) {
    return switch (frequency) {
      case DAILY -> 365;
      case WEEKLY -> 52;
      case MONTHLY -> 24;
      case YEARLY -> 10;
      default -> 1;
    };
  }

  private static String unitName(Frequency frequency) {
    return switch (frequency) {
      case DAILY -> "days";
      case WEEKLY -> "weeks";
      case MONTHLY -> "months";
      case YEARLY -> "years";
      default -> "";
    };
  }

  private static void reject(Map<String, String> fields, String... keys) {
    for (String key : keys) {
      if (fields.containsKey(key)) {
        throw invalid("This repeat rule is not supported.");
      }
    }
  }

  private static List<DayOfWeek> weekdays(String value) {
    if (value == null) {
      throw invalid("Choose at least one day to repeat.");
    }
    Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
    String[] values = value.split(",", -1);
    for (String day : values) {
      DayOfWeek parsed = DAYS.get(day);
      if (parsed == null || !days.add(parsed)) {
        throw invalid("Choose valid, distinct days to repeat on.");
      }
    }
    return List.copyOf(days);
  }

  private static Set<Month> seasonality(String value) {
    if (value == null) {
      return Set.of();
    }
    Set<Month> months = EnumSet.noneOf(Month.class);
    for (String part : value.split(",", -1)) {
      if (!months.add(month(part))) {
        throw invalid("Choose distinct active months.");
      }
    }
    // Every month active is the same as no seasonality; keep the canonical form short.
    return months.size() == 12 ? Set.of() : java.util.Collections.unmodifiableSet(months);
  }

  private static Month month(String value) {
    int month = integer(value);
    if (month < 1 || month > 12) {
      throw invalid("Months must be between 1 and 12.");
    }
    return Month.of(month);
  }

  private static int monthDay(String value, boolean allowLast) {
    int day = integer(value);
    if ((day < 1 || day > 31) && !(allowLast && day == -1)) {
      throw invalid("Choose a day of the month between 1 and 31.");
    }
    return day;
  }

  private static int integer(String value) {
    if (value == null || !INTEGER.matcher(value).matches()) {
      throw invalid("This repeat rule is not supported.");
    }
    return Integer.parseInt(value);
  }

  private static String displayName(Month month) {
    String name = month.name();
    return name.charAt(0) + name.substring(1).toLowerCase(java.util.Locale.ROOT);
  }

  private static InvalidHouseholdException invalid(String message) {
    return new InvalidHouseholdException(message);
  }
}
