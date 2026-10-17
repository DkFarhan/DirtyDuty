package com.dirtyduty.app.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GoogleLinkRequest(@NotBlank @Size(max = 128) String password) {}
