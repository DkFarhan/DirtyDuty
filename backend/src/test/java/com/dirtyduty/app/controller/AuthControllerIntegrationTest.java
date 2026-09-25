package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import java.util.Locale;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@SpringBootTest
class AuthControllerIntegrationTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @BeforeEach
    void setUp() {
        userRepository.deleteAll();
    }

    @Test
    void register_shouldCreateUserWithNormalizedEmailAndHashedPassword() {
        String rawPassword = "StrongPassword123!";
        authService.register(new RegisterRequest("  Alice Smith  ", "  Alice@Example.com  ", rawPassword));

        User savedUser = userRepository.findByEmailIgnoreCase("alice@example.com").orElseThrow();
        assertThat(savedUser.getDisplayName()).isEqualTo("Alice Smith");
        assertThat(savedUser.getEmail()).isEqualTo("alice@example.com");
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
        userRepository.saveAndFlush(buildUser("existing@example.com", "Existing User", "Password123!"));

        assertThatThrownBy(() -> authService.register(
                new RegisterRequest("New User", "  EXISTING@EXAMPLE.com  ", "Password123456!")))
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
}
