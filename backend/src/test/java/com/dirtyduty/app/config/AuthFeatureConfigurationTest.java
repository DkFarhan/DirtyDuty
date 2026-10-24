package com.dirtyduty.app.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class AuthFeatureConfigurationTest {
  @Test
  void passwordResetRequiresMandatoryStartTlsAndServerIdentityValidation() {
    assertThatThrownBy(() -> configuration(true, true, false, true).validate())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("mandatory STARTTLS");
    assertThatThrownBy(() -> configuration(true, true, true, false).validate())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("server identity verification");
  }

  @Test
  void authenticatedSmtpRequiresCredentialsAndSecureTransport() {
    assertThatThrownBy(() -> configuration(false, true, false, true).validate())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("mandatory STARTTLS");
    assertThatThrownBy(
            () ->
                new AuthFeatureConfiguration(
                        false,
                        "",
                        "",
                        false,
                        false,
                        false,
                        Duration.ofMinutes(30),
                        "",
                        "https://dirtyduty.test",
                        "smtp.dirtyduty.test",
                        "",
                        "",
                        "reset@dirtyduty.test",
                        true,
                        true,
                        true,
                        true)
                    .validate())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("MAIL_USERNAME and MAIL_PASSWORD");
  }

  @Test
  void resetConfigurationWithSecureAuthenticatedSmtpIsAccepted() {
    assertThatCode(() -> configuration(true, true, true, true).validate())
        .doesNotThrowAnyException();
  }

  @Test
  void emailVerificationRequiresSecureSecretAndConfiguredDelivery() {
    AuthFeatureConfiguration missingSecret =
        new AuthFeatureConfiguration(
            false,
            "",
            "",
            false,
            true,
            true,
            Duration.ofMinutes(30),
            "",
            "https://dirtyduty.test",
            "smtp.dirtyduty.test",
            "test-user",
            "test-password",
            "verify@dirtyduty.test",
            true,
            true,
            true,
            true);

    assertThatThrownBy(missingSecret::validate)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("AUTH_RATE_LIMIT_HMAC_SECRET");

    AuthFeatureConfiguration unauthenticatedSmtp =
        new AuthFeatureConfiguration(
            false,
            "",
            "",
            false,
            true,
            true,
            Duration.ofMinutes(30),
            "test-only-hmac-secret-with-at-least-32-characters",
            "https://dirtyduty.test",
            "smtp.dirtyduty.test",
            "",
            "",
            "verify@dirtyduty.test",
            false,
            true,
            true,
            true);
    assertThatThrownBy(unauthenticatedSmtp::validate)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("authenticated SMTP");
  }

  @Test
  void googleAuthenticationRequiresAnHttpsRedirectBaseUrl() {
    AuthFeatureConfiguration insecureBase =
        new AuthFeatureConfiguration(
            true,
            "google-client-id",
            "google-client-secret",
            false,
            false,
            false,
            Duration.ofMinutes(30),
            "",
            "http://attacker.example",
            "",
            "",
            "",
            "",
            false,
            true,
            true,
            true);

    assertThatThrownBy(insecureBase::validate)
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("HTTPS APP_BASE_URL");
  }

  private AuthFeatureConfiguration configuration(
      boolean resetEnabled,
      boolean smtpAuth,
      boolean startTlsRequired,
      boolean verifyServerIdentity) {
    return new AuthFeatureConfiguration(
        false,
        "",
        "",
        resetEnabled,
        false,
        false,
        Duration.ofMinutes(30),
        "test-only-hmac-secret-with-at-least-32-characters",
        "https://dirtyduty.test",
        "smtp.dirtyduty.test",
        "test-user",
        "test-password",
        "reset@dirtyduty.test",
        smtpAuth,
        true,
        startTlsRequired,
        verifyServerIdentity);
  }
}
