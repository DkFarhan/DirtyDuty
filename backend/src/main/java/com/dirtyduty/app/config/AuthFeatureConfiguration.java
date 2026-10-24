package com.dirtyduty.app.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.stereotype.Component;

@Component
@EnableAsync
public class AuthFeatureConfiguration {
  private final boolean googleEnabled;
  private final String googleClientId;
  private final String googleClientSecret;
  private final boolean passwordResetEnabled;
  private final boolean emailVerificationEnabled;
  private final boolean emailVerificationDeliveryEnabled;
  private final Duration resetTtl;
  private final String rateLimitSecret;
  private final String appBaseUrl;
  private final String mailHost;
  private final String mailUsername;
  private final String mailPassword;
  private final String mailFrom;
  private final boolean mailSmtpAuth;
  private final boolean mailStartTls;
  private final boolean mailStartTlsRequired;
  private final boolean mailVerifyServerIdentity;

  public AuthFeatureConfiguration(
      @Value("${app.auth.google.enabled:false}") boolean googleEnabled,
      @Value("${app.auth.google.client-id:}") String googleClientId,
      @Value("${app.auth.google.client-secret:}") String googleClientSecret,
      @Value("${app.auth.password-reset.enabled:false}") boolean passwordResetEnabled,
      @Value("${app.auth.email-verification.enabled:false}") boolean emailVerificationEnabled,
      @Value("${app.auth.email-verification.delivery-enabled:false}")
          boolean emailVerificationDeliveryEnabled,
      @Value("${app.auth.password-reset.token-ttl:30m}") Duration resetTtl,
      @Value("${app.auth.password-reset.rate-limit-hmac-secret:}") String rateLimitSecret,
      @Value("${app.base-url}") String appBaseUrl,
      @Value("${spring.mail.host:}") String mailHost,
      @Value("${spring.mail.username:}") String mailUsername,
      @Value("${spring.mail.password:}") String mailPassword,
      @Value("${MAIL_FROM_ADDRESS:}") String mailFrom,
      @Value("${spring.mail.properties.mail.smtp.auth:true}") boolean mailSmtpAuth,
      @Value("${spring.mail.properties.mail.smtp.starttls.enable:true}") boolean mailStartTls,
      @Value("${spring.mail.properties.mail.smtp.starttls.required:true}")
          boolean mailStartTlsRequired,
      @Value("${spring.mail.properties.mail.smtp.ssl.checkserveridentity:true}")
          boolean mailVerifyServerIdentity) {
    this.googleEnabled = googleEnabled;
    this.googleClientId = googleClientId;
    this.googleClientSecret = googleClientSecret;
    this.passwordResetEnabled = passwordResetEnabled;
    this.emailVerificationEnabled = emailVerificationEnabled;
    this.emailVerificationDeliveryEnabled = emailVerificationDeliveryEnabled;
    this.resetTtl = resetTtl;
    this.rateLimitSecret = rateLimitSecret;
    this.appBaseUrl = appBaseUrl;
    this.mailHost = mailHost;
    this.mailUsername = mailUsername;
    this.mailPassword = mailPassword;
    this.mailFrom = mailFrom;
    this.mailSmtpAuth = mailSmtpAuth;
    this.mailStartTls = mailStartTls;
    this.mailStartTlsRequired = mailStartTlsRequired;
    this.mailVerifyServerIdentity = mailVerifyServerIdentity;
  }

  @PostConstruct
  void validate() {
    if (googleEnabled && (googleClientId.isBlank() || googleClientSecret.isBlank())) {
      throw new IllegalStateException(
          "Google authentication requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }
    if (googleEnabled || passwordResetEnabled || emailVerificationEnabled) {
      validateAppBaseUrl();
    }
    if (emailVerificationEnabled) {
      if (rateLimitSecret.length() < 32) {
        throw new IllegalStateException(
            "Email verification requires AUTH_RATE_LIMIT_HMAC_SECRET of at least 32 characters.");
      }
      if (!emailVerificationDeliveryEnabled) {
        throw new IllegalStateException(
            "Email verification requires EMAIL_VERIFICATION_DELIVERY_ENABLED=true.");
      }
      if (mailHost.isBlank() || mailFrom.isBlank()) {
        throw new IllegalStateException(
            "Email verification requires an SMTP host and sender address.");
      }
      if (!mailSmtpAuth) {
        throw new IllegalStateException("Email verification requires authenticated SMTP.");
      }
    }
    if (passwordResetEnabled) {
      if (resetTtl.isNegative()
          || resetTtl.isZero()
          || resetTtl.compareTo(Duration.ofHours(2)) > 0) {
        throw new IllegalStateException(
            "Password reset token TTL must be positive and at most 2h.");
      }
      if (rateLimitSecret.length() < 32) {
        throw new IllegalStateException(
            "Password reset requires AUTH_RATE_LIMIT_HMAC_SECRET of at least 32 characters.");
      }
      if (mailHost.isBlank() || mailFrom.isBlank()) {
        throw new IllegalStateException("Password reset requires an SMTP host and sender address.");
      }
    }
    if ((passwordResetEnabled || emailVerificationEnabled || (!mailHost.isBlank() && mailSmtpAuth))
        && (!mailStartTls || !mailStartTlsRequired || !mailVerifyServerIdentity)) {
      throw new IllegalStateException(
          "SMTP requires mandatory STARTTLS and server identity verification.");
    }
    if (mailSmtpAuth && !mailHost.isBlank()) {
      if (mailUsername.isBlank() || mailPassword.isBlank()) {
        throw new IllegalStateException(
            "SMTP authentication requires MAIL_USERNAME and MAIL_PASSWORD.");
      }
    }
  }

  private void validateAppBaseUrl() {
    URI base = URI.create(appBaseUrl);
    boolean localHttp =
        "localhost".equalsIgnoreCase(base.getHost()) && "http".equalsIgnoreCase(base.getScheme());
    if (base.getHost() == null
        || (!"https".equalsIgnoreCase(base.getScheme()) && !localHttp)
        || base.getRawUserInfo() != null
        || base.getRawQuery() != null
        || base.getRawFragment() != null
        || (base.getPath() != null && !base.getPath().isEmpty() && !base.getPath().equals("/"))) {
      throw new IllegalStateException(
          "Authentication redirects require an HTTPS APP_BASE_URL without a path or query.");
    }
  }

  public boolean googleEnabled() {
    return googleEnabled;
  }

  String googleClientId() {
    return googleClientId;
  }

  String googleClientSecret() {
    return googleClientSecret;
  }

  public boolean passwordResetEnabled() {
    return passwordResetEnabled;
  }

  public boolean emailVerificationEnabled() {
    return emailVerificationEnabled;
  }

  public Duration resetTtl() {
    return resetTtl;
  }

  public String appBaseUrl() {
    return appBaseUrl;
  }
}
