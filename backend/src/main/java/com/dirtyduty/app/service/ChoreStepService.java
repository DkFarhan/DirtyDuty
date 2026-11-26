package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreResponse;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Checklists (E12): a chore's optional steps and their ticks on each occurrence.
 *
 * <p>Steps are a guide, never required: they don't change who does a chore, its effort points,
 * stats, requests or away mode. Ticks belong to one occurrence, so the next one starts with none.
 * When a chore's steps are edited, a step sent back with its id keeps its ticks (renamed or moved);
 * a step left out is removed with its ticks; a step without an id starts unticked. A completed
 * occurrence keeps a snapshot of its counts ("4 of 5 steps").
 */
@Service
public class ChoreStepService {
  public static final int MAX_STEPS = 15;
  public static final int MAX_STEP_LENGTH = 80;
  static final String TOO_MANY = "A chore can have at most 15 steps.";
  static final String EMPTY_STEP = "Enter a step, or remove it.";
  static final String LONG_STEP = "Keep each step to 80 characters.";
  static final String FORMER_MEMBER = "Former member";

  private final JdbcTemplate jdbc;

  public ChoreStepService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /** Checks a request's steps before anything is written; null means "leave them as they are". */
  public void validate(List<ChoreRequest.StepInput> steps) {
    if (steps == null) {
      return;
    }
    if (steps.size() > MAX_STEPS) {
      throw new InvalidHouseholdException(TOO_MANY);
    }
    for (ChoreRequest.StepInput step : steps) {
      String text = step == null || step.text() == null ? "" : step.text().strip();
      if (text.isEmpty()) {
        throw new InvalidHouseholdException(EMPTY_STEP);
      }
      if (text.length() > MAX_STEP_LENGTH) {
        throw new InvalidHouseholdException(LONG_STEP);
      }
    }
  }

  /**
   * Replaces the chore's steps with these, in order. The caller holds the household lock. Ids that
   * aren't this chore's steps are treated as new steps.
   */
  public void replace(UUID choreId, List<ChoreRequest.StepInput> steps) {
    if (steps == null) {
      return;
    }
    validate(steps);
    Set<UUID> existing =
        new HashSet<>(
            jdbc.queryForList("SELECT id FROM chore_steps WHERE chore_id=?", UUID.class, choreId));
    Set<UUID> kept = new HashSet<>();
    for (ChoreRequest.StepInput step : steps) {
      if (step.id() != null && existing.contains(step.id())) {
        kept.add(step.id());
      }
    }
    // Removed steps go first (their ticks with them), so positions are free for the rest.
    for (UUID id : existing) {
      if (!kept.contains(id)) {
        jdbc.update("DELETE FROM chore_steps WHERE id=?", id);
      }
    }
    Set<UUID> placed = new HashSet<>();
    for (int position = 0; position < steps.size(); position++) {
      ChoreRequest.StepInput step = steps.get(position);
      String text = step.text().strip();
      if (step.id() != null && kept.contains(step.id()) && placed.add(step.id())) {
        jdbc.update(
            """
                UPDATE chore_steps SET position=?, text=?,
                    updated_at=CASE WHEN text<>? OR position<>? THEN NOW() ELSE updated_at END
                WHERE id=?
                """,
            position,
            text,
            text,
            position,
            step.id());
      } else {
        jdbc.update(
            "INSERT INTO chore_steps (chore_id, position, text) VALUES (?, ?, ?)",
            choreId,
            position,
            text);
      }
    }
  }

  /** The chore's steps in order. */
  public List<ChoreResponse.Step> stepsOf(UUID choreId) {
    return jdbc.query(
        "SELECT id, text FROM chore_steps WHERE chore_id=? ORDER BY position",
        (rs, row) -> new ChoreResponse.Step(rs.getObject("id", UUID.class), rs.getString("text")),
        choreId);
  }

  /**
   * The checklist on one occurrence as the viewer sees it, or null when there is none. A pending
   * occurrence lists the chore's steps with their ticks; any other keeps its snapshot counts.
   */
  public AssignmentResponse.Steps stateFor(
      UUID occurrenceId,
      UUID choreId,
      UUID householdId,
      boolean pending,
      boolean canTick,
      Integer snapshotTotal,
      Integer snapshotTicked) {
    if (!pending) {
      return snapshotTotal == null || snapshotTotal == 0
          ? null
          : new AssignmentResponse.Steps(
              snapshotTotal, snapshotTicked == null ? 0 : snapshotTicked, false, null);
    }
    List<AssignmentResponse.StepItem> items =
        jdbc.query(
            """
                SELECT s.id, s.text, t.ticked_at, t.ticked_by_user_id, u.display_name,
                       m.user_id IS NOT NULL AS still_member
                FROM chore_steps s
                LEFT JOIN chore_step_ticks t ON t.step_id=s.id AND t.occurrence_id=?
                LEFT JOIN users u ON u.id=t.ticked_by_user_id
                LEFT JOIN household_memberships m
                  ON m.user_id=t.ticked_by_user_id AND m.household_id=? AND m.status='ACTIVE'
                WHERE s.chore_id=?
                ORDER BY s.position
                """,
            (rs, row) -> {
              OffsetDateTime tickedAt = rs.getObject("ticked_at", OffsetDateTime.class);
              AssignmentResponse.Person by = null;
              if (tickedAt != null) {
                UUID userId = rs.getObject("ticked_by_user_id", UUID.class);
                by =
                    new AssignmentResponse.Person(
                        rs.getBoolean("still_member") ? userId : null,
                        rs.getBoolean("still_member")
                            ? rs.getString("display_name")
                            : FORMER_MEMBER);
              }
              return new AssignmentResponse.StepItem(
                  rs.getObject("id", UUID.class),
                  rs.getString("text"),
                  tickedAt != null,
                  by,
                  tickedAt);
            },
            occurrenceId,
            householdId,
            choreId);
    if (items.isEmpty()) {
      return null;
    }
    int ticked = (int) items.stream().filter(AssignmentResponse.StepItem::ticked).count();
    return new AssignmentResponse.Steps(items.size(), ticked, canTick, List.copyOf(items));
  }

  /** Whether this step belongs to the occurrence's chore. */
  public boolean belongsTo(UUID stepId, UUID occurrenceId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
                SELECT EXISTS(
                    SELECT 1 FROM chore_steps s
                    JOIN chore_assignments a ON a.chore_id=s.chore_id
                    WHERE s.id=? AND a.id=?)
                """,
            Boolean.class,
            stepId,
            occurrenceId));
  }

  /** Ticks or unticks one step. Ticking an already ticked step keeps who ticked it first. */
  public void setTick(
      UUID occurrenceId, UUID stepId, UUID userId, boolean ticked, OffsetDateTime now) {
    if (ticked) {
      jdbc.update(
          """
              INSERT INTO chore_step_ticks (occurrence_id, step_id, ticked_by_user_id, ticked_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (occurrence_id, step_id) DO NOTHING
              """,
          occurrenceId,
          stepId,
          userId,
          now);
    } else {
      jdbc.update(
          "DELETE FROM chore_step_ticks WHERE occurrence_id=? AND step_id=?", occurrenceId, stepId);
    }
  }

  /** At completion: keep how many of the chore's steps were ticked ("4 of 5 steps"). */
  public void snapshot(UUID occurrenceId) {
    jdbc.update(
        """
            UPDATE chore_assignments a SET
                steps_total=counts.total, steps_ticked=counts.ticked
            FROM (
                SELECT COUNT(*) AS total,
                       COUNT(t.step_id) AS ticked
                FROM chore_assignments o
                JOIN chore_steps s ON s.chore_id=o.chore_id
                LEFT JOIN chore_step_ticks t ON t.step_id=s.id AND t.occurrence_id=o.id
                WHERE o.id=?
            ) counts
            WHERE a.id=? AND counts.total > 0
            """,
        occurrenceId,
        occurrenceId);
  }
}
