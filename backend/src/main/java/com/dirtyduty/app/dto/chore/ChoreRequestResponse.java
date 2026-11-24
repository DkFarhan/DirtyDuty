package com.dirtyduty.app.dto.chore;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One hand-off or swap request (E11). {@code target} is null when anyone may take it. {@code
 * occurrence} is the requester's chore; {@code swapOccurrence} the target's chore offered in a
 * swap. {@code resolvedBy} is who accepted or declined it, once it is closed.
 */
public record ChoreRequestResponse(
    UUID id,
    String type,
    String status,
    AssignmentResponse.Person requester,
    AssignmentResponse.Person target,
    Occurrence occurrence,
    Occurrence swapOccurrence,
    OffsetDateTime expiresAt,
    OffsetDateTime createdAt,
    OffsetDateTime resolvedAt,
    AssignmentResponse.Person resolvedBy) {

  public record Occurrence(
      UUID id,
      UUID choreId,
      String title,
      String categoryIcon,
      String kind,
      LocalDate scheduledFor,
      OffsetDateTime dueAt) {}
}
