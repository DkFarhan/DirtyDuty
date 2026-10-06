package com.dirtyduty.app.exception;

import com.dirtyduty.app.dto.auth.OwnedHouseholdResponse;
import java.util.List;

public class AccountDeletionConflictException extends RuntimeException {
    private final List<OwnedHouseholdResponse> ownedHouseholds;

    public AccountDeletionConflictException(List<OwnedHouseholdResponse> ownedHouseholds) {
        super("You still own households.");
        this.ownedHouseholds = List.copyOf(ownedHouseholds);
    }

    public List<OwnedHouseholdResponse> getOwnedHouseholds() {
        return ownedHouseholds;
    }
}
