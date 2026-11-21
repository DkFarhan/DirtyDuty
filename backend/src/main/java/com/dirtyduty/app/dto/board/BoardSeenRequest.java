package com.dirtyduty.app.dto.board;

import java.util.List;
import java.util.UUID;

/** Posts the viewer has seen on the board, sent in one batch. */
public record BoardSeenRequest(List<UUID> postIds) {}
