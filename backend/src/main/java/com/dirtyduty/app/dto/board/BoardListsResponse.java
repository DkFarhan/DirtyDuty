package com.dirtyduty.app.dto.board;

import java.util.List;

/** The active lists, Shopping first, then oldest first; and open items across all of them. */
public record BoardListsResponse(List<BoardListResponse> lists, int toBuyCount) {}
