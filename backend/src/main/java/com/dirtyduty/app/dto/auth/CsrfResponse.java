package com.dirtyduty.app.dto.auth;

public record CsrfResponse(
        String token,
        String headerName) {
}