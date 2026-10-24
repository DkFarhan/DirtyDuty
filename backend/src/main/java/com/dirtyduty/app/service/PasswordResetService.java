package com.dirtyduty.app.service;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.PasswordResetSamePasswordException;
import com.dirtyduty.app.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordResetService {
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();
  private static final Duration RATE_WINDOW = Duration.ofMinutes(15);
  private static final String GENERIC_RESPONSE =
      "If an account exists for that email, we've sent password reset instructions.";

  private final UserRepository userRepository;
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final ApplicationEventPublisher events;
  private final PersistentAuthRateLimiter rateLimiter;
  private final PasswordLoginProtectionService loginProtection;
  private final FindByIndexNameSessionRepository<? extends Session> sessions;
  private final boolean enabled;
  private final boolean emailVerificationEnabled;
  private final Duration ttl;
  private final int emailLimit;
  private final int ipLimit;
  private final int confirmIpLimit;

  public PasswordResetService(
      UserRepository userRepository,
      JdbcTemplate jdbc,
      PasswordEncoder passwordEncoder,
      ApplicationEventPublisher events,
      PersistentAuthRateLimiter rateLimiter,
      PasswordLoginProtectionService loginProtection,
      FindByIndexNameSessionRepository<? extends Session> sessions,
      @Value("${app.auth.password-reset.enabled:false}") boolean enabled,
      @Value("${app.auth.email-verification.enabled:false}") boolean emailVerificationEnabled,
      @Value("${app.auth.password-reset.token-ttl:30m}") Duration ttl,
      @Value("${app.auth.password-reset.request-email-limit:3}") int emailLimit,
      @Value("${app.auth.password-reset.request-ip-limit:5}") int ipLimit,
      @Value("${app.auth.password-reset.confirm-ip-limit:10}") int confirmIpLimit) {
    this.userRepository = userRepository;
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.events = events;
    this.rateLimiter = rateLimiter;
    this.loginProtection = loginProtection;
    this.sessions = sessions;
    this.enabled = enabled;
    this.emailVerificationEnabled = emailVerificationEnabled;
    this.ttl = ttl;
    this.emailLimit = emailLimit;
    this.ipLimit = ipLimit;
    this.confirmIpLimit = confirmIpLimit;
  }

  @Transactional
  public String request(String submittedEmail, String sourceIp) {
    if (!enabled) return GENERIC_RESPONSE;
    String email = submittedEmail == null ? "" : submittedEmail.trim().toLowerCase(Locale.ROOT);
    boolean ipAllowed = rateLimiter.allow("RESET_IP", sourceIp, ipLimit, RATE_WINDOW);
    boolean emailAllowed = rateLimiter.allow("RESET_EMAIL", email, emailLimit, RATE_WINDOW);
    if (!ipAllowed || !emailAllowed || email.isBlank()) {
      return GENERIC_RESPONSE;
    }

    User user = userRepository.findByEmailIgnoreCaseForUpdate(email).orElse(null);
    if (user == null
        || user.getAccountStatus() != AccountStatus.ACTIVE
        || (emailVerificationEnabled && user.getEmailVerifiedAt() == null)) {
      return GENERIC_RESPONSE;
    }

    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    jdbc.update(
        "UPDATE password_reset_token SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
        now,
        user.getId());
    byte[] bytes = new byte[32];
    SECURE_RANDOM.nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    jdbc.update(
        """
        INSERT INTO password_reset_token(user_id, token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        user.getId(),
        tokenHash(token),
        now,
        now.plus(ttl));

    events.publishEvent(
        new PasswordResetEmailRequestedEvent(user.getEmail(), token, ttl, tokenHash(token)));
    return GENERIC_RESPONSE;
  }

  @Transactional
  public boolean confirm(String token, String newPassword, String sourceIp) {
    if (!enabled
        || token == null
        || !token.matches("[A-Za-z0-9_-]{43}")
        || !rateLimiter.allow("RESET_CONFIRM_IP", sourceIp, confirmIpLimit, RATE_WINDOW)
        || newPassword == null
        || newPassword.length() < 12
        || newPassword.length() > 128) {
      return false;
    }

    UUID userId;
    try {
      userId =
          jdbc.queryForObject(
              """
              SELECT user_id
              FROM password_reset_token
              WHERE token_hash = ?
                AND used_at IS NULL
                AND expires_at > NOW()
              """,
              UUID.class,
              tokenHash(token));
    } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
      return false;
    }

    User user =
        userRepository
            .findByIdForUpdate(userId)
            .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
            .orElse(null);
    if (user == null) return false;

    if (user.getPasswordHash() != null
        && passwordEncoder.matches(newPassword, user.getPasswordHash())) {
      throw new PasswordResetSamePasswordException();
    }

    try {
      jdbc.queryForObject(
          """
          UPDATE password_reset_token
          SET used_at = NOW()
          WHERE token_hash = ?
            AND user_id = ?
            AND used_at IS NULL
            AND expires_at > NOW()
          RETURNING user_id
          """,
          UUID.class,
          tokenHash(token),
          userId);
    } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
      return false;
    }

    user.setPasswordHash(passwordEncoder.encode(newPassword));
    userRepository.saveAndFlush(user);
    loginProtection.clearAccountFailures(user.getEmail());
    jdbc.update(
        "UPDATE password_reset_token SET used_at = COALESCE(used_at, NOW()) WHERE user_id = ?",
        userId);
    invalidateSessions(user.getEmail());
    return true;
  }

  public String genericResponse() {
    return GENERIC_RESPONSE;
  }

  private void invalidateSessions(String principalName) {
    sessions.findByPrincipalName(principalName).keySet().forEach(sessions::deleteById);
  }

  private String tokenHash(String token) {
    try {
      return java.util.HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is unavailable.", exception);
    }
  }
}
