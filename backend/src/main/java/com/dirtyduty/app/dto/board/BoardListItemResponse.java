package com.dirtyduty.app.dto.board;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One item. Names of people who have left read "Former member". {@code neededToday} is false once
 * the household's day the flag was for has ended.
 */
public record BoardListItemResponse(
    UUID id,
    UUID listId,
    String name,
    String note,
    UUID addedByUserId,
    String addedByDisplayName,
    UUID claimedByUserId,
    String claimedByDisplayName,
    boolean neededToday,
    String neededTodayByDisplayName,
    OffsetDateTime boughtAt,
    UUID boughtByUserId,
    String boughtByDisplayName,
    OffsetDateTime createdAt) {}
