package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OccurrenceServiceTest {
  @Test
  void supportedRecurrenceRulesHonorStartsWeekdaysAndIntervals() {
    LocalDate monday = LocalDate.of(2026, 1, 5);
    assertThat(OccurrenceService.occurs("FREQ=ONCE", monday, monday)).isTrue();
    assertThat(OccurrenceService.occurs("FREQ=ONCE", monday, monday.plusDays(1))).isFalse();
    assertThat(OccurrenceService.occurs("FREQ=DAILY", monday, monday.plusDays(20))).isTrue();
    assertThat(OccurrenceService.occurs("FREQ=WEEKLY;BYDAY=MO,WE", monday, monday)).isTrue();
    assertThat(OccurrenceService.occurs("FREQ=WEEKLY;BYDAY=MO,WE", monday, monday.plusDays(2)))
        .isTrue();
    assertThat(OccurrenceService.occurs("FREQ=WEEKLY;BYDAY=MO,WE", monday, monday.plusDays(1)))
        .isFalse();
    assertThat(
            OccurrenceService.occurs("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", monday, monday.plusDays(7)))
        .isFalse();
    assertThat(
            OccurrenceService.occurs(
                "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", monday, monday.plusDays(14)))
        .isTrue();
  }

  @Test
  void dueDatesResolveDaylightSavingGapsAndOverlapsWithHouseholdZoneRules() {
    ZoneId zone = ZoneId.of("America/New_York");
    OffsetDateTime springGap =
        OccurrenceService.dueAt(LocalDate.of(2026, 3, 8), LocalTime.of(2, 30), zone);
    assertThat(springGap.toLocalTime()).isEqualTo(LocalTime.of(3, 30));
    assertThat(springGap.getOffset().getTotalSeconds()).isEqualTo(-4 * 60 * 60);

    OffsetDateTime autumnOverlap =
        OccurrenceService.dueAt(LocalDate.of(2026, 11, 1), LocalTime.of(1, 30), zone);
    assertThat(autumnOverlap.getOffset().getTotalSeconds()).isEqualTo(-4 * 60 * 60);
  }

  @Test
  void roundRobinIsBalancedAcrossEveryPrefixAndNeverDuplicatesWithinAnOccurrence() {
    for (int poolSize = 2; poolSize <= 8; poolSize++) {
      List<UUID> pool = new ArrayList<>();
      for (int i = 0; i < poolSize; i++) {
        pool.add(UUID.randomUUID());
      }
      for (int peopleNeeded = 1; peopleNeeded <= poolSize; peopleNeeded++) {
        Map<UUID, Integer> counts = new HashMap<>();
        pool.forEach(userId -> counts.put(userId, 0));
        Map<String, Integer> pairCounts = new HashMap<>();
        int cycleLength = poolSize;
        for (int occurrence = 0; occurrence < cycleLength * 2; occurrence++) {
          List<Integer> priorCounts = pool.stream().map(counts::get).toList();
          List<UUID> selected =
              OccurrenceService.rotate(pool, peopleNeeded, occurrence, priorCounts, pairCounts);
          assertThat(selected).hasSize(peopleNeeded).doesNotHaveDuplicates();
          selected.forEach(userId -> counts.compute(userId, (key, count) -> count + 1));
          for (int i = 0; i < selected.size(); i++) {
            for (int j = i + 1; j < selected.size(); j++) {
              pairCounts.merge(
                  OccurrenceService.pairKey(selected.get(i), selected.get(j)), 1, Integer::sum);
            }
          }
          int minimum = counts.values().stream().mapToInt(Integer::intValue).min().orElseThrow();
          int maximum = counts.values().stream().mapToInt(Integer::intValue).max().orElseThrow();
          assertThat(maximum - minimum).isLessThanOrEqualTo(1);
        }
        int expectedAssignments = peopleNeeded * 2;
        assertThat(counts.values()).allMatch(count -> count == expectedAssignments);
      }
    }
  }

  @Test
  void rotationMovesPartnerPairsInsteadOfRepeatingOneStaticPairing() {
    List<UUID> pool =
        List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
    Map<UUID, Integer> counts = new HashMap<>();
    pool.forEach(userId -> counts.put(userId, 0));
    Map<String, Integer> pairCounts = new HashMap<>();
    Set<String> pairs = new HashSet<>();
    for (int occurrence = 0; occurrence < 6; occurrence++) {
      List<UUID> selected =
          OccurrenceService.rotate(
              pool, 2, occurrence, pool.stream().map(counts::get).toList(), pairCounts);
      String pair = OccurrenceService.pairKey(selected.getFirst(), selected.getLast());
      assertThat(pairs).doesNotContain(pair);
      pairs.add(pair);
      selected.forEach(userId -> counts.compute(userId, (key, count) -> count + 1));
      pairCounts.merge(pair, 1, Integer::sum);
    }
    assertThat(pairs).hasSize(6);
    assertThat(counts.values()).containsOnly(3);
  }
}
