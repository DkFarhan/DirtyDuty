package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@SpringBootTest
class AuthControllerIntegrationTest {

    private final List<String> testEmails = new ArrayList<>();

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @AfterEach
    void cleanUpTestUsers() {
        for (String email : testEmails) {
            userRepository.findByEmailIgnoreCase(email).ifPresent(userRepository::delete);
        }
        testEmails.clear();
    }

    @Test
    void register_shouldCreateUserWithNormalizedEmailAndHashedPassword() {
        String rawPassword = "StrongPassword123!";
        String email = uniqueEmail("alice").toUpperCase(Locale.ROOT);
        authService.register(new RegisterRequest("  Alice Smith  ", email, rawPassword));

        User savedUser = userRepository.findByEmailIgnoreCase(email).orElseThrow();
        assertThat(savedUser.getDisplayName()).isEqualTo("Alice Smith");
        assertThat(savedUser.getEmail()).isEqualTo(email.toLowerCase(Locale.ROOT));
        assertThat(savedUser.getAccountStatus()).isEqualTo(AccountStatus.ACTIVE);
        assertThat(savedUser.getEmailVerifiedAt()).isNull();
        assertThat(savedUser.getPasswordHash()).doesNotContain(rawPassword);
        assertThat(savedUser.getPasswordHash()).startsWith("{argon2}");
        assertThat(passwordEncoder.matches(rawPassword, savedUser.getPasswordHash())).isTrue();
    }

    @Test
    void passwordEncoder_matchesExistingBcryptHash() {
        String rawPassword = "ExistingPassword123!";
        String existingBcryptHash = new BCryptPasswordEncoder(12).encode(rawPassword);

        assertThat(passwordEncoder.matches(rawPassword, "{bcrypt}" + existingBcryptHash)).isTrue();
    }

    @Test
    void register_shouldRejectDuplicateEmailIgnoringCase() {
        String email = uniqueEmail("existing");
        userRepository.saveAndFlush(buildUser(email, "Existing User", "Password123!"));

        assertThatThrownBy(() -> authService.register(
                new RegisterRequest("New User", "  " + email.toUpperCase(Locale.ROOT) + "  ", "Password123456!")))
                .isInstanceOf(DuplicateResourceException.class);
    }

    private User buildUser(String email, String displayName, String rawPassword) {
        User user = new User();
        user.setEmail(email.toLowerCase(Locale.ROOT));
        user.setDisplayName(displayName);
        user.setPasswordHash(passwordEncoder.encode(rawPassword));
        user.setTimezone("UTC");
        user.setAccountStatus(AccountStatus.ACTIVE);
        return user;
    }

    private String uniqueEmail(String prefix) {
        String email = prefix + "-" + java.util.UUID.randomUUID() + "@example.com";
        testEmails.add(email);
        return email;
    }
}
