package com.dirtyduty.app.dto.household;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record JoinHouseholdRequest(
    @NotBlank(message = "Invite code is required")
        @Size(max = 100, message = "Invite code is invalid")
        String inviteCode) {

  public JoinHouseholdRequest {
    if (inviteCode != null) {
      inviteCode = inviteCode.strip();
    }
  }
}
