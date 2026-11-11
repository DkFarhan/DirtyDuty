package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.TaskScheduler;

class OccurrenceGenerationSchedulerTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final OccurrenceService occurrenceService = mock(OccurrenceService.class);
  private final TaskScheduler taskScheduler = mock(TaskScheduler.class);

  private final UUID failing = UUID.randomUUID();
  private final UUID healthy = UUID.randomUUID();
  private final UUID deleted = UUID.randomUUID();
  private final UUID deniedButPresent = UUID.randomUUID();

  @Test
  void oneHouseholdFailingDoesNotStopTheOthersAndMissingHouseholdsAreSkipped() {
    when(jdbc.queryForList(anyString(), eq(UUID.class)))
        .thenReturn(List.of(failing, healthy, deleted, deniedButPresent));
    doThrow(new IllegalStateException("boom")).when(occurrenceService).generateHousehold(failing);
    doThrow(new HouseholdAccessDeniedException("You are not an ACTIVE household member."))
        .when(occurrenceService)
        .generateHousehold(deleted);
    doThrow(new HouseholdAccessDeniedException("You are not an ACTIVE household member."))
        .when(occurrenceService)
        .generateHousehold(deniedButPresent);
    when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq(deleted))).thenReturn(false);
    when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq(deniedButPresent)))
        .thenReturn(true);

    OccurrenceGenerationScheduler.Result result = scheduler(true).run();

    verify(occurrenceService).generateHousehold(failing);
    verify(occurrenceService).generateHousehold(healthy);
    verify(occurrenceService).generateHousehold(deleted);
    verify(occurrenceService).generateHousehold(deniedButPresent);
    assertThat(result).isEqualTo(new OccurrenceGenerationScheduler.Result(4, 1, 1, 2));
  }

  @Test
  void disabledSchedulerNeitherRunsOnTheCronNorSchedulesTheStartupPass() {
    OccurrenceGenerationScheduler scheduler = scheduler(false);

    scheduler.scheduledRun();
    scheduler.scheduleStartupRun();

    verify(jdbc, never()).queryForList(anyString(), eq(UUID.class));
    verify(taskScheduler, never()).schedule(any(Runnable.class), any(Instant.class));
  }

  @Test
  void enabledSchedulerQueuesOneStartupPassOnTheSchedulerThread() {
    scheduler(true).scheduleStartupRun();

    verify(taskScheduler).schedule(any(Runnable.class), any(Instant.class));
    verify(occurrenceService, never()).generateHousehold(any());
  }

  private OccurrenceGenerationScheduler scheduler(boolean enabled) {
    return new OccurrenceGenerationScheduler(jdbc, occurrenceService, taskScheduler, enabled, 0);
  }
}
