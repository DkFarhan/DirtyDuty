package com.dirtyduty.app.dto.board;

import java.util.List;

/**
 * The active board: pinned and active posts (newest first), how many posts are in Past, how many
 * active posts the viewer has not seen yet, and the members (for names and the Notify sheet).
 */
public record BoardResponse(
    List<BoardPostResponse> posts,
    int pastCount,
    int unseenCount,
    boolean viewerIsAdmin,
    List<BoardMemberResponse> members) {}
