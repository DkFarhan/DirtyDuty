package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class ReminderSchedulePlannerTest {
  private static final List<ReminderSchedulePlanner.ReminderRule> RULES =
      List.of(
          new ReminderSchedulePlanner.ReminderRule("CHORE_DUE_SOON", 1440),
          new ReminderSchedulePlanner.ReminderRule("CHORE_DUE_SOON", 360),
          new ReminderSchedulePlanner.ReminderRule("CHORE_DUE_SOON", 60),
          new ReminderSchedulePlanner.ReminderRule("CHORE_DUE_NOW", 0),
          new ReminderSchedulePlanner.ReminderRule("CHORE_OVERDUE", -60),
          new ReminderSchedulePlanner.ReminderRule("CHORE_OVERDUE", -180));

  @Test
  void plansEveryConfiguredWindowAtItsExpectedInstant() {
    OffsetDateTime dueAt = OffsetDateTime.parse("2026-10-01T18:00:00Z");
    List<ReminderSchedulePlanner.PlannedReminder> planned =
        ReminderSchedulePlanner.plan(dueAt, RULES, dueAt.minusDays(2));

    assertThat(planned)
        .extracting(ReminderSchedulePlanner.PlannedReminder::scheduledAt)
        .containsExactly(
            dueAt.minusHours(24),
            dueAt.minusHours(6),
            dueAt.minusHours(1),
            dueAt,
            dueAt.plusHours(1),
            dueAt.plusHours(3));
    assertThat(planned)
        .extracting(item -> item.rule().eventType())
        .containsExactly(
            "CHORE_DUE_SOON",
            "CHORE_DUE_SOON",
            "CHORE_DUE_SOON",
            "CHORE_DUE_NOW",
            "CHORE_OVERDUE",
            "CHORE_OVERDUE");
  }

  @Test
  void doesNotBackfillWindowsMissedThirtyMinutesBeforeDue() {
    OffsetDateTime dueAt = OffsetDateTime.parse("2026-10-01T18:00:00Z");
    List<ReminderSchedulePlanner.PlannedReminder> planned =
        ReminderSchedulePlanner.plan(dueAt, RULES, dueAt.minusMinutes(30));

    assertThat(planned)
        .extracting(ReminderSchedulePlanner.PlannedReminder::scheduledAt)
        .containsExactly(dueAt, dueAt.plusHours(1), dueAt.plusHours(3));
  }

  @Test
  void firstSeenTwoHoursAfterDueSchedulesOnlyTheFutureThreeHourReminder() {
    OffsetDateTime dueAt = OffsetDateTime.parse("2026-10-01T18:00:00Z");
    List<ReminderSchedulePlanner.PlannedReminder> planned =
        ReminderSchedulePlanner.plan(dueAt, RULES, dueAt.plusHours(2));

    assertThat(planned)
        .extracting(ReminderSchedulePlanner.PlannedReminder::scheduledAt)
        .containsExactly(dueAt.plusHours(3));
  }

  @Test
  void firstSeenAfterAllWindowsDoesNotCreateStaleReminders() {
    OffsetDateTime dueAt = OffsetDateTime.parse("2026-10-01T18:00:00Z");

    assertThat(ReminderSchedulePlanner.plan(dueAt, RULES, dueAt.plusHours(4))).isEmpty();
  }

  @Test
  void expiresEachReminderWhenTheNextStageSupersedesIt() {
    OffsetDateTime dueAt = OffsetDateTime.parse("2026-10-01T18:00:00Z");
    List<ReminderSchedulePlanner.PlannedReminder> planned =
        ReminderSchedulePlanner.plan(dueAt, RULES, dueAt.minusDays(2));

    assertThat(planned)
        .extracting(ReminderSchedulePlanner.PlannedReminder::expiresAt)
        .containsExactly(
            dueAt.minusHours(6),
            dueAt.minusHours(1),
            dueAt,
            dueAt.plusHours(1),
            dueAt.plusHours(3),
            dueAt.plusHours(27));
  }

  @Test
  void dueSoonAndDueNowHaveSafeExpiryLimitsEvenWithoutLaterRules() {
    OffsetDateTime dueAt = OffsetDateTime.parse("2026-10-01T18:00:00Z");
    List<ReminderSchedulePlanner.PlannedReminder> dueSoon =
        ReminderSchedulePlanner.plan(
            dueAt,
            List.of(new ReminderSchedulePlanner.ReminderRule("CHORE_DUE_SOON", 1440)),
            dueAt.minusDays(2));
    List<ReminderSchedulePlanner.PlannedReminder> dueNow =
        ReminderSchedulePlanner.plan(
            dueAt,
            List.of(new ReminderSchedulePlanner.ReminderRule("CHORE_DUE_NOW", 0)),
            dueAt.minusDays(2));

    assertThat(dueSoon.getFirst().expiresAt()).isEqualTo(dueAt);
    assertThat(dueNow.getFirst().expiresAt()).isEqualTo(dueAt.plusHours(1));
  }

  @Test
  void dueTimeFromHouseholdZoneKeepsReminderInstantsOnTheSameTimeline() {
    ZoneId householdZone = ZoneId.of("America/New_York");
    OffsetDateTime dueAt =
        java.time.LocalDate.of(2026, 11, 1).atTime(9, 0).atZone(householdZone).toOffsetDateTime();
    List<ReminderSchedulePlanner.PlannedReminder> planned =
        ReminderSchedulePlanner.plan(dueAt, RULES, dueAt.minusDays(2));

    assertThat(dueAt.getOffset()).isEqualTo(ZoneOffset.ofHours(-5));
    assertThat(planned.getFirst().scheduledAt().toInstant())
        .isEqualTo(dueAt.toInstant().minusSeconds(24 * 60 * 60));
    assertThat(planned.getFirst().scheduledAt().toInstant())
        .isEqualTo(java.time.Instant.parse("2026-10-31T14:00:00Z"));
  }
}
