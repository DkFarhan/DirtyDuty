package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(
    properties = {
      "app.auth.password-reset.enabled=true",
      "app.auth.password-reset.rate-limit-hmac-secret=local-test-only-hmac-secret-minimum-32",
      "app.auth.password-reset.request-email-limit=3",
      "app.auth.password-reset.request-ip-limit=5",
      "app.auth.password-reset.confirm-ip-limit=10",
      "app.base-url=https://dirtyduty.test",
      "spring.mail.host=localhost",
      "spring.mail.username=test-user",
      "spring.mail.password=test-password",
      "MAIL_FROM_ADDRESS=reset@dirtyduty.test",
      "MAIL_STARTTLS_ENABLED=true",
      "MAIL_STARTTLS_REQUIRED=true",
      "MAIL_TLS_VERIFY_SERVER_IDENTITY=true"
    })
@ActiveProfiles("ci")
@AutoConfigureMockMvc
class AuthenticationCompletionIntegrationTest {
  private final List<User> testUsers = new ArrayList<>();

  @Autowired private PasswordResetService passwordResetService;

  @Autowired private GoogleIdentityService googleIdentityService;

  @Autowired private UserRepository userRepository;

  @Autowired private JdbcTemplate jdbc;

  @Autowired private PasswordEncoder passwordEncoder;

  @Autowired private AuthService authService;

  @Autowired private MockMvc mockMvc;

  @Autowired private JavaMailSenderImpl mailSender;

  private final ObjectMapper objectMapper = new ObjectMapper();

  @MockitoBean private PasswordResetMailer mailer;

  @AfterEach
  void cleanUp() {
    for (User user : testUsers) {
      userRepository.findById(user.getId()).ifPresent(userRepository::delete);
      jdbc.update("DELETE FROM spring_session WHERE principal_name = ?", user.getEmail());
    }
    testUsers.clear();
  }

  @Test
  void resetTokensAreHashedSingleUseAndInvalidateExistingSessions() throws Exception {
    User user = createUser("reset");
    String token = issueResetToken(user);
    String tokenHash =
        HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));

    assertThat(
            jdbc.queryForObject(
                "SELECT token_hash FROM password_reset_token WHERE user_id = ?",
                String.class,
                user.getId()))
        .isEqualTo(tokenHash)
        .isNotEqualTo(token);

    String sessionId = UUID.randomUUID().toString();
    long now = System.currentTimeMillis();
    jdbc.update(
        """
        INSERT INTO spring_session(
            primary_id, session_id, creation_time, last_access_time,
            max_inactive_interval, expiry_time, principal_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        sessionId,
        sessionId,
        now,
        now,
        3600,
        now + 3_600_000,
        user.getEmail());
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM spring_session WHERE principal_name = ?",
                Integer.class,
                user.getEmail()))
        .isEqualTo(1);

    String sourceIp = uniqueTestIp();
    assertThat(passwordResetService.confirm(token, "NewStrongPassword123!", sourceIp)).isTrue();
    assertThat(
            passwordEncoder.matches(
                "NewStrongPassword123!",
                userRepository.findById(user.getId()).orElseThrow().getPasswordHash()))
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM spring_session WHERE principal_name = ?",
                Integer.class,
                user.getEmail()))
        .isZero();
    assertThat(passwordResetService.confirm(token, "AnotherStrongPassword123!", sourceIp))
        .isFalse();
  }

  @Test
  void resetTokenExpirationIsEnforced() {
    User user = createUser("expired");
    String token = issueResetToken(user);
    jdbc.update(
        """
        UPDATE password_reset_token
        SET created_at = NOW() - INTERVAL '2 hours',
            expires_at = NOW() - INTERVAL '1 hour'
        WHERE user_id = ?
        """,
        user.getId());

    assertThat(passwordResetService.confirm(token, "NewStrongPassword123!", uniqueTestIp()))
        .isFalse();
  }

  @Test
  void resetRequestsHaveGenericResponsesAndPersistentEmailRateLimits() {
    User user = createUser("limited");
    String generic = passwordResetService.request("missing@example.com", uniqueTestIp());
    String sourceIp = uniqueTestIp();
    assertThat(passwordResetService.request(user.getEmail(), sourceIp)).isEqualTo(generic);
    assertThat(passwordResetService.request(user.getEmail(), sourceIp)).isEqualTo(generic);
    assertThat(passwordResetService.request(user.getEmail(), sourceIp)).isEqualTo(generic);
    assertThat(passwordResetService.request(user.getEmail(), sourceIp)).isEqualTo(generic);

    verify(mailer, org.mockito.Mockito.timeout(2000).times(3))
        .sendReset(eq(user.getEmail()), any(String.class), any(Duration.class));
  }

  @Test
  void resetInvalidatesExistingSessionAndOnlyTheNewPasswordCanSignIn() throws Exception {
    User user = createUser("session-reset");
    Cookie sessionA = login(user.getEmail(), "OldStrongPassword123!");
    String token = issueResetToken(user);

    MvcResult resetCsrf = csrf(sessionA);
    mockMvc
        .perform(
            post("/api/auth/password-reset/confirm")
                .cookie(sessionA)
                .header("X-CSRF-TOKEN", readCsrf(resetCsrf).token())
                .contentType(APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        java.util.Map.of("token", token, "newPassword", "NewStrongPassword123!"))))
        .andExpect(status().isOk());

    mockMvc.perform(get("/api/auth/me").cookie(sessionA)).andExpect(status().isUnauthorized());

    String oldPasswordResponse = attemptLogin(user.getEmail(), "OldStrongPassword123!");
    assertThat(oldPasswordResponse).contains("Invalid email or password");
    Cookie newSession = login(user.getEmail(), "NewStrongPassword123!");
    mockMvc
        .perform(get("/api/auth/me").cookie(newSession))
        .andExpect(status().isOk())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                    "$.hasPassword")
                .value(true));
  }

  @Test
  void googleOnlyUserCanSetFirstPasswordWithoutLosingGoogleIdentity() throws Exception {
    var identity =
        googleIdentityService.authenticateVerifiedIdentity(
            "google-reset-" + UUID.randomUUID(),
            "google-reset-" + UUID.randomUUID() + "@example.com",
            "Google Reset User",
            true);
    User user = identity.user();
    testUsers.add(user);
    assertThat(user.getPasswordHash()).isNull();

    String token = issueResetToken(user);
    assertThat(passwordResetService.confirm(token, "NewStrongPassword123!", uniqueTestIp()))
        .isTrue();
    assertThat(googleIdentityService.hasGoogleIdentity(user.getId())).isTrue();

    Cookie session = login(user.getEmail(), "NewStrongPassword123!");
    MvcResult me =
        mockMvc
            .perform(get("/api/auth/me").cookie(session))
            .andExpect(status().isOk())
            .andExpect(
                org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.hasPassword")
                    .value(true))
            .andReturn();
    assertThat(me.getResponse().getContentAsString())
        .contains("\"authProviders\":[\"PASSWORD\",\"GOOGLE\"]");
    var repeated =
        googleIdentityService.authenticateVerifiedIdentity(
            jdbc.queryForObject(
                "SELECT provider_subject FROM external_auth_identity WHERE user_id = ?",
                String.class,
                user.getId()),
            user.getEmail(),
            "Google Reset User",
            true);
    assertThat(repeated.user().getId()).isEqualTo(user.getId());
  }

  @Test
  void deletingGoogleOnlyAccountRequiresRecentReauthenticationAndRemovesAuthArtifacts() {
    var identity =
        googleIdentityService.authenticateVerifiedIdentity(
            "google-delete-" + UUID.randomUUID(),
            "google-delete-" + UUID.randomUUID() + "@example.com",
            "Google Delete User",
            true);
    User user = identity.user();
    testUsers.add(user);
    issueResetToken(user);

    assertThatThrownBy(
            () -> authService.deleteAccount(user.getEmail(), null, user.getEmail(), false))
        .isInstanceOf(com.dirtyduty.app.exception.InvalidCredentialsException.class)
        .hasMessageContaining("Recent Google reauthentication");
    authService.deleteAccount(user.getEmail(), null, user.getEmail(), true);

    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM external_auth_identity WHERE user_id = ?",
                Integer.class,
                user.getId()))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM password_reset_token WHERE user_id = ?",
                Integer.class,
                user.getId()))
        .isZero();
    assertThat(userRepository.findById(user.getId()).orElseThrow().getAccountStatus())
        .isEqualTo(AccountStatus.DELETED);
  }

  @Test
  void javaMailSenderRequiresStartTlsAndHostnameVerification() {
    assertThat(mailSender.getJavaMailProperties().getProperty("mail.smtp.starttls.enable"))
        .isEqualTo("true");
    assertThat(mailSender.getJavaMailProperties().getProperty("mail.smtp.starttls.required"))
        .isEqualTo("true");
    assertThat(mailSender.getJavaMailProperties().getProperty("mail.smtp.ssl.checkserveridentity"))
        .isEqualTo("true");
  }

  @Test
  void googleIdentityRequiresVerifiedEmailAndUsesStableSubjectMapping() {
    assertThatThrownBy(
            () ->
                googleIdentityService.authenticateVerifiedIdentity(
                    "google-subject-unverified", "unverified@example.com", "Unverified", false))
        .isInstanceOf(BadCredentialsException.class);

    var first =
        googleIdentityService.authenticateVerifiedIdentity(
            "google-subject-" + UUID.randomUUID(),
            "google-" + UUID.randomUUID() + "@example.com",
            "Google User",
            true);
    testUsers.add(first.user());
    assertThat(first.user().getPasswordHash()).isNull();
    assertThat(googleIdentityService.hasGoogleIdentity(first.user().getId())).isTrue();
    var repeated =
        googleIdentityService.authenticateVerifiedIdentity(
            jdbc.queryForObject(
                "SELECT provider_subject FROM external_auth_identity WHERE user_id = ?",
                String.class,
                first.user().getId()),
            first.user().getEmail(),
            "Changed Name",
            true);
    assertThat(repeated.user().getId()).isEqualTo(first.user().getId());
  }

  @Test
  void googleIdentityRequiresExplicitPasswordAccountLinkingForExistingEmail() {
    User user = createUser("link");
    var result =
        googleIdentityService.authenticateVerifiedIdentity(
            "google-link-" + UUID.randomUUID(), user.getEmail(), "Linked User", true);

    assertThat(result.type()).isEqualTo(GoogleIdentityService.ResultType.LINK_REQUIRED);
    assertThat(googleIdentityService.hasGoogleIdentity(user.getId())).isFalse();
    googleIdentityService.linkToPasswordAccount(
        "google-link-linked-" + UUID.randomUUID(), user.getEmail());
    assertThat(googleIdentityService.hasGoogleIdentity(user.getId())).isTrue();
  }

  private User createUser(String prefix) {
    User user = new User();
    user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
    user.setDisplayName("Test User");
    user.setPasswordHash(passwordEncoder.encode("OldStrongPassword123!"));
    user.setTimezone("UTC");
    user.setAccountStatus(AccountStatus.ACTIVE);
    testUsers.add(userRepository.saveAndFlush(user));
    return testUsers.get(testUsers.size() - 1);
  }

  private String issueResetToken(User user) {
    passwordResetService.request(user.getEmail(), uniqueTestIp());
    var token = org.mockito.ArgumentCaptor.forClass(String.class);
    verify(mailer, org.mockito.Mockito.timeout(2000))
        .sendReset(eq(user.getEmail()), token.capture(), any(Duration.class));
    return token.getValue();
  }

  private Cookie login(String email, String password) throws Exception {
    MvcResult csrf = csrf(null);
    MvcResult result =
        mockMvc
            .perform(
                post("/api/auth/login")
                    .cookie(csrf.getResponse().getCookie("SESSION"))
                    .header("X-CSRF-TOKEN", readCsrf(csrf).token())
                    .contentType(APPLICATION_JSON)
                    .content(
                        objectMapper.writeValueAsString(
                            java.util.Map.of("email", email, "password", password))))
            .andExpect(status().isOk())
            .andReturn();
    return result.getResponse().getCookie("SESSION");
  }

  private String attemptLogin(String email, String password) throws Exception {
    MvcResult csrf = csrf(null);
    MvcResult result =
        mockMvc
            .perform(
                post("/api/auth/login")
                    .cookie(csrf.getResponse().getCookie("SESSION"))
                    .header("X-CSRF-TOKEN", readCsrf(csrf).token())
                    .contentType(APPLICATION_JSON)
                    .content(
                        objectMapper.writeValueAsString(
                            java.util.Map.of("email", email, "password", password))))
            .andExpect(status().isUnauthorized())
            .andReturn();
    return result.getResponse().getContentAsString();
  }

  private MvcResult csrf(Cookie session) throws Exception {
    var request = get("/api/auth/csrf");
    if (session != null) request.cookie(session);
    return mockMvc.perform(request).andExpect(status().isOk()).andReturn();
  }

  private CsrfResponse readCsrf(MvcResult result) throws Exception {
    return objectMapper.readValue(result.getResponse().getContentAsString(), CsrfResponse.class);
  }

  private String uniqueTestIp() {
    int first = UUID.randomUUID().hashCode() & 0xff;
    int second = UUID.randomUUID().hashCode() & 0xff;
    return "198.51." + first + "." + second;
  }
}
