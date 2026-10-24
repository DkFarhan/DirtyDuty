package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.EmailVerificationInvalidCodeException;
import com.dirtyduty.app.exception.EmailVerificationRateLimitException;
import com.dirtyduty.app.repository.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest(
    properties = {
      "app.auth.email-verification.enabled=true",
      "app.auth.email-verification.delivery-enabled=true",
      "app.auth.password-reset.rate-limit-hmac-secret=local-test-only-hmac-secret-minimum-32",
      "app.base-url=https://dirtyduty.test",
      "spring.mail.host=localhost",
      "spring.mail.username=test-user",
      "spring.mail.password=test-password",
      "MAIL_FROM_ADDRESS=verify@dirtyduty.test"
    })
@ActiveProfiles("ci")
class EmailVerificationIntegrationTest {
  @Autowired private EmailVerificationService verificationService;
  @Autowired private UserRepository users;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private PasswordEncoder passwordEncoder;

  @MockitoBean private EmailVerificationMailer mailer;

  private final List<UUID> testUserIds = new ArrayList<>();
  private final AtomicReference<String> latestCode = new AtomicReference<>();
  private final AtomicInteger ipCounter = new AtomicInteger();

  @BeforeEach
  void captureEmailCode() {
    org.mockito.Mockito.doAnswer(
            invocation -> {
              latestCode.set(invocation.getArgument(1));
              return null;
            })
        .when(mailer)
        .sendVerificationCode(
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
  }

  @AfterEach
  void cleanUp() {
    for (UUID userId : testUserIds) {
      users
          .findById(userId)
          .ifPresent(
              user -> {
                jdbc.update(
                    "DELETE FROM spring_session_attributes WHERE session_primary_id IN (SELECT primary_id FROM spring_session WHERE principal_name = ?)",
                    user.getEmail());
                jdbc.update("DELETE FROM spring_session WHERE principal_name = ?", user.getEmail());
                jdbc.update("DELETE FROM notifications WHERE recipient_user_id = ?", userId);
                jdbc.update("DELETE FROM notification_preferences WHERE user_id = ?", userId);
                jdbc.update("DELETE FROM push_subscriptions WHERE user_id = ?", userId);
                jdbc.update("DELETE FROM external_auth_identity WHERE user_id = ?", userId);
                jdbc.update("DELETE FROM password_reset_token WHERE user_id = ?", userId);
                jdbc.update("DELETE FROM notification_events WHERE actor_user_id = ?", userId);
                jdbc.update("DELETE FROM household_memberships WHERE user_id = ?", userId);
                jdbc.update("DELETE FROM households WHERE created_by_user_id = ?", userId);
                users.delete(user);
              });
    }
    testUserIds.clear();
  }

  @Test
  void issuedCodeIsStoredAsHmacAndOnlyOneConcurrentVerificationCanSucceed() throws Exception {
    User user = createUser("verify");
    assertThat(verificationService.sendInitial(user.getId(), uniqueIp())).isEqualTo("SENT");
    String code = latestCode.get();
    assertThat(code).matches("[0-9]{6}");
    String persistedHash =
        jdbc.queryForObject(
            "SELECT code_hash FROM email_verification WHERE user_id = ?",
            String.class,
            user.getId());
    assertThat(persistedHash).doesNotContain(code).hasSize(64);

    try (var executor = Executors.newFixedThreadPool(8)) {
      List<Future<Boolean>> attempts = new ArrayList<>();
      for (int index = 0; index < 8; index++) {
        String ip = uniqueIp();
        attempts.add(executor.submit(() -> verificationService.verify(user.getEmail(), code, ip)));
      }
      long successes = 0;
      for (Future<Boolean> attempt : attempts) if (attempt.get()) successes++;
      assertThat(successes).isEqualTo(1);
    }

    assertThat(users.findById(user.getId()).orElseThrow().getEmailVerifiedAt()).isNotNull();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM email_verification WHERE user_id = ?",
                Integer.class,
                user.getId()))
        .isZero();
    verify(mailer).sendVerificationCode(user.getEmail(), code);
  }

  @Test
  void resendCooldownAndFiveWrongCodesExpireTheCurrentCode() {
    User user = createUser("attempts");
    verificationService.sendInitial(user.getId(), uniqueIp());
    assertThatThrownBy(() -> verificationService.resend(user.getEmail(), uniqueIp()))
        .isInstanceOf(EmailVerificationRateLimitException.class);

    for (int attempt = 0; attempt < 5; attempt++) {
      String wrongCode = latestCode.get().equals("000000") ? "000001" : "000000";
      assertThat(verificationService.verify(user.getEmail(), wrongCode, uniqueIp())).isFalse();
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT attempt_count FROM email_verification WHERE user_id = ?",
                Integer.class,
                user.getId()))
        .isEqualTo(5);
    assertThat(
            jdbc.queryForObject(
                "SELECT expires_at < NOW() FROM email_verification WHERE user_id = ?",
                Boolean.class,
                user.getId()))
        .isTrue();
    assertThat(verificationService.verify(user.getEmail(), latestCode.get(), uniqueIp())).isFalse();
    verify(mailer, atLeastOnce()).sendVerificationCode(user.getEmail(), latestCode.get());
  }

  @Test
  void recoveryVerifiesMailboxChangesPasswordAndConsumesTheCode() {
    User user = createUser("recovery");
    verificationService.sendInitial(user.getId(), uniqueIp());
    verificationService.completeRecovery(
        user.getEmail(), latestCode.get(), "RecoveredPassword123!", "Recovered User", uniqueIp());

    User recovered = users.findById(user.getId()).orElseThrow();
    assertThat(recovered.getEmailVerifiedAt()).isNotNull();
    assertThat(recovered.getDisplayName()).isEqualTo("Recovered User");
    assertThat(passwordEncoder.matches("RecoveredPassword123!", recovered.getPasswordHash()))
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM email_verification WHERE user_id = ?",
                Integer.class,
                user.getId()))
        .isZero();
  }

  @Test
  void invalidRecoveryCodeDoesNotVerifyTheAccount() {
    User user = createUser("invalid-recovery");
    verificationService.sendInitial(user.getId(), uniqueIp());

    assertThatThrownBy(
            () ->
                verificationService.completeRecovery(
                    user.getEmail(),
                    latestCode.get().equals("000000") ? "000001" : "000000",
                    "RecoveredPassword123!",
                    "Recovered User",
                    uniqueIp()))
        .isInstanceOf(EmailVerificationInvalidCodeException.class);
    assertThat(users.findById(user.getId()).orElseThrow().getEmailVerifiedAt()).isNull();
  }

  @Test
  void recoveryEligibilitySurvivesAnOrdinaryCodeResend() {
    User user = createUser("resend-recovery");
    verificationService.sendInitial(user.getId(), uniqueIp());
    jdbc.update(
        "UPDATE email_verification SET issued_at = NOW() - INTERVAL '2 minutes' WHERE user_id = ?",
        user.getId());

    assertThat(verificationService.resend(user.getEmail(), uniqueIp())).isEqualTo("SENT");
    assertThat(
            jdbc.queryForObject(
                "SELECT reclaimable FROM email_verification WHERE user_id = ?",
                Boolean.class,
                user.getId()))
        .isTrue();

    verificationService.requestRecovery(user.getEmail(), uniqueIp());
    verificationService.completeRecovery(
        user.getEmail(), latestCode.get(), "RecoveredPassword123!", "Recovered User", uniqueIp());
    assertThat(users.findById(user.getId()).orElseThrow().getEmailVerifiedAt()).isNotNull();
  }

  @Test
  void concurrentOverLimitRecoveryRequestsDoNotAddRateEventRows() throws Exception {
    String email = "rate-" + UUID.randomUUID() + "@example.com";
    String ip = uniqueIp();
    int before =
        jdbc.queryForObject("SELECT COUNT(*) FROM email_verification_rate_event", Integer.class);

    try (var executor = Executors.newFixedThreadPool(10)) {
      List<Future<?>> requests = new ArrayList<>();
      for (int index = 0; index < 12; index++) {
        requests.add(executor.submit(() -> verificationService.requestRecovery(email, ip)));
      }
      for (Future<?> request : requests) request.get();
    }

    int inserted =
        jdbc.queryForObject("SELECT COUNT(*) FROM email_verification_rate_event", Integer.class)
            - before;
    assertThat(inserted).isEqualTo(20);
  }

  @Test
  void cleanupDeletesOnlyExpiredDataFreeAbandonedRegistrations() {
    User abandoned = createUser("abandoned");
    verificationService.sendInitial(abandoned.getId(), uniqueIp());
    ageRegistration(abandoned);

    User withSession = createUser("session-retained");
    verificationService.sendInitial(withSession.getId(), uniqueIp());
    ageRegistration(withSession);
    String sessionId = UUID.randomUUID().toString();
    jdbc.update(
        """
        INSERT INTO spring_session(
            primary_id, session_id, creation_time, last_access_time,
            max_inactive_interval, expiry_time, principal_name
        ) VALUES (?, ?, ?, ?, 86400, ?, ?)
        """,
        sessionId,
        sessionId,
        System.currentTimeMillis(),
        System.currentTimeMillis(),
        System.currentTimeMillis() + 86_400_000,
        withSession.getEmail());

    User withHousehold = createUser("household-retained");
    verificationService.sendInitial(withHousehold.getId(), uniqueIp());
    ageRegistration(withHousehold);
    UUID householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households(id, name, timezone, created_by_user_id) VALUES (?, 'Protected', 'UTC', ?)",
        householdId,
        withHousehold.getId());
    jdbc.update(
        """
        INSERT INTO household_memberships(id, household_id, user_id, role, status)
        VALUES (?, ?, ?, 'OWNER', 'ACTIVE')
        """,
        UUID.randomUUID(),
        householdId,
        withHousehold.getId());

    User withNotification = createUser("notification-retained");
    verificationService.sendInitial(withNotification.getId(), uniqueIp());
    ageRegistration(withNotification);
    jdbc.update(
        """
        INSERT INTO notifications(
            recipient_user_id, type, category, title, message, deduplication_key
        ) VALUES (?, 'TEST', 'TEST', 'Protected', 'Protected', ?)
        """,
        withNotification.getId(),
        UUID.randomUUID().toString());

    verificationService.cleanupExpiredCodesAndAbandonedRegistrations();

    assertThat(users.findById(abandoned.getId())).isEmpty();
    assertThat(users.findById(withSession.getId())).isPresent();
    assertThat(users.findById(withHousehold.getId())).isPresent();
    assertThat(users.findById(withNotification.getId())).isPresent();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM spring_session WHERE primary_id = ?",
                Integer.class,
                sessionId))
        .isEqualTo(1);
  }

  private User createUser(String label) {
    User user = new User();
    user.setEmail(label + "-" + UUID.randomUUID() + "@example.com");
    user.setDisplayName("Verification Test");
    user.setPasswordHash(passwordEncoder.encode("OriginalPassword123!"));
    user.setTimezone("UTC");
    user.setAccountStatus(AccountStatus.ACTIVE);
    user.setEmailVerifiedAt(null);
    User saved = users.saveAndFlush(user);
    testUserIds.add(saved.getId());
    return saved;
  }

  private void ageRegistration(User user) {
    jdbc.update(
        "UPDATE users SET created_at = NOW() - INTERVAL '31 days' WHERE id = ?", user.getId());
    jdbc.update(
        "UPDATE email_verification SET expires_at = NOW() - INTERVAL '2 days' WHERE user_id = ?",
        user.getId());
  }

  private String uniqueIp() {
    int thirdOctet = UUID.randomUUID().hashCode() & 0xff;
    int fourthOctet = ipCounter.incrementAndGet() & 0xff;
    return "198.51." + thirdOctet + "." + fourthOctet;
  }
}
