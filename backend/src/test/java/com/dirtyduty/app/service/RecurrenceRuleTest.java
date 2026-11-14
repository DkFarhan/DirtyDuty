package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.exception.InvalidHouseholdException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class RecurrenceRuleTest {

  // ---- parsing and normalization ----

  @ParameterizedTest
  @CsvSource(
      delimiter = '|',
      value = {
        "FREQ=ONCE | FREQ=ONCE",
        "FREQ=DAILY | FREQ=DAILY",
        "FREQ=DAILY;INTERVAL=1 | FREQ=DAILY",
        "FREQ=DAILY;INTERVAL=3 | FREQ=DAILY;INTERVAL=3",
        "FREQ=WEEKLY;BYDAY=MO | FREQ=WEEKLY;BYDAY=MO",
        "FREQ=WEEKLY;BYDAY=TH,MO,SU | FREQ=WEEKLY;BYDAY=MO,TH,SU",
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR | FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR",
        "BYDAY=FR;FREQ=WEEKLY;INTERVAL=2 | FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
        "FREQ=MONTHLY;BYMONTHDAY=15 | FREQ=MONTHLY;BYMONTHDAY=15",
        "FREQ=MONTHLY;BYMONTHDAY=-1 | FREQ=MONTHLY;BYMONTHDAY=-1",
        "FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU | FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU",
        "FREQ=MONTHLY;BYDAY=-1FR | FREQ=MONTHLY;BYDAY=-1FR",
        "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14 | FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14",
        "FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29 | FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29",
        "FREQ=WEEKLY;BYDAY=MO;BYMONTH=3,11,1,12 | FREQ=WEEKLY;BYDAY=MO;BYMONTH=1,3,11,12",
        "FREQ=DAILY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12 | FREQ=DAILY",
        "FREQ=WEEKLY;BYDAY=MO,TH;COUNT=10 | FREQ=WEEKLY;BYDAY=MO,TH;COUNT=10",
        "COUNT=10;FREQ=MONTHLY;BYMONTH=11,12;BYMONTHDAY=1 | FREQ=MONTHLY;BYMONTHDAY=1;BYMONTH=11,12;COUNT=10"
      })
  void parsesAndNormalizesEverySupportedForm(String input, String canonical) {
    RecurrenceRule rule = RecurrenceRule.parse(input);

    assertThat(rule).hasToString(canonical);
    assertThat(RecurrenceRule.parse(rule.toString())).isEqualTo(rule);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "FREQ=HOURLY",
        "freq=daily",
        "FREQ=DAILY;",
        "FREQ=DAILY;FREQ=DAILY",
        "FREQ=DAILY;UNTIL=20270101",
        "FREQ=ONCE;COUNT=1",
        "FREQ=DAILY;INTERVAL=0",
        "FREQ=DAILY;INTERVAL=366",
        "FREQ=WEEKLY;INTERVAL=53;BYDAY=MO",
        "FREQ=MONTHLY;INTERVAL=25;BYMONTHDAY=1",
        "FREQ=YEARLY;INTERVAL=11;BYMONTH=1;BYMONTHDAY=1",
        "FREQ=DAILY;INTERVAL=+3",
        "FREQ=DAILY;BYDAY=MO",
        "FREQ=WEEKLY",
        "FREQ=WEEKLY;BYDAY=",
        "FREQ=WEEKLY;BYDAY=MO,MO",
        "FREQ=WEEKLY;BYDAY=XX",
        "FREQ=WEEKLY;BYDAY=MO;BYMONTHDAY=3",
        "FREQ=MONTHLY",
        "FREQ=MONTHLY;BYMONTHDAY=1;BYDAY=1MO",
        "FREQ=MONTHLY;BYMONTHDAY=0",
        "FREQ=MONTHLY;BYMONTHDAY=32",
        "FREQ=MONTHLY;BYMONTHDAY=-2",
        "FREQ=MONTHLY;BYDAY=5MO",
        "FREQ=MONTHLY;BYDAY=MO",
        "FREQ=MONTHLY;BYDAY=-2FR",
        "FREQ=YEARLY;BYMONTHDAY=1",
        "FREQ=YEARLY;BYMONTH=13;BYMONTHDAY=1",
        "FREQ=YEARLY;BYMONTH=1,2;BYMONTHDAY=1",
        "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31",
        "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
        "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=-1",
        "FREQ=DAILY;BYMONTH=0",
        "FREQ=DAILY;BYMONTH=3,3",
        "FREQ=DAILY;COUNT=0",
        "FREQ=DAILY;COUNT=1000"
      })
  void rejectsUnsupportedContradictoryAndOutOfRangeRules(String input) {
    assertThatThrownBy(() -> RecurrenceRule.parse(input))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessageNotContaining("null");
  }

  @Test
  void rejectionsUseClearMessages() {
    assertThatThrownBy(() -> RecurrenceRule.parse("FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31"))
        .hasMessage("April has only 30 days.");
    assertThatThrownBy(() -> RecurrenceRule.parse("FREQ=WEEKLY;INTERVAL=60;BYDAY=MO"))
        .hasMessage("Repeat every must be between 1 and 52 weeks.");
    assertThatThrownBy(() -> RecurrenceRule.parse("FREQ=MONTHLY;BYDAY=5MO"))
        .hasMessage("Choose the 1st, 2nd, 3rd, 4th or last weekday of the month.");
  }

  // ---- legacy rules: golden comparison against the previous evaluator ----

  @ParameterizedTest
  @ValueSource(
      strings = {
        "FREQ=ONCE",
        "FREQ=DAILY",
        "FREQ=WEEKLY;BYDAY=MO",
        "FREQ=WEEKLY;BYDAY=SU",
        "FREQ=WEEKLY;BYDAY=TH,MO,SU",
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR",
        "FREQ=WEEKLY;INTERVAL=3;BYDAY=WE",
        "FREQ=WEEKLY;INTERVAL=52;BYDAY=SA"
      })
  void legacyRulesProduceExactlyTheSameDatesAsBefore(String legacyRule) {
    RecurrenceRule rule = RecurrenceRule.parse(legacyRule);
    for (LocalDate startsOn :
        List.of(
            LocalDate.of(2025, 11, 10), // Monday
            LocalDate.of(2025, 11, 12), // Wednesday
            LocalDate.of(2025, 11, 16), // Sunday
            LocalDate.of(2024, 2, 29))) { // leap day
      LocalDate from = startsOn.minusDays(10);
      LocalDate until = startsOn.plusYears(2);
      for (LocalDate date = from; date.isBefore(until); date = date.plusDays(1)) {
        assertThat(rule.occursOn(startsOn, date))
            .as("%s from %s on %s", legacyRule, startsOn, date)
            .isEqualTo(legacyOccurs(legacyRule, startsOn, date));
      }
      assertThat(rule.datesBetween(startsOn, from, until))
          .containsExactlyElementsOf(
              from.datesUntil(until)
                  .filter(date -> legacyOccurs(legacyRule, startsOn, date))
                  .toList());
    }
  }

  // ---- monthly and yearly evaluation ----

  @Test
  void monthDays29To31ClampToTheLastDayOfShorterMonths() {
    RecurrenceRule the31st = RecurrenceRule.parse("FREQ=MONTHLY;BYMONTHDAY=31");
    assertThat(
            the31st.datesBetween(
                LocalDate.of(2027, 1, 1), LocalDate.of(2027, 1, 1), LocalDate.of(2027, 5, 1)))
        .containsExactly(
            LocalDate.of(2027, 1, 31),
            LocalDate.of(2027, 2, 28),
            LocalDate.of(2027, 3, 31),
            LocalDate.of(2027, 4, 30));
    assertThat(
            the31st.datesBetween(
                LocalDate.of(2028, 2, 1), LocalDate.of(2028, 2, 1), LocalDate.of(2028, 3, 1)))
        .containsExactly(LocalDate.of(2028, 2, 29));
    assertThat(
            RecurrenceRule.parse("FREQ=MONTHLY;BYMONTHDAY=30")
                .datesBetween(
                    LocalDate.of(2027, 2, 1), LocalDate.of(2027, 2, 1), LocalDate.of(2027, 3, 1)))
        .containsExactly(LocalDate.of(2027, 2, 28));
    assertThat(
            RecurrenceRule.parse("FREQ=MONTHLY;BYMONTHDAY=-1")
                .datesBetween(
                    LocalDate.of(2028, 1, 1), LocalDate.of(2028, 1, 1), LocalDate.of(2028, 3, 1)))
        .containsExactly(LocalDate.of(2028, 1, 31), LocalDate.of(2028, 2, 29));
  }

  @Test
  void yearlyFeb29FallsOnFeb28InNonLeapYears() {
    RecurrenceRule rule = RecurrenceRule.parse("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29");
    assertThat(
            rule.datesBetween(
                LocalDate.of(2027, 1, 1), LocalDate.of(2027, 1, 1), LocalDate.of(2030, 1, 1)))
        .containsExactly(
            LocalDate.of(2027, 2, 28), LocalDate.of(2028, 2, 29), LocalDate.of(2029, 2, 28));
  }

  @Test
  void lastWeekdayOfTheMonthHandlesMonthsWithFourOrFiveOfThatWeekday() {
    RecurrenceRule lastFriday = RecurrenceRule.parse("FREQ=MONTHLY;BYDAY=-1FR");
    // January 2027 has five Fridays (the 29th is last); February 2027 has four (the 26th).
    assertThat(
            lastFriday.datesBetween(
                LocalDate.of(2027, 1, 1), LocalDate.of(2027, 1, 1), LocalDate.of(2027, 4, 1)))
        .containsExactly(
            LocalDate.of(2027, 1, 29), LocalDate.of(2027, 2, 26), LocalDate.of(2027, 3, 26));
    assertThat(
            RecurrenceRule.parse("FREQ=MONTHLY;BYDAY=2TU")
                .datesBetween(
                    LocalDate.of(2027, 1, 1), LocalDate.of(2027, 1, 1), LocalDate.of(2027, 3, 1)))
        .containsExactly(LocalDate.of(2027, 1, 12), LocalDate.of(2027, 2, 9));
  }

  @Test
  void intervalsAnchorOnTheStartDayMonthAndYear() {
    // Every 2 months from November: Nov is before the 10th-of-month date, so January is first.
    assertThat(
            RecurrenceRule.parse("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=10")
                .datesBetween(
                    LocalDate.of(2026, 11, 15),
                    LocalDate.of(2026, 11, 15),
                    LocalDate.of(2027, 6, 1)))
        .containsExactly(
            LocalDate.of(2027, 1, 10), LocalDate.of(2027, 3, 10), LocalDate.of(2027, 5, 10));
    assertThat(
            RecurrenceRule.parse("FREQ=DAILY;INTERVAL=3")
                .datesBetween(
                    LocalDate.of(2027, 1, 30), LocalDate.of(2027, 1, 30), LocalDate.of(2027, 2, 9)))
        .containsExactly(
            LocalDate.of(2027, 1, 30),
            LocalDate.of(2027, 2, 2),
            LocalDate.of(2027, 2, 5),
            LocalDate.of(2027, 2, 8));
    assertThat(
            RecurrenceRule.parse("FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYMONTHDAY=1")
                .datesBetween(
                    LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 1), LocalDate.of(2033, 1, 1)))
        .containsExactly(
            LocalDate.of(2028, 6, 1), LocalDate.of(2030, 6, 1), LocalDate.of(2032, 6, 1));
  }

  // ---- COUNT and seasonality ----

  @Test
  void countStopsAfterTheNthProducedDate() {
    RecurrenceRule rule = RecurrenceRule.parse("FREQ=WEEKLY;BYDAY=MO,TH;COUNT=3");
    LocalDate start = LocalDate.of(2027, 1, 4); // Monday
    assertThat(rule.datesBetween(start, start, start.plusYears(1)))
        .containsExactly(start, LocalDate.of(2027, 1, 7), LocalDate.of(2027, 1, 11));
    // Counting is from starts_on, so a later window sees only what is left of the count.
    assertThat(rule.datesBetween(start, LocalDate.of(2027, 1, 8), start.plusYears(1)))
        .containsExactly(LocalDate.of(2027, 1, 11));
    assertThat(rule.occursOn(start, LocalDate.of(2027, 1, 14))).isFalse();
  }

  @Test
  void countOnlyCountsDatesThatSurviveTheSeasonalityFilter() {
    RecurrenceRule rule = RecurrenceRule.parse("FREQ=DAILY;BYMONTH=12;COUNT=3");
    LocalDate start = LocalDate.of(2026, 11, 28);
    assertThat(rule.datesBetween(start, start, start.plusYears(2)))
        .containsExactly(
            LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 2), LocalDate.of(2026, 12, 3));
  }

  @Test
  void seasonalityFiltersWithoutShiftingDates() {
    RecurrenceRule rule = RecurrenceRule.parse("FREQ=WEEKLY;BYDAY=MO;BYMONTH=11,12,1,2,3");
    List<LocalDate> dates =
        rule.datesBetween(
            LocalDate.of(2027, 2, 22), LocalDate.of(2027, 2, 22), LocalDate.of(2027, 11, 9));
    assertThat(dates)
        .containsExactly(
            LocalDate.of(2027, 2, 22),
            LocalDate.of(2027, 3, 1),
            LocalDate.of(2027, 3, 8),
            LocalDate.of(2027, 3, 15),
            LocalDate.of(2027, 3, 22),
            LocalDate.of(2027, 3, 29),
            LocalDate.of(2027, 11, 1),
            LocalDate.of(2027, 11, 8));
    assertThat(dates)
        .allSatisfy(date -> assertThat(date.getDayOfWeek()).isEqualTo(DayOfWeek.MONDAY));
  }

  @Test
  void firstDateIsEmptyWhenActiveMonthsExcludeEveryMonthTheRuleCanHit() {
    assertThat(
            RecurrenceRule.parse("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=1;BYMONTH=6")
                .firstDate(LocalDate.of(2027, 1, 1)))
        .isEmpty();
    assertThat(
            RecurrenceRule.parse("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=1;BYMONTH=6")
                .firstDate(LocalDate.of(2027, 6, 1)))
        .contains(LocalDate.of(2027, 6, 1));
  }

  @Test
  void occurrenceIndexForMultiYearSchedulesIsFastAndCorrect() {
    LocalDate start = LocalDate.of(2023, 11, 1);
    LocalDate target = LocalDate.of(2026, 11, 1);
    long began = System.nanoTime();
    int daily = RecurrenceRule.parse("FREQ=DAILY").countBefore(start, target);
    int monthly = RecurrenceRule.parse("FREQ=MONTHLY;BYDAY=-1FR").countBefore(start, target);
    int yearly =
        RecurrenceRule.parse("FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1").countBefore(start, target);
    long elapsedMillis = (System.nanoTime() - began) / 1_000_000;

    assertThat(daily).isEqualTo((int) ChronoUnit.DAYS.between(start, target));
    assertThat(monthly).isEqualTo(36);
    assertThat(yearly).isEqualTo(3);
    assertThat(elapsedMillis).isLessThan(250);
  }

  /** The evaluator used before this change, kept verbatim for the golden comparison. */
  private static boolean legacyOccurs(String rule, LocalDate startsOn, LocalDate date) {
    if (date.isBefore(startsOn)) {
      return false;
    }
    if ("FREQ=ONCE".equals(rule)) {
      return date.equals(startsOn);
    }
    if ("FREQ=DAILY".equals(rule)) {
      return true;
    }
    String[] fields = rule.split(";");
    int interval = 1;
    Set<DayOfWeek> days = new HashSet<>();
    for (String field : fields) {
      if (field.startsWith("INTERVAL=")) {
        interval = Integer.parseInt(field.substring("INTERVAL=".length()));
      } else if (field.startsWith("BYDAY=")) {
        for (String value : field.substring("BYDAY=".length()).split(",")) {
          days.add(
              switch (value) {
                case "MO" -> DayOfWeek.MONDAY;
                case "TU" -> DayOfWeek.TUESDAY;
                case "WE" -> DayOfWeek.WEDNESDAY;
                case "TH" -> DayOfWeek.THURSDAY;
                case "FR" -> DayOfWeek.FRIDAY;
                case "SA" -> DayOfWeek.SATURDAY;
                case "SU" -> DayOfWeek.SUNDAY;
                default -> throw new IllegalArgumentException("Unsupported recurrence day.");
              });
        }
      }
    }
    long weeks =
        ChronoUnit.WEEKS.between(startsOn.with(DayOfWeek.MONDAY), date.with(DayOfWeek.MONDAY));
    return weeks % interval == 0 && days.contains(date.getDayOfWeek());
  }
}
