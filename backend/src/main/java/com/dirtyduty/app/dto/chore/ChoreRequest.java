package com.dirtyduty.app.dto.chore;

import com.dirtyduty.app.entity.enums.ChorePriority;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public record ChoreRequest(
    @NotBlank @Size(max = 160) String title,
    String description,
    UUID categoryId,
    ChorePriority defaultPriority,
    @Min(1) @Max(5) Integer difficulty,
    @Min(1) @Max(1440) Integer estimatedMinutes,
    Boolean requiresVerification,
    @Valid ChoreScheduleRequest schedule,
    List<StepInput> steps,
    String reminderMode) {

  /**
   * One step of the chore's optional checklist (E12). {@code id} is an existing step's id, so a
   * renamed or moved step keeps its ticks; null for a new step. Steps are checked by the service
   * (at most 15, 1 to 80 characters each) so their messages read well.
   */
  public record StepInput(UUID id, String text) {}

  /**
   * A request without a steps list leaves the chore's steps as they are. Without a reminder level
   * (E13), a new chore takes the household default and an edit keeps the chore's level.
   */
  public ChoreRequest(
      String title,
      String description,
      UUID categoryId,
      ChorePriority defaultPriority,
      Integer difficulty,
      Integer estimatedMinutes,
      Boolean requiresVerification,
      ChoreScheduleRequest schedule) {
    this(
        title,
        description,
        categoryId,
        defaultPriority,
        difficulty,
        estimatedMinutes,
        requiresVerification,
        schedule,
        null,
        null);
  }

  public ChoreRequest(
      String title,
      String description,
      UUID categoryId,
      ChorePriority defaultPriority,
      Integer difficulty,
      Integer estimatedMinutes,
      Boolean requiresVerification,
      ChoreScheduleRequest schedule,
      List<StepInput> steps) {
    this(
        title,
        description,
        categoryId,
        defaultPriority,
        difficulty,
        estimatedMinutes,
        requiresVerification,
        schedule,
        steps,
        null);
  }
}
