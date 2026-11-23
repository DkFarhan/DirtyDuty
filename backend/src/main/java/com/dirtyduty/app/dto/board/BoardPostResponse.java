package com.dirtyduty.app.dto.board;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * A board post as one viewer sees it. {@code authorDisplayName} is "Former member" once the author
 * has left or deleted their account. Seen counts leave the author out: {@code audienceCount} is the
 * active members other than the author.
 */
public record BoardPostResponse(
    UUID id,
    String type,
    String title,
    String details,
    LocalDate eventDate,
    LocalTime startTime,
    LocalTime endTime,
    boolean pinned,
    /* Notified everyone even during quiet hours. */
    boolean urgent,
    String notifyMode,
    List<UUID> recipientUserIds,
    UUID authorUserId,
    String authorDisplayName,
    UUID handlerUserId,
    String handlerDisplayName,
    OffsetDateTime fixedAt,
    String fixedByDisplayName,
    OffsetDateTime pastAt,
    OffsetDateTime editedAt,
    OffsetDateTime createdAt,
    int seenCount,
    int gotItCount,
    int audienceCount,
    List<BoardReaderResponse> readers,
    Viewer viewer) {

  /**
   * What the viewer has done and may do. {@code remindAgainAt} is set while Remind is cooling down.
   */
  public record Viewer(
      boolean author,
      boolean seen,
      boolean gotIt,
      boolean forYou,
      boolean canEdit,
      boolean canDelete,
      boolean canRemind,
      OffsetDateTime remindedAt,
      OffsetDateTime remindAgainAt) {}
}
