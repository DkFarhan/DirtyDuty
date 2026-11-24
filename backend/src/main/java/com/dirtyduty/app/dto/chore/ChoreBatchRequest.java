package com.dirtyduty.app.dto.chore;

import jakarta.validation.Valid;
import java.util.List;

/** Several chores created together, all or none ("Start with the basics"). */
public record ChoreBatchRequest(List<@Valid ChoreRequest> chores) {}
