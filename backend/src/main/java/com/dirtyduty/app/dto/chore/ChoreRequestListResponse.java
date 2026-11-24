package com.dirtyduty.app.dto.chore;

import java.util.List;

/** Open requests the viewer can answer ({@code forMe}) and the ones they are waiting on. */
public record ChoreRequestListResponse(
    List<ChoreRequestResponse> forMe, List<ChoreRequestResponse> mine) {}
