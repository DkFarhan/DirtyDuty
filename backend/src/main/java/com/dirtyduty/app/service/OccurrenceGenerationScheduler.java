package com.dirtyduty.app.service;

import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps every household's rolling occurrence horizon filled even when nobody opens Home or My
 * Chores, so reminders are planned for those dates. On-read generation remains as a safety net.
 *
 * <p>Runs on Spring's single scheduler thread, shared with {@code NotificationScheduler}, so a
 * generation pass and a notification pass never overlap. Each household is generated in its own
 * short transaction through the {@link OccurrenceService} proxy.
 */
@Component
public class OccurrenceGenerationScheduler {
  private static final Logger log = LoggerFactory.getLogger(OccurrenceGenerationScheduler.class);

  private final JdbcTemplate jdbc;
  private final OccurrenceService occurrenceService;
  private final TaskScheduler taskScheduler;
  private final boolean enabled;
  private final Duration startupDelay;

  public OccurrenceGenerationScheduler(
      JdbcTemplate jdbc,
      OccurrenceService occurrenceService,
      TaskScheduler taskScheduler,
      @Value("${app.chores.generation.enabled:true}") boolean enabled,
      @Value("${app.chores.generation.startup-delay:60000}") long startupDelayMillis) {
    this.jdbc = jdbc;
    this.occurrenceService = occurrenceService;
    this.taskScheduler = taskScheduler;
    this.enabled = enabled;
    this.startupDelay = Duration.ofMillis(Math.max(0, startupDelayMillis));
  }

  /** One pass shortly after startup, on the same scheduler thread as the hourly runs. */
  @EventListener(ApplicationReadyEvent.class)
  public void scheduleStartupRun() {
    if (enabled) {
      taskScheduler.schedule(this::runSafely, Instant.now().plus(startupDelay));
    }
  }

  @Scheduled(cron = "${app.chores.generation.cron:0 7 * * * *}")
  public void scheduledRun() {
    if (enabled) {
      runSafely();
    }
  }

  /** Generates every eligible household once. Called directly by tests. */
  public Result run() {
    List<UUID> householdIds =
        jdbc.queryForList(
            """
                SELECT DISTINCT s.household_id
                FROM chore_schedules s
                JOIN chores c ON c.id=s.chore_id AND c.household_id=s.household_id
                JOIN households h ON h.id=s.household_id
                WHERE s.is_active=TRUE AND c.is_active=TRUE AND c.archived_at IS NULL
                ORDER BY s.household_id
                """,
            UUID.class);
    int generated = 0;
    int skipped = 0;
    int failed = 0;
    for (UUID householdId : householdIds) {
      try {
        occurrenceService.generateHousehold(householdId);
        generated++;
      } catch (HouseholdAccessDeniedException exception) {
        // generateHousehold locks the household row and reports a missing row this way. A
        // household deleted after it was listed is expected; anything else is a real failure.
        if (householdExists(householdId)) {
          failed++;
          logFailure(householdId, exception);
        } else {
          skipped++;
        }
      } catch (RuntimeException exception) {
        failed++;
        logFailure(householdId, exception);
      }
    }
    Result result = new Result(householdIds.size(), generated, skipped, failed);
    if (failed > 0) {
      log.warn(
          "Background occurrence generation finished with failures: households={} generated={} skipped={} failed={}",
          result.households(),
          generated,
          skipped,
          failed);
    } else {
      log.debug(
          "Background occurrence generation finished: households={} generated={} skipped={}",
          result.households(),
          generated,
          skipped);
    }
    return result;
  }

  private void runSafely() {
    try {
      run();
    } catch (RuntimeException exception) {
      log.warn(
          "Background occurrence generation could not list households: {}",
          exception.getClass().getSimpleName());
      log.debug("Background occurrence generation listing failure", exception);
    }
  }

  private boolean householdExists(UUID householdId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM households WHERE id=?)", Boolean.class, householdId));
  }

  private void logFailure(UUID householdId, RuntimeException exception) {
    // Only the household id and exception type at WARN: messages from lower layers can carry
    // chore titles or other user content. The full exception is available at DEBUG.
    log.warn(
        "Background occurrence generation failed for household {}: {}",
        householdId,
        exception.getClass().getSimpleName());
    log.debug("Background occurrence generation failure for household {}", householdId, exception);
  }

  public record Result(int households, int generated, int skipped, int failed) {}
}
