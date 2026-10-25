package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.auth.EmailVerificationStatusResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.EmailVerificationInvalidCodeException;
import com.dirtyduty.app.exception.EmailVerificationRateLimitException;
import com.dirtyduty.app.exception.EmailVerificationUnavailableException;
import com.dirtyduty.app.exception.PasswordResetSamePasswordException;
import com.dirtyduty.app.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class EmailVerificationService {
  private static final Logger logger = LoggerFactory.getLogger(EmailVerificationService.class);
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Duration RESEND_INTERVAL = Duration.ofSeconds(60);
  private static final Duration RECOVERY_WINDOW = Duration.ofDays(30);
  private static final Duration EMAIL_CORRECTION_WINDOW = Duration.ofHours(24);

  private final JdbcTemplate jdbc;
  private final UserRepository users;
  private final EmailVerificationMailer mailer;
  private final PasswordEncoder passwordEncoder;
  private final TransactionTemplate transactions;
  private final TransactionTemplate reservationTransactions;
  private final byte[] secret;
  private final boolean enabled;

  public EmailVerificationService(
      JdbcTemplate jdbc,
      UserRepository users,
      EmailVerificationMailer mailer,
      PasswordEncoder passwordEncoder,
      PlatformTransactionManager transactionManager,
      @Value("${app.auth.password-reset.rate-limit-hmac-secret:}") String secret,
      @Value("${app.auth.email-verification.enabled:false}") boolean enabled) {
    this.jdbc = jdbc;
    this.users = users;
    this.mailer = mailer;
    this.passwordEncoder = passwordEncoder;
    this.transactions = new TransactionTemplate(transactionManager);
    this.reservationTransactions = new TransactionTemplate(transactionManager);
    this.reservationTransactions.setPropagationBehavior(
        org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.secret = secret.getBytes(StandardCharsets.UTF_8);
    this.enabled = enabled;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public boolean isVerified(String email) {
    if (!enabled) return true;
    return users
        .findByEmailIgnoreCase(email)
        .map(user -> user.getEmailVerifiedAt() != null)
        .orElse(false);
  }

  public String sendInitial(UUID userId, String sourceIp) {
    return issueCode(userId, sourceIp, true);
  }

  public void reserveInitialDelivery(String email) {
    if (enabled) {
      java.util.List<RateLimit> limits =
          java.util.List.of(
              new RateLimit("SEND_EMAIL", normalizeEmail(email), 5, Duration.ofHours(1)),
              new RateLimit("SEND_EMAIL", normalizeEmail(email), 10, Duration.ofDays(1)));
      if (!applyRollingLimits(limits, reservationTransactions)) {
        throw new EmailVerificationRateLimitException();
      }
    }
  }

  public String sendReservedInitial(UUID userId) {
    return issueCode(userId, null, true, false);
  }

  public String resend(String email, String sourceIp) {
    if (!enabled) throw new EmailVerificationRateLimitException();
    User user = users.findByEmailIgnoreCase(email).orElse(null);
    if (user == null || user.getEmailVerifiedAt() != null) {
      throw new EmailVerificationRateLimitException();
    }
    return issueCode(user.getId(), sourceIp, false);
  }

  public EmailVerificationStatusResponse status(String email) {
    User user = users.findByEmailIgnoreCase(email).orElse(null);
    if (user == null) {
      throw new IllegalStateException("Authenticated user is unavailable.");
    }
    if (user.getEmailVerifiedAt() != null) {
      return new EmailVerificationStatusResponse(user.getEmail(), true, null, null, "SENT");
    }
    VerificationRecord record =
        jdbc.query(
            """
            SELECT email, code_hash, issued_at, expires_at, attempt_count, delivery_state, reclaimable
            FROM email_verification WHERE user_id = ?
            """,
            rs ->
                rs.next()
                    ? new VerificationRecord(
                        rs.getString("email"),
                        rs.getString("code_hash"),
                        rs.getObject("issued_at", OffsetDateTime.class),
                        rs.getObject("expires_at", OffsetDateTime.class),
                        rs.getInt("attempt_count"),
                        rs.getString("delivery_state"),
                        rs.getBoolean("reclaimable"))
                    : null,
            user.getId());
    if (record == null) {
      return new EmailVerificationStatusResponse(user.getEmail(), false, null, null, "NONE");
    }
    return new EmailVerificationStatusResponse(
        user.getEmail(),
        false,
        record.expiresAt(),
        record.issuedAt().plus(RESEND_INTERVAL),
        record.deliveryState());
  }

  public boolean verify(String email, String code, String sourceIp) {
    if (!enabled) return false;
    enforceAttemptLimits(email, sourceIp);
    User user = users.findByEmailIgnoreCase(email).orElse(null);
    if (user == null) return false;
    return Boolean.TRUE.equals(
        transactions.execute(
            transaction -> {
              acquireUserLock(user.getId());
              User current = users.findByIdForUpdate(user.getId()).orElse(null);
              if (current == null || current.getEmailVerifiedAt() != null) return false;
              VerificationRecord record = selectForUpdate(current.getId());
              if (!isValid(record, current, code)) {
                recordFailedAttempt(current.getId(), record);
                return false;
              }
              jdbc.update(
                  "UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = ? AND email_verified_at IS NULL",
                  current.getId());
              jdbc.update("DELETE FROM email_verification WHERE user_id = ?", current.getId());
              return true;
            }));
  }

  public String correctPendingEmail(String currentEmail, String newEmail) {
    String normalizedEmail = normalizeEmail(newEmail);
    return transactions.execute(
        transaction -> {
          User current =
              users
                  .findByEmailIgnoreCase(currentEmail)
                  .orElseThrow(
                      () -> new IllegalStateException("Authenticated user is unavailable."));
          acquireUserLock(current.getId());
          current =
              users
                  .findByIdForUpdate(current.getId())
                  .orElseThrow(
                      () -> new IllegalStateException("Authenticated user is unavailable."));
          VerificationRecord record = selectForUpdate(current.getId());
          if (current.getEmailVerifiedAt() != null
              || record == null
              || !record.reclaimable()
              || current
                  .getCreatedAt()
                  .isBefore(OffsetDateTime.now(ZoneOffset.UTC).minus(EMAIL_CORRECTION_WINDOW))
              || hasAnyBusinessData(current.getId())) {
            throw new EmailVerificationUnavailableException();
          }
          if (users.existsByEmailIgnoreCase(normalizedEmail)) {
            throw new DuplicateResourceException("An account with this email already exists.");
          }
          current.setEmail(normalizedEmail);
          users.saveAndFlush(current);
          jdbc.update(
              """
              UPDATE email_verification
              SET email = ?,
                  code_hash = ?,
                  issued_at = NOW() - INTERVAL '61 seconds',
                  expires_at = NOW(),
                  attempt_count = 5,
                  delivery_state = 'PENDING'
              WHERE user_id = ?
              """,
              normalizedEmail,
              codeHash(current.getId(), normalizedEmail, UUID.randomUUID().toString()),
              current.getId());
          invalidateSessions(currentEmail);
          return normalizedEmail;
        });
  }

  public void requestRecovery(String email, String sourceIp) {
    if (!enabled) return;
    String normalizedEmail = normalizeEmail(email);
    User user = users.findByEmailIgnoreCase(normalizedEmail).orElse(null);
    if (user == null || user.getEmailVerifiedAt() != null || !isEligibleForMailboxRecovery(user)) {
      applyRollingLimits(sendLimits(normalizedEmail, sourceIp));
      return;
    }
    if (!applyRollingLimits(sendLimits(normalizedEmail, sourceIp))) return;
    try {
      createAndSend(user.getId(), normalizedEmail, false, true);
    } catch (EmailVerificationRateLimitException ignored) {
      // Recovery requests are intentionally indistinguishable for eligible and ineligible emails.
    }
  }

  public User completeRecovery(String email, String code, String newPassword, String sourceIp) {
    if (!enabled) throw new EmailVerificationInvalidCodeException();
    String normalizedEmail = normalizeEmail(email);
    enforceAttemptLimits(normalizedEmail, sourceIp);
    User user = users.findByEmailIgnoreCase(normalizedEmail).orElse(null);
    if (user == null) throw new EmailVerificationInvalidCodeException();
    User recovered =
        transactions.execute(
            transaction -> {
              acquireUserLock(user.getId());
              User current = users.findByIdForUpdate(user.getId()).orElse(null);
              if (current == null
                  || current.getEmailVerifiedAt() != null
                  || !isEligibleForMailboxRecovery(current)) {
                return null;
              }
              VerificationRecord record = selectForUpdate(current.getId());
              if (!isValid(record, current, code)) {
                recordFailedAttempt(current.getId(), record);
                return null;
              }
              if (current.getPasswordHash() != null
                  && passwordEncoder.matches(newPassword, current.getPasswordHash())) {
                throw new PasswordResetSamePasswordException();
              }
              current.setEmailVerifiedAt(OffsetDateTime.now(ZoneOffset.UTC));
              current.setPasswordHash(passwordEncoder.encode(newPassword));
              User saved = users.saveAndFlush(current);
              jdbc.update("DELETE FROM email_verification WHERE user_id = ?", current.getId());
              invalidateSessions(normalizedEmail);
              return saved;
            });
    if (recovered == null) {
      throw new EmailVerificationInvalidCodeException();
    }
    return recovered;
  }

  public void reclaimExpiredForEmail(String email) {
    if (!enabled) return;
    User existing = users.findByEmailIgnoreCase(email).orElse(null);
    if (existing == null) return;
    transactions.executeWithoutResult(
        transaction -> {
          acquireUserLock(existing.getId());
          User user = users.findByIdForUpdate(existing.getId()).orElse(null);
          if (user != null
              && user.getAccountStatus() == AccountStatus.ACTIVE
              && user.getEmailVerifiedAt() == null
              && hasReclaimableRegistration(user)
              && !hasAnyBusinessData(user.getId())
              && !hasAnySession(user.getEmail())
              && user.getCreatedAt()
                  .isBefore(OffsetDateTime.now(ZoneOffset.UTC).minus(RECOVERY_WINDOW))) {
            deletePendingUser(user);
          }
        });
  }

  @Scheduled(cron = "${app.auth.email-verification.cleanup-cron:0 20 3 * * *}")
  public void cleanupExpiredCodesAndAbandonedRegistrations() {
    transactions.executeWithoutResult(
        transaction -> {
          jdbc.update(
              """
              DELETE FROM users u
              USING email_verification v
              WHERE v.user_id = u.id
                AND v.reclaimable = TRUE
                AND u.account_status = 'ACTIVE'
                AND u.email_verified_at IS NULL
                AND u.created_at < NOW() - INTERVAL '30 days'
                AND NOT EXISTS (SELECT 1 FROM household_memberships m WHERE m.user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM households h WHERE h.created_by_user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM external_auth_identity x WHERE x.user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM notification_events e WHERE e.actor_user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM notification_preferences p WHERE p.user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM password_reset_token p WHERE p.user_id = u.id)
                AND NOT EXISTS (SELECT 1 FROM spring_session s WHERE LOWER(s.principal_name) = LOWER(u.email))
              """);
          jdbc.update(
              "DELETE FROM email_verification WHERE expires_at < NOW() - INTERVAL '1 day' AND reclaimable = FALSE");
          jdbc.update(
              "DELETE FROM email_verification_rate_event WHERE requested_at < NOW() - INTERVAL '2 days'");
        });
  }

  private String issueCode(UUID userId, String sourceIp, boolean initial) {
    return issueCode(userId, sourceIp, initial, true);
  }

  private String issueCode(UUID userId, String sourceIp, boolean initial, boolean enforceLimits) {
    User user =
        users.findById(userId).orElseThrow(() -> new IllegalStateException("User is unavailable."));
    if (enforceLimits) enforceRollingLimits(sendLimits(user.getEmail(), sourceIp));
    return createAndSend(userId, user.getEmail(), initial, initial);
  }

  private String createAndSend(UUID userId, String email, boolean initial, boolean recovery) {
    String normalizedEmail = normalizeEmail(email);
    String code = String.format(Locale.ROOT, "%06d", RANDOM.nextInt(1_000_000));
    String codeHash = codeHash(userId, normalizedEmail, code);
    Boolean issued =
        transactions.execute(
            transaction -> {
              acquireUserLock(userId);
              VerificationRecord existing = selectForUpdate(userId);
              if (existing != null
                  && !initial
                  && existing
                      .issuedAt()
                      .plus(RESEND_INTERVAL)
                      .isAfter(OffsetDateTime.now(ZoneOffset.UTC))) {
                return false;
              }
              jdbc.update(
                  """
                  INSERT INTO email_verification(
                      user_id, email, code_hash, issued_at, expires_at, attempt_count,
                      delivery_state, reclaimable
                  ) VALUES (?, ?, ?, NOW(), NOW() + INTERVAL '10 minutes', 0, 'PENDING', ?)
                  ON CONFLICT (user_id) DO UPDATE SET
                      email = EXCLUDED.email,
                      code_hash = EXCLUDED.code_hash,
                      issued_at = EXCLUDED.issued_at,
                      expires_at = EXCLUDED.expires_at,
                      attempt_count = 0,
                      delivery_state = 'PENDING',
                      reclaimable = email_verification.reclaimable OR EXCLUDED.reclaimable
                  """,
                  userId,
                  normalizedEmail,
                  codeHash,
                  recovery || initial);
              return true;
            });
    if (!Boolean.TRUE.equals(issued)) throw new EmailVerificationRateLimitException();

    try {
      mailer.sendVerificationCode(normalizedEmail, code);
      jdbc.update(
          "UPDATE email_verification SET delivery_state = 'SENT' WHERE user_id = ? AND code_hash = ?",
          userId,
          codeHash);
      return "SENT";
    } catch (RuntimeException exception) {
      jdbc.update(
          "UPDATE email_verification SET delivery_state = 'FAILED' WHERE user_id = ? AND code_hash = ?",
          userId,
          codeHash);
      logger.warn("Email verification delivery failed; verification code is not logged.");
      return "FAILED";
    }
  }

  private java.util.List<RateLimit> sendLimits(String email, String sourceIp) {
    String normalizedEmail = normalizeEmail(email);
    String ip = normalizeIp(sourceIp);
    return java.util.List.of(
        new RateLimit("SEND_EMAIL", normalizedEmail, 5, Duration.ofHours(1)),
        new RateLimit("SEND_EMAIL", normalizedEmail, 10, Duration.ofDays(1)),
        new RateLimit("SEND_IP", ip, 20, Duration.ofHours(1)),
        new RateLimit("SEND_IP", ip, 50, Duration.ofDays(1)));
  }

  private void enforceAttemptLimits(String email, String sourceIp) {
    enforceRollingLimits(
        java.util.List.of(
            new RateLimit("VERIFY_EMAIL", normalizeEmail(email), 20, Duration.ofHours(1)),
            new RateLimit("VERIFY_IP", normalizeIp(sourceIp), 100, Duration.ofHours(1))));
  }

  private void enforceRollingLimits(java.util.List<RateLimit> limits) {
    if (!applyRollingLimits(limits)) throw new EmailVerificationRateLimitException();
  }

  private boolean applyRollingLimits(java.util.List<RateLimit> limits) {
    return applyRollingLimits(limits, transactions);
  }

  private boolean applyRollingLimits(
      java.util.List<RateLimit> limits, TransactionTemplate transactionTemplate) {
    return Boolean.TRUE.equals(
        transactionTemplate.execute(
            transaction -> {
              long[] lockKeys =
                  limits.stream()
                      .mapToLong(limit -> rateLockKey(limit.scope(), limit.identifier()))
                      .distinct()
                      .sorted()
                      .toArray();
              for (long lockKey : lockKeys) {
                jdbc.query(
                    "SELECT pg_advisory_xact_lock(?)",
                    (resultSet, rowNumber) -> Boolean.TRUE,
                    lockKey);
              }
              OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
              boolean allowed = true;
              for (RateLimit limit : limits) {
                String subjectHash = rateHash(limit.scope(), limit.identifier());
                Integer count =
                    jdbc.queryForObject(
                        """
                        SELECT COUNT(*) FROM email_verification_rate_event
                        WHERE scope = ? AND window_seconds = ? AND subject_hash = ? AND requested_at > ?
                        """,
                        Integer.class,
                        limit.scope(),
                        Math.toIntExact(limit.window().toSeconds()),
                        subjectHash,
                        now.minus(limit.window()));
                allowed &= count < limit.maximum();
              }
              if (allowed) {
                for (RateLimit limit : limits) {
                  jdbc.update(
                      """
                      INSERT INTO email_verification_rate_event(
                          scope, subject_hash, window_seconds, requested_at
                      ) VALUES (?, ?, ?, ?)
                      """,
                      limit.scope(),
                      rateHash(limit.scope(), limit.identifier()),
                      Math.toIntExact(limit.window().toSeconds()),
                      now);
                }
              }
              return allowed;
            }));
  }

  private VerificationRecord selectForUpdate(UUID userId) {
    return jdbc.query(
        """
        SELECT email, code_hash, issued_at, expires_at, attempt_count, delivery_state, reclaimable
        FROM email_verification WHERE user_id = ? FOR UPDATE
        """,
        rs ->
            rs.next()
                ? new VerificationRecord(
                    rs.getString("email"),
                    rs.getString("code_hash"),
                    rs.getObject("issued_at", OffsetDateTime.class),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getInt("attempt_count"),
                    rs.getString("delivery_state"),
                    rs.getBoolean("reclaimable"))
                : null,
        userId);
  }

  private boolean isValid(VerificationRecord record, User user, String code) {
    if (record == null
        || record.attemptCount() >= 5
        || record.expiresAt().isBefore(OffsetDateTime.now(ZoneOffset.UTC))
        || !record.email().equalsIgnoreCase(user.getEmail())
        || code == null
        || !code.matches("[0-9]{6}")) {
      return false;
    }
    return MessageDigest.isEqual(
        record.codeHash().getBytes(StandardCharsets.US_ASCII),
        codeHash(user.getId(), normalizeEmail(record.email()), code)
            .getBytes(StandardCharsets.US_ASCII));
  }

  private void recordFailedAttempt(UUID userId, VerificationRecord record) {
    if (record == null) return;
    jdbc.update(
        """
        UPDATE email_verification
        SET attempt_count = attempt_count + 1,
            expires_at = CASE WHEN attempt_count + 1 >= 5 THEN NOW() ELSE expires_at END
        WHERE user_id = ? AND attempt_count < 5
        """,
        userId);
  }

  private void acquireUserLock(UUID userId) {
    jdbc.query(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        (resultSet, rowNumber) -> Boolean.TRUE,
        "email-verification:" + userId);
  }

  private String codeHash(UUID userId, String email, String code) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      return HexFormat.of()
          .formatHex(
              mac.doFinal(
                  ("EMAIL_VERIFICATION:" + userId + ":" + normalizeEmail(email) + ":" + code)
                      .getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Unable to protect email verification code.", exception);
    }
  }

  private boolean isEligibleForMailboxRecovery(User user) {
    return user != null
        && user.getAccountStatus() == AccountStatus.ACTIVE
        && hasReclaimableRegistration(user)
        && !hasAnyBusinessData(user.getId())
        && !user.getCreatedAt().isBefore(OffsetDateTime.now(ZoneOffset.UTC).minus(RECOVERY_WINDOW));
  }

  private boolean hasReclaimableRegistration(User user) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM email_verification WHERE user_id = ? AND reclaimable = TRUE)",
            Boolean.class,
            user.getId()));
  }

  private boolean hasAnyBusinessData(UUID userId) {
    Boolean hasData =
        jdbc.queryForObject(
            """
            SELECT EXISTS (SELECT 1 FROM household_memberships WHERE user_id = ?)
                OR EXISTS (SELECT 1 FROM households WHERE created_by_user_id = ?)
                OR EXISTS (SELECT 1 FROM external_auth_identity WHERE user_id = ?)
                OR EXISTS (SELECT 1 FROM notifications WHERE recipient_user_id = ?)
                OR EXISTS (SELECT 1 FROM notification_events WHERE actor_user_id = ?)
                OR EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = ?)
                OR EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = ?)
                OR EXISTS (SELECT 1 FROM password_reset_token WHERE user_id = ?)
            """,
            Boolean.class,
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            userId);
    return Boolean.TRUE.equals(hasData);
  }

  private void deletePendingUser(User user) {
    jdbc.update("DELETE FROM email_verification WHERE user_id = ?", user.getId());
    users.delete(user);
  }

  private boolean hasAnySession(String email) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM spring_session WHERE LOWER(principal_name) = LOWER(?))",
            Boolean.class,
            email));
  }

  private void invalidateSessions(String email) {
    jdbc.update(
        """
        DELETE FROM spring_session_attributes
        WHERE session_primary_id IN (
            SELECT primary_id FROM spring_session WHERE principal_name = ?
        )
        """,
        email);
    jdbc.update("DELETE FROM spring_session WHERE principal_name = ?", email);
  }

  private String normalizeEmail(String email) {
    return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
  }

  private String normalizeIp(String ip) {
    return ip == null || ip.isBlank() ? "unknown" : ip.trim();
  }

  private String rateHash(String scope, String identifier) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      return HexFormat.of()
          .formatHex(mac.doFinal((scope + ":" + identifier).getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Unable to protect verification rate-limit key.", exception);
    }
  }

  private long rateLockKey(String scope, String identifier) {
    return Long.parseUnsignedLong(rateHash(scope, identifier).substring(0, 16), 16);
  }

  private record VerificationRecord(
      String email,
      String codeHash,
      OffsetDateTime issuedAt,
      OffsetDateTime expiresAt,
      int attemptCount,
      String deliveryState,
      boolean reclaimable) {}

  private record RateLimit(String scope, String identifier, int maximum, Duration window) {}
}
