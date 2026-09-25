package com.dirtyduty.app.service;

import com.dirtyduty.app.repository.UserRepository;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final UserRepository userRepository;

    public AuthService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    // TODO: implement registration and login in the next authentication step.
    // TODO: create JWT creation/validation in the next authentication step.
}
