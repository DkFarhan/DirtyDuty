package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.exception.LoginTemporarilyThrottledException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("ci")
class PasswordLoginProtectionIntegrationTest {
  private static final String TEST_KEY = "local-ci-only-hmac-key-not-for-production";

  @Autowired private PasswordLoginProtectionService protection;
  @Autowired private JdbcTemplate jdbc;

  private final List<String> testAccounts = new ArrayList<>();
  private final List<String> testIps = new ArrayList<>();

  @AfterEach
  void cleanUp() throws Exception {
    for (String email : testAccounts) {
      jdbc.update(
          "DELETE FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
          hash("ACCOUNT", email));
    }
    for (String ip : testIps) {
      jdbc.update(
          "DELETE FROM auth_login_failure WHERE scope = 'IP' AND subject_hash = ?", hash("IP", ip));
    }
    testAccounts.clear();
    testIps.clear();
  }

  @Test
  void persistsOnlyHmacIdentifiersAndAppliesProgressiveAccountCooldowns() throws Exception {
    String email = trackAccount("account-" + UUID.randomUUID() + "@example.com");
    String ip = trackIp("test-ip-" + UUID.randomUUID());
    String accountHash = hash("ACCOUNT", email);
    String ipHash = hash("IP", ip);

    for (int attempt = 0; attempt < 4; attempt++) protection.recordFailure(email, ip);
    protection.assertAllowed(email, ip, "WrongPassword123!");
    protection.recordFailure(email, ip);

    assertThatThrownBy(() -> protection.assertAllowed(email, ip, "WrongPassword123!"))
        .isInstanceOf(LoginTemporarilyThrottledException.class);
    assertThat(cooldownSeconds("ACCOUNT", accountHash)).isBetween(29L, 30L);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_login_failure WHERE subject_hash IN (?, ?)",
                Integer.class,
                email,
                ip))
        .isZero();

    expireCooldown("ACCOUNT", accountHash);
    for (int attempt = 0; attempt < 5; attempt++) {
      expireCooldown("ACCOUNT", accountHash);
      protection.recordFailure(email, ip);
    }
    assertThat(cooldownSeconds("ACCOUNT", accountHash)).isBetween(119L, 120L);

    expireCooldown("ACCOUNT", accountHash);
    jdbc.update(
        "UPDATE auth_login_failure SET window_started_at = NOW() - INTERVAL '16 minutes', cooldown_until = NULL WHERE scope = 'ACCOUNT' AND subject_hash = ?",
        accountHash);
    protection.recordFailure(email, ip);
    assertThat(
            jdbc.queryForObject(
                "SELECT window_failure_count FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
                Integer.class,
                accountHash))
        .isEqualTo(1);
    jdbc.update(
        "UPDATE auth_login_failure SET last_failure_at = NOW() - INTERVAL '25 hours' WHERE scope = 'ACCOUNT' AND subject_hash = ?",
        accountHash);
    protection.recordFailure(email, ip);
    assertThat(
            jdbc.queryForObject(
                "SELECT consecutive_failure_count FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
                Integer.class,
                accountHash))
        .isEqualTo(1);
  }

  @Test
  void escalatesContinuedFailuresAndCapsAtOneHundredConsecutiveFailures() throws Exception {
    String email = trackAccount("escalation-" + UUID.randomUUID() + "@example.com");
    String hash = hash("ACCOUNT", email);
    String ip = trackIp("test-ip-" + UUID.randomUUID());

    for (int attempt = 0; attempt < 15; attempt++) {
      expireCooldown("ACCOUNT", hash);
      protection.recordFailure(email, ip);
    }
    assertThat(cooldownSeconds("ACCOUNT", hash)).isBetween(299L, 300L);

    expireCooldown("ACCOUNT", hash);
    for (int attempt = 15; attempt < 20; attempt++) {
      expireCooldown("ACCOUNT", hash);
      protection.recordFailure(email, ip);
    }
    assertThat(cooldownSeconds("ACCOUNT", hash)).isBetween(899L, 900L);

    jdbc.update(
        """
        UPDATE auth_login_failure
        SET consecutive_failure_count = 99,
            window_failure_count = 20,
            window_started_at = NOW(),
            last_failure_at = NOW(),
            cooldown_until = NULL
        WHERE scope = 'ACCOUNT' AND subject_hash = ?
        """,
        hash);
    protection.recordFailure(email, ip);
    assertThat(
            jdbc.queryForObject(
                "SELECT consecutive_failure_count FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
                Integer.class,
                hash))
        .isEqualTo(100);
    assertThat(cooldownSeconds("ACCOUNT", hash)).isBetween(86_399L, 86_400L);
  }

  @Test
  void appliesIpCooldownAtHighFailureVolumeWithoutLockingIndividualAccounts() throws Exception {
    String ip = trackIp("test-ip-" + UUID.randomUUID());
    for (int attempt = 0; attempt < 59; attempt++) {
      protection.recordFailure(trackAccount("visitor-" + attempt + "@example.com"), ip);
    }

    protection.assertAllowed(trackAccount("another-user@example.com"), ip, "WrongPassword123!");
    protection.recordFailure(trackAccount("last-visitor@example.com"), ip);
    assertThatThrownBy(
            () -> protection.assertAllowed("another-user@example.com", ip, "WrongPassword123!"))
        .isInstanceOf(LoginTemporarilyThrottledException.class);
    assertThat(cooldownSeconds("IP", hash("IP", ip))).isBetween(29L, 30L);
  }

  @Test
  void concurrentFailuresAreAtomicallyCounted() throws Exception {
    String email = trackAccount("concurrent-" + UUID.randomUUID() + "@example.com");
    String ip = trackIp("test-ip-" + UUID.randomUUID());
    String accountHash = hash("ACCOUNT", email);
    int workers = 20;
    var executor = Executors.newFixedThreadPool(workers);
    CountDownLatch ready = new CountDownLatch(workers);
    CountDownLatch start = new CountDownLatch(1);
    List<java.util.concurrent.Future<?>> futures = new ArrayList<>();

    try {
      for (int worker = 0; worker < workers; worker++) {
        futures.add(
            executor.submit(
                () -> {
                  ready.countDown();
                  if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Concurrent test start timed out.");
                  }
                  protection.recordFailure(email, ip);
                  return null;
                }));
      }
      assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      for (var future : futures) future.get(10, TimeUnit.SECONDS);
    } finally {
      executor.shutdownNow();
    }

    assertThat(
            jdbc.queryForObject(
                "SELECT consecutive_failure_count FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
                Integer.class,
                accountHash))
        .isEqualTo(workers);
  }

  @Test
  void successfulAuthenticationCanClearAccountFailures() throws Exception {
    String email = trackAccount("clear-" + UUID.randomUUID() + "@example.com");
    String accountHash = hash("ACCOUNT", email);
    protection.recordFailure(email, trackIp("test-ip-" + UUID.randomUUID()));
    protection.clearAccountFailures(email);

    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_login_failure WHERE scope = 'ACCOUNT' AND subject_hash = ?",
                Integer.class,
                accountHash))
        .isZero();
  }

  private long cooldownSeconds(String scope, String subjectHash) {
    return Math.round(
        jdbc.queryForObject(
            "SELECT EXTRACT(EPOCH FROM cooldown_until - NOW()) FROM auth_login_failure WHERE scope = ? AND subject_hash = ?",
            Double.class,
            scope,
            subjectHash));
  }

  private void expireCooldown(String scope, String subjectHash) {
    jdbc.update(
        "UPDATE auth_login_failure SET cooldown_until = NULL WHERE scope = ? AND subject_hash = ?",
        scope,
        subjectHash);
  }

  private String hash(String scope, String identifier) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(TEST_KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return java.util.HexFormat.of()
        .formatHex(
            mac.doFinal(
                (scope + ":" + identifier.trim().toLowerCase(Locale.ROOT))
                    .getBytes(StandardCharsets.UTF_8)));
  }

  private String trackAccount(String email) {
    testAccounts.add(email);
    return email;
  }

  private String trackIp(String ip) {
    testIps.add(ip);
    return ip;
  }
}
