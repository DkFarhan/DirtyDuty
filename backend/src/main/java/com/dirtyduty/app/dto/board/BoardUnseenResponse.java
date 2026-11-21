package com.dirtyduty.app.dto.board;

/** Active posts the viewer has not seen yet; drives the Board tab's dot. */
public record BoardUnseenResponse(int unseenCount) {}
