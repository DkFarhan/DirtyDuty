package com.dirtyduty.app.dto.board;

import java.util.List;

/**
 * A list's open items (needed today first, then oldest first) and what was bought on it today (most
 * recent first).
 */
public record BoardListItemsResponse(
    BoardListResponse list,
    List<BoardListItemResponse> items,
    List<BoardListItemResponse> boughtToday) {}
