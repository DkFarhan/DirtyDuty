package com.dirtyduty.app.dto.board;

import java.time.OffsetDateTime;
import java.util.UUID;

/** One active member and how far they got with a post; the author is listed as "Posted". */
public record BoardReaderResponse(
    UUID userId,
    String displayName,
    boolean author,
    OffsetDateTime seenAt,
    OffsetDateTime gotItAt) {}
