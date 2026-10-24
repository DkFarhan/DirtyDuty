package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.EmailVerificationRateLimitException;
import com.dirtyduty.app.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {
  @Test
  void registrationDoesNotMarkEmailVerifiedWhenDeliveryFeatureIsDisabled() {
    UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    PasswordEncoder passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    EmailVerificationService emailVerificationService =
        org.mockito.Mockito.mock(EmailVerificationService.class);
    PersistentAuthRateLimiter rateLimiter =
        org.mockito.Mockito.mock(PersistentAuthRateLimiter.class);
    when(rateLimiter.allow(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyInt(),
            org.mockito.ArgumentMatchers.any()))
        .thenReturn(true);
    when(userRepository.existsByEmailIgnoreCase("new@example.com")).thenReturn(false);
    when(passwordEncoder.encode("StrongPassword123!")).thenReturn("{argon2}encoded");
    when(userRepository.saveAndFlush(any()))
        .thenAnswer(
            invocation -> {
              User user = invocation.getArgument(0);
              user.setId(java.util.UUID.randomUUID());
              return user;
            });
    when(emailVerificationService.isEnabled()).thenReturn(false);

    AuthService authService =
        new AuthService(
            userRepository,
            passwordEncoder,
            org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class),
            org.mockito.Mockito.mock(
                com.dirtyduty.app.repository.HouseholdMembershipRepository.class),
            org.mockito.Mockito.mock(HouseholdSettingsService.class),
            new LegalAcceptanceService(userRepository),
            org.mockito.Mockito.mock(PasswordLoginProtectionService.class),
            emailVerificationService,
            rateLimiter);

    var response =
        authService.register(
            new RegisterRequest("New User", "New@Example.com", "StrongPassword123!"),
            "198.51.100.22");
    org.mockito.ArgumentCaptor<User> capturedUser = org.mockito.ArgumentCaptor.forClass(User.class);
    org.mockito.Mockito.verify(userRepository).saveAndFlush(capturedUser.capture());

    assertThat(response.emailVerified()).isFalse();
    assertThat(capturedUser.getValue().getEmailVerifiedAt()).isNull();
    org.mockito.Mockito.verify(rateLimiter)
        .allow("REGISTER_EMAIL_HOURLY", "new@example.com", 5, java.time.Duration.ofHours(1));
    org.mockito.Mockito.verify(rateLimiter)
        .allow("REGISTER_EMAIL_DAILY", "new@example.com", 10, java.time.Duration.ofDays(1));
    org.mockito.Mockito.verify(rateLimiter)
        .allow("REGISTER_IP_HOURLY", "198.51.100.22", 60, java.time.Duration.ofHours(1));
    org.mockito.Mockito.verify(rateLimiter)
        .allow("REGISTER_IP_DAILY", "198.51.100.22", 200, java.time.Duration.ofDays(1));
  }

  @Test
  void registrationRateLimitRejectsBeforePasswordHashingOrAccountCreation() {
    UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    PasswordEncoder passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    PersistentAuthRateLimiter rateLimiter =
        org.mockito.Mockito.mock(PersistentAuthRateLimiter.class);
    when(rateLimiter.allow(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyInt(),
            org.mockito.ArgumentMatchers.any()))
        .thenReturn(false, true);

    AuthService authService =
        new AuthService(
            userRepository,
            passwordEncoder,
            org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class),
            org.mockito.Mockito.mock(
                com.dirtyduty.app.repository.HouseholdMembershipRepository.class),
            org.mockito.Mockito.mock(HouseholdSettingsService.class),
            new LegalAcceptanceService(userRepository),
            org.mockito.Mockito.mock(PasswordLoginProtectionService.class),
            org.mockito.Mockito.mock(EmailVerificationService.class),
            rateLimiter);

    assertThatThrownBy(
            () ->
                authService.register(
                    new RegisterRequest("User", "limited@example.com", "StrongPassword123!"),
                    "198.51.100.20"))
        .isInstanceOf(EmailVerificationRateLimitException.class);
    org.mockito.Mockito.verifyNoInteractions(passwordEncoder);
    org.mockito.Mockito.verify(userRepository, org.mockito.Mockito.never()).saveAndFlush(any());
  }

  @Test
  void register_translatesDatabaseUniqueConstraintRaceToDuplicateResource() {
    UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    PasswordEncoder passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    when(userRepository.existsByEmailIgnoreCase("race@example.com")).thenReturn(false);
    when(passwordEncoder.encode("StrongPassword123!")).thenReturn("{bcrypt}hash");
    when(userRepository.saveAndFlush(any()))
        .thenThrow(new DataIntegrityViolationException("unique email constraint"));

    org.springframework.jdbc.core.JdbcTemplate jdbcTemplate =
        org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
    com.dirtyduty.app.repository.HouseholdMembershipRepository membershipRepository =
        org.mockito.Mockito.mock(com.dirtyduty.app.repository.HouseholdMembershipRepository.class);
    HouseholdSettingsService householdSettingsService =
        org.mockito.Mockito.mock(HouseholdSettingsService.class);
    PersistentAuthRateLimiter rateLimiter =
        org.mockito.Mockito.mock(PersistentAuthRateLimiter.class);
    when(rateLimiter.allow(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyInt(),
            org.mockito.ArgumentMatchers.any()))
        .thenReturn(true);

    AuthService authService =
        new AuthService(
            userRepository,
            passwordEncoder,
            jdbcTemplate,
            membershipRepository,
            householdSettingsService,
            new LegalAcceptanceService(userRepository),
            org.mockito.Mockito.mock(PasswordLoginProtectionService.class),
            org.mockito.Mockito.mock(EmailVerificationService.class),
            rateLimiter);

    assertThatThrownBy(
            () ->
                authService.register(
                    new RegisterRequest("Race User", "race@example.com", "StrongPassword123!")))
        .isInstanceOf(DuplicateResourceException.class)
        .hasMessage("A user with this email already exists.");
  }

  @Test
  void registrationRateLimitCountsDuplicateAttemptsWithoutRehashingThem() {
    UserRepository userRepository = org.mockito.Mockito.mock(UserRepository.class);
    PasswordEncoder passwordEncoder = org.mockito.Mockito.mock(PasswordEncoder.class);
    PersistentAuthRateLimiter rateLimiter =
        org.mockito.Mockito.mock(PersistentAuthRateLimiter.class);
    when(rateLimiter.allow(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyInt(),
            org.mockito.ArgumentMatchers.any()))
        .thenReturn(true, true, true, true, true, true, true, true, false, true, true, true);
    when(userRepository.existsByEmailIgnoreCase("repeated@example.com")).thenReturn(true, true);

    AuthService authService =
        new AuthService(
            userRepository,
            passwordEncoder,
            org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class),
            org.mockito.Mockito.mock(
                com.dirtyduty.app.repository.HouseholdMembershipRepository.class),
            org.mockito.Mockito.mock(HouseholdSettingsService.class),
            new LegalAcceptanceService(userRepository),
            org.mockito.Mockito.mock(PasswordLoginProtectionService.class),
            org.mockito.Mockito.mock(EmailVerificationService.class),
            rateLimiter);
    RegisterRequest request =
        new RegisterRequest("User", "repeated@example.com", "StrongPassword123!");

    assertThatThrownBy(() -> authService.register(request, "198.51.100.21"))
        .isInstanceOf(DuplicateResourceException.class);
    assertThatThrownBy(() -> authService.register(request, "198.51.100.21"))
        .isInstanceOf(DuplicateResourceException.class);
    assertThatThrownBy(() -> authService.register(request, "198.51.100.21"))
        .isInstanceOf(EmailVerificationRateLimitException.class);
    org.mockito.Mockito.verifyNoInteractions(passwordEncoder);
  }
}
