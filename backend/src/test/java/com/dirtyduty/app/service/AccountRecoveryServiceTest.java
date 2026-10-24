package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class AccountRecoveryServiceTest {
  @Test
  void routesUnverifiedAccountsToMailboxRecoveryWhenVerificationIsEnabled() {
    UserRepository users = Mockito.mock(UserRepository.class);
    PasswordResetService passwordResets = Mockito.mock(PasswordResetService.class);
    EmailVerificationService emailVerification = Mockito.mock(EmailVerificationService.class);
    User pending = new User();
    pending.setEmail("pending@example.com");
    when(users.findByEmailIgnoreCase("pending@example.com")).thenReturn(Optional.of(pending));
    when(passwordResets.genericResponse()).thenReturn("generic");

    AccountRecoveryService service =
        new AccountRecoveryService(users, passwordResets, emailVerification, true);
    assertThat(service.requestInstructions(" Pending@Example.com ", "192.0.2.1"))
        .isEqualTo("generic");

    verify(emailVerification).requestRecovery("pending@example.com", "192.0.2.1");
    verify(passwordResets, never()).request("pending@example.com", "192.0.2.1");
  }

  @Test
  void routesVerifiedAccountsToPasswordResetOnly() {
    UserRepository users = Mockito.mock(UserRepository.class);
    PasswordResetService passwordResets = Mockito.mock(PasswordResetService.class);
    EmailVerificationService emailVerification = Mockito.mock(EmailVerificationService.class);
    User verified = new User();
    verified.setEmail("verified@example.com");
    verified.setEmailVerifiedAt(java.time.OffsetDateTime.now());
    when(users.findByEmailIgnoreCase("verified@example.com")).thenReturn(Optional.of(verified));
    when(passwordResets.request("verified@example.com", "192.0.2.1")).thenReturn("generic");

    AccountRecoveryService service =
        new AccountRecoveryService(users, passwordResets, emailVerification, true);
    assertThat(service.requestInstructions("verified@example.com", "192.0.2.1"))
        .isEqualTo("generic");

    verify(passwordResets).request("verified@example.com", "192.0.2.1");
    verify(emailVerification, never()).requestRecovery("verified@example.com", "192.0.2.1");
  }

  @Test
  void disabledVerificationKeepsRecoveryDispatchUnderPasswordResetFeatureControl() {
    UserRepository users = Mockito.mock(UserRepository.class);
    PasswordResetService passwordResets = Mockito.mock(PasswordResetService.class);
    EmailVerificationService emailVerification = Mockito.mock(EmailVerificationService.class);
    when(passwordResets.request("legacy@example.com", "192.0.2.1")).thenReturn("generic");

    AccountRecoveryService service =
        new AccountRecoveryService(users, passwordResets, emailVerification, false);
    assertThat(service.requestInstructions("legacy@example.com", "192.0.2.1")).isEqualTo("generic");

    verify(passwordResets).request("legacy@example.com", "192.0.2.1");
    verify(users, never()).findByEmailIgnoreCase("legacy@example.com");
    verify(emailVerification, never()).requestRecovery("legacy@example.com", "192.0.2.1");
  }
}
