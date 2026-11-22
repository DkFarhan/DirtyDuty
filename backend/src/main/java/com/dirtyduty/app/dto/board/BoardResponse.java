package com.dirtyduty.app.dto.board;

import java.util.List;

/**
 * The active board: pinned and active posts (newest first), how many posts are in Past, how many
 * active posts the viewer has not seen yet, and the members (for names and the Notify sheet). For
 * Lists: open items across the active lists ("To buy") and the Shopping list's summary (Home).
 */
public record BoardResponse(
    List<BoardPostResponse> posts,
    int pastCount,
    int unseenCount,
    boolean viewerIsAdmin,
    List<BoardMemberResponse> members,
    int toBuyCount,
    BoardShoppingSummary shopping) {}
