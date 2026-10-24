package com.dirtyduty.app.service;

import com.dirtyduty.app.exception.LoginTemporarilyThrottledException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordLoginProtectionService {
  private static final int MAX_CONSECUTIVE_FAILURES = 100;
  private static final String DUMMY_PASSWORD = "Dummy password used for throttled authentication";

  private final JdbcTemplate jdbc;
  private final byte[] secret;
  private final PasswordEncoder passwordEncoder;
  private final String dummyPasswordHash;

  public PasswordLoginProtectionService(
      JdbcTemplate jdbc,
      PasswordEncoder passwordEncoder,
      @Value("${app.auth.password-reset.rate-limit-hmac-secret:}") String secret) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.secret = secret.getBytes(StandardCharsets.UTF_8);
    if (this.secret.length < 32) {
      throw new IllegalStateException(
          "AUTH_RATE_LIMIT_HMAC_SECRET must be configured with at least 32 bytes.");
    }
    this.dummyPasswordHash = passwordEncoder.encode(DUMMY_PASSWORD);
  }

  public void assertAllowed(String email, String sourceIp, String submittedPassword) {
    String accountHash = hash("ACCOUNT", normalizeEmail(email));
    String ipHash = hash("IP", normalizeIp(sourceIp));
    Boolean blocked =
        jdbc.queryForObject(
            """
            SELECT EXISTS (
                SELECT 1
                FROM auth_login_failure
                WHERE cooldown_until > NOW()
                  AND ((scope = 'ACCOUNT' AND subject_hash = ?)
                    OR (scope = 'IP' AND subject_hash = ?))
            )
            """,
            Boolean.class,
            accountHash,
            ipHash);
    if (Boolean.TRUE.equals(blocked)) {
      passwordEncoder.matches(
          submittedPassword == null ? "" : submittedPassword, dummyPasswordHash);
      throw new LoginTemporarilyThrottledException(
          "Too many sign-in attempts. Please wait and try again, or reset your password.");
    }
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void recordFailure(String email, String sourceIp) {
    incrementScopeFailure("ACCOUNT", hash("ACCOUNT", normalizeEmail(email)));
    incrementScopeFailure("IP", hash("IP", normalizeIp(sourceIp)));
    jdbc.update("DELETE FROM auth_login_failure WHERE updated_at < NOW() - INTERVAL '30 days'");
  }

  @Transactional
  public void clearAccountFailures(String email) {
    jdbc.update(
        "DELETE FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
        hash("ACCOUNT", normalizeEmail(email)));
  }

  private void incrementScopeFailure(String scope, String subjectHash) {
    jdbc.update(
        """
        INSERT INTO auth_login_failure(
            scope, subject_hash, consecutive_failure_count, window_started_at,
            window_failure_count, last_failure_at, cooldown_until, updated_at
        ) VALUES (?, ?, 1, NOW(), 1, NOW(), NULL, NOW())
        ON CONFLICT (scope, subject_hash) DO UPDATE SET
            consecutive_failure_count = CASE
                WHEN auth_login_failure.last_failure_at < NOW() - INTERVAL '24 hours' THEN 1
                ELSE LEAST(auth_login_failure.consecutive_failure_count + 1, ?)
            END,
            window_started_at = CASE
                WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW()
                ELSE auth_login_failure.window_started_at
            END,
            window_failure_count = CASE
                WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                ELSE auth_login_failure.window_failure_count + 1
            END,
            last_failure_at = NOW(),
            cooldown_until = CASE
                WHEN auth_login_failure.scope = 'ACCOUNT'
                  AND auth_login_failure.last_failure_at >= NOW() - INTERVAL '24 hours'
                  AND auth_login_failure.consecutive_failure_count >= ? - 1
                    THEN NOW() + INTERVAL '24 hours'
                WHEN auth_login_failure.scope = 'ACCOUNT'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 20 THEN NOW() + INTERVAL '15 minutes'
                WHEN auth_login_failure.scope = 'ACCOUNT'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 15 THEN NOW() + INTERVAL '5 minutes'
                WHEN auth_login_failure.scope = 'ACCOUNT'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 10 THEN NOW() + INTERVAL '2 minutes'
                WHEN auth_login_failure.scope = 'ACCOUNT'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 5 THEN NOW() + INTERVAL '30 seconds'
                WHEN auth_login_failure.scope = 'IP'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 250 THEN NOW() + INTERVAL '15 minutes'
                WHEN auth_login_failure.scope = 'IP'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 160 THEN NOW() + INTERVAL '5 minutes'
                WHEN auth_login_failure.scope = 'IP'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 100 THEN NOW() + INTERVAL '2 minutes'
                WHEN auth_login_failure.scope = 'IP'
                  AND (CASE
                    WHEN auth_login_failure.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1
                    ELSE auth_login_failure.window_failure_count + 1
                  END) >= 60 THEN NOW() + INTERVAL '30 seconds'
                ELSE NULL
            END,
            updated_at = NOW()
        """,
        scope,
        subjectHash,
        MAX_CONSECUTIVE_FAILURES,
        MAX_CONSECUTIVE_FAILURES);
  }

  private String normalizeEmail(String email) {
    return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
  }

  private String normalizeIp(String sourceIp) {
    return sourceIp == null || sourceIp.isBlank() ? "unknown" : sourceIp.trim();
  }

  private String hash(String scope, String value) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      return HexFormat.of()
          .formatHex(mac.doFinal((scope + ":" + value).getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Unable to hash authentication rate-limit key.", exception);
    }
  }
}
