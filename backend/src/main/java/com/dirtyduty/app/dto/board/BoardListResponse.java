package com.dirtyduty.app.dto.board;

import java.time.OffsetDateTime;
import java.util.UUID;

/** A list on the switcher: its open items and how many of them are needed today. */
public record BoardListResponse(
    UUID id,
    String name,
    boolean defaultList,
    int openCount,
    int todayCount,
    OffsetDateTime createdAt) {}
