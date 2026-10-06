package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    @Test
    void register_translatesDatabaseUniqueConstraintRaceToDuplicateResource() {
        UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
        PasswordEncoder passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
        when(userRepository.existsByEmailIgnoreCase("race@example.com")).thenReturn(false);
        when(passwordEncoder.encode("StrongPassword123!")).thenReturn("{bcrypt}hash");
        when(userRepository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("unique email constraint"));

        org.springframework.jdbc.core.JdbcTemplate jdbcTemplate = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
        com.dirtyduty.app.repository.HouseholdMembershipRepository membershipRepository =
                org.mockito.Mockito.mock(com.dirtyduty.app.repository.HouseholdMembershipRepository.class);
        HouseholdSettingsService householdSettingsService = org.mockito.Mockito.mock(HouseholdSettingsService.class);

        AuthService authService = new AuthService(
                userRepository, passwordEncoder, jdbcTemplate, membershipRepository, householdSettingsService);

        assertThatThrownBy(() -> authService.register(
                new RegisterRequest("Race User", "race@example.com", "StrongPassword123!")))
                .isInstanceOf(DuplicateResourceException.class)
                .hasMessage("A user with this email already exists.");
    }
}
