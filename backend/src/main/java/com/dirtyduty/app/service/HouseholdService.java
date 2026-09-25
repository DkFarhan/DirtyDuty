package com.dirtyduty.app.service;

import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.HouseholdRepository;
import com.dirtyduty.app.repository.UserRepository;
import org.springframework.stereotype.Service;

@Service
public class HouseholdService {

    private final HouseholdRepository householdRepository;
    private final HouseholdMembershipRepository householdMembershipRepository;
    private final UserRepository userRepository;

    public HouseholdService(
        HouseholdRepository householdRepository,
        HouseholdMembershipRepository householdMembershipRepository,
        UserRepository userRepository
    ) {
        this.householdRepository = householdRepository;
        this.householdMembershipRepository = householdMembershipRepository;
        this.userRepository = userRepository;
    }

    // TODO: implement household creation, membership logic, and authorization checks.
}
