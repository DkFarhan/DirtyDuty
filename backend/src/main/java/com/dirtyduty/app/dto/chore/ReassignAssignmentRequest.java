package com.dirtyduty.app.dto.chore;

import java.util.List;
import java.util.UUID;

/** The members who should do one occurrence (1 to the chore's people needed). */
public record ReassignAssignmentRequest(List<UUID> userIds) {}
