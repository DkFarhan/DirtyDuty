package com.dirtyduty.app.service;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PersistentAuthRateLimiter {
  private final JdbcTemplate jdbc;
  private final byte[] secret;

  public PersistentAuthRateLimiter(
      JdbcTemplate jdbc,
      @Value("${app.auth.password-reset.rate-limit-hmac-secret:}") String secret) {
    this.jdbc = jdbc;
    this.secret = secret.getBytes(StandardCharsets.UTF_8);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public boolean allow(String scope, String identifier, int limit, Duration window) {
    String key = hash(identifier);
    long seconds = window.toSeconds();
    long start = Instant.now().getEpochSecond() / seconds * seconds;
    List<Integer> counts =
        jdbc.query(
            """
            INSERT INTO auth_rate_limit_bucket(scope, subject_hash, window_start, request_count)
            VALUES (?, ?, ?, 1)
            ON CONFLICT (scope, subject_hash, window_start)
            DO UPDATE SET request_count = auth_rate_limit_bucket.request_count + 1,
                          updated_at = NOW()
            WHERE auth_rate_limit_bucket.request_count <= ?
            RETURNING request_count
            """,
            (resultSet, rowNumber) -> resultSet.getInt("request_count"),
            scope,
            key,
            start,
            limit);
    jdbc.update("DELETE FROM auth_rate_limit_bucket WHERE updated_at < NOW() - INTERVAL '2 days'");
    return !counts.isEmpty() && counts.get(0) <= limit;
  }

  private String hash(String value) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Unable to hash authentication rate-limit key.", exception);
    }
  }
}
