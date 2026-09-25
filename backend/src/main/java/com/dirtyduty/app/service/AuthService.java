package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.repository.UserRepository;
import jakarta.transaction.Transactional;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public RegisterResponse register(RegisterRequest request) {
        String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
        String normalizedDisplayName = request.displayName().trim();

        if (userRepository.existsByEmailIgnoreCase(normalizedEmail)) {
            throw new DuplicateResourceException("A user with this email already exists.");
        }

        User user = new User();
        user.setDisplayName(normalizedDisplayName);
        user.setEmail(normalizedEmail);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setTimezone("UTC");
        user.setAccountStatus(AccountStatus.ACTIVE);
        user.setEmailVerifiedAt(null);

        try {
            User savedUser = userRepository.saveAndFlush(user);
            return new RegisterResponse(savedUser.getId(), savedUser.getDisplayName(), savedUser.getEmail());
        } catch (DataIntegrityViolationException ex) {
            throw new DuplicateResourceException("A user with this email already exists.");
        }
    }
}
