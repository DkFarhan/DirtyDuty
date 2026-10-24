package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.config.SecurityConfig;
import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.dirtyduty.app.service.GoogleIdentityService;
import com.dirtyduty.app.service.LegalDocumentVersions;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class AuthSessionIntegrationTest {

  private final List<String> testEmails = new ArrayList<>();
  private final List<UUID> testUserIds = new ArrayList<>();

  @Autowired private MockMvc mockMvc;

  @Autowired private AuthService authService;

  @Autowired private GoogleIdentityService googleIdentityService;

  @Autowired private UserRepository userRepository;

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Autowired private JdbcTemplate jdbcTemplate;

  @Autowired private SessionAuthenticationStrategy sessionAuthenticationStrategy;

  @Value("${app.security.session-cookie-secure:true}")
  private boolean sessionCookieSecure;

  @AfterEach
  void cleanUpTestOwnedSessionsAndUsers() {
    for (String email : testEmails) {
      jdbcTemplate.update(
          """
                    DELETE FROM spring_session_attributes
                    WHERE session_primary_id IN (
                        SELECT primary_id FROM spring_session WHERE principal_name = ?
                    )
                    """,
          email);
      jdbcTemplate.update("DELETE FROM spring_session WHERE principal_name = ?", email);
    }
    for (UUID userId : testUserIds) {
      userRepository.findById(userId).ifPresent(userRepository::delete);
    }
    testEmails.clear();
    testUserIds.clear();
  }

  @Test
  void csrfEndpointReturnsSessionBackedToken() throws Exception {
    mockMvc
        .perform(get("/api/auth/csrf"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.token").isString())
        .andExpect(jsonPath("$.headerName").value("X-CSRF-TOKEN"));
  }

  @Test
  void providerDiscoveryIsAvailableBeforeAuthentication() throws Exception {
    mockMvc
        .perform(get("/api/auth/providers"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.google").isBoolean())
        .andExpect(jsonPath("$.passwordReset").isBoolean());
  }

  @Test
  void validLoginCreatesArgonAuthenticatedSessionAndReturnsSafeResponse() throws Exception {
    String email = uniqueEmail("valid");
    register(email, AccountStatus.ACTIVE);

    MvcResult csrf = csrf();
    MvcResult login = performLogin(email, "StrongPassword123!", csrf);

    assertThat(login.getResponse().getStatus()).isEqualTo(200);
    assertThat(login.getResponse().getContentAsString())
        .doesNotContain("password", "passwordHash", "session", "accessToken");
    assertThat(csrf.getResponse().getCookie("SESSION")).isNotNull();
    assertThat(csrf.getResponse().getCookie("SESSION").isHttpOnly()).isTrue();
    assertThat(csrf.getResponse().getHeader("Set-Cookie")).containsIgnoringCase("SameSite=Lax");
    Cookie loginCookie = login.getResponse().getCookie("SESSION");
    assertThat(loginCookie).isNotNull();
    assertThat(loginCookie.getMaxAge()).isEqualTo((int) Duration.ofDays(365).toSeconds());
    assertThat(loginCookie.isHttpOnly()).isTrue();
    assertThat(loginCookie.getSecure()).isEqualTo(sessionCookieSecure);
    assertThat(loginCookie.getPath()).isEqualTo("/");
    assertThat(login.getResponse().getHeader("Set-Cookie")).containsIgnoringCase("SameSite=Lax");
    String[] cookieAttributes = login.getResponse().getHeader("Set-Cookie").split(";");
    assertThat(
            Arrays.stream(cookieAttributes)
                .map(String::trim)
                .anyMatch(attribute -> attribute.equalsIgnoreCase("Secure")))
        .isEqualTo(sessionCookieSecure);
    mockMvc
        .perform(get("/api/auth/me").cookie(loginCookie))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.email").value(email))
        .andExpect(jsonPath("$.emailVerified").value(false))
        .andExpect(jsonPath("$.passwordHash").doesNotExist())
        .andExpect(jsonPath("$.legalAcceptanceRequired").value(false));

    Integer persistedSessions =
        jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM spring_session WHERE principal_name = ?", Integer.class, email);
    assertThat(persistedSessions).isGreaterThanOrEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT max_inactive_interval FROM spring_session WHERE principal_name = ?",
                Integer.class,
                email))
        .isEqualTo((int) Duration.ofDays(30).toSeconds());
  }

  @Test
  void failedPasswordAttemptsArePersistedGenericallyAndEventuallyThrottledForKnownAndUnknownEmails()
      throws Exception {
    String email = uniqueEmail("throttled");
    register(email, AccountStatus.ACTIVE);
    String unknownEmail = "missing-" + UUID.randomUUID() + "@example.com";
    MvcResult knownFailure = null;
    MvcResult unknownFailure = null;
    for (int attempt = 0; attempt < 5; attempt++) {
      knownFailure = performLogin(email, "WrongPassword123!", csrf());
      unknownFailure = performLogin(unknownEmail, "WrongPassword123!", csrf());
    }
    assertThat(knownFailure.getResponse().getStatus()).isEqualTo(401);
    assertThat(unknownFailure.getResponse().getStatus()).isEqualTo(401);
    assertThat(knownFailure.getResponse().getContentAsString())
        .contains("Invalid email or password");
    assertThat(unknownFailure.getResponse().getContentAsString())
        .contains("Invalid email or password");

    knownFailure = performLogin(email, "WrongPassword123!", csrf());
    unknownFailure = performLogin(unknownEmail, "WrongPassword123!", csrf());
    assertThat(knownFailure.getResponse().getStatus()).isEqualTo(429);
    assertThat(unknownFailure.getResponse().getStatus()).isEqualTo(429);
    assertThat(knownFailure.getResponse().getContentAsString())
        .contains("Too many sign-in attempts")
        .doesNotContain(email, unknownEmail);
    assertThat(unknownFailure.getResponse().getContentAsString())
        .contains("Too many sign-in attempts")
        .doesNotContain(email, unknownEmail);
  }

  @Test
  void successfulPasswordLoginResetsConsecutiveFailureCounter() throws Exception {
    String email = uniqueEmail("counter-reset");
    register(email, AccountStatus.ACTIVE);
    for (int attempt = 0; attempt < 4; attempt++) {
      assertThat(performLogin(email, "WrongPassword123!", csrf()).getResponse().getStatus())
          .isEqualTo(401);
    }
    assertThat(performLogin(email, "StrongPassword123!", csrf()).getResponse().getStatus())
        .isEqualTo(200);

    for (int attempt = 0; attempt < 5; attempt++) {
      assertThat(performLogin(email, "WrongPassword123!", csrf()).getResponse().getStatus())
          .isEqualTo(401);
    }
    assertThat(performLogin(email, "WrongPassword123!", csrf()).getResponse().getStatus())
        .isEqualTo(429);
  }

  @Test
  void normalAuthenticatedAccessSlidesServerSessionExpiry() throws Exception {
    String email = uniqueEmail("sliding-session");
    register(email, AccountStatus.ACTIVE);
    Cookie loginCookie =
        performLogin(email, "StrongPassword123!", csrf()).getResponse().getCookie("SESSION");

    long staleLastAccess = System.currentTimeMillis() - Duration.ofMinutes(5).toMillis();
    long staleExpiry = staleLastAccess + Duration.ofDays(30).toMillis();
    jdbcTemplate.update(
        "UPDATE spring_session SET last_access_time=?, expiry_time=? WHERE principal_name=?",
        staleLastAccess,
        staleExpiry,
        email);

    mockMvc.perform(get("/api/auth/me").cookie(loginCookie)).andExpect(status().isOk());

    Long refreshedLastAccess =
        jdbcTemplate.queryForObject(
            "SELECT last_access_time FROM spring_session WHERE principal_name=?",
            Long.class,
            email);
    Long refreshedExpiry =
        jdbcTemplate.queryForObject(
            "SELECT expiry_time FROM spring_session WHERE principal_name=?", Long.class, email);
    assertThat(refreshedLastAccess).isGreaterThan(staleLastAccess);
    assertThat(refreshedExpiry).isGreaterThan(staleExpiry);
  }

  @Test
  void localSessionCookieOverrideRemainsInsecureAndPersistent() {
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpServletResponse response = new MockHttpServletResponse();
    CookieSerializer serializer =
        new SecurityConfig().cookieSerializer(false, Duration.ofDays(365));
    serializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, "session-id"));

    String setCookie = response.getHeader("Set-Cookie");
    assertThat(setCookie)
        .contains("SESSION=", "Max-Age=31536000", "Path=/", "HttpOnly", "SameSite=Lax")
        .doesNotContain("Secure");
  }

  @Test
  void legacyUserMustAcceptCurrentDocumentsBeforeUsingBusinessApis() throws Exception {
    String email = uniqueEmail("legacy-legal");
    register(email, AccountStatus.ACTIVE);
    User legacyUser = userRepository.findByEmailIgnoreCase(email).orElseThrow();
    legacyUser.setTermsAcceptedVersion(null);
    legacyUser.setPrivacyPolicyAcceptedVersion(null);
    legacyUser.setLegalAcceptedAt(null);
    userRepository.saveAndFlush(legacyUser);

    MvcResult login = performLogin(email, "StrongPassword123!", csrf());
    Cookie session = login.getResponse().getCookie("SESSION");
    mockMvc
        .perform(get("/api/auth/me").cookie(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.legalAcceptanceRequired").value(true));
    mockMvc.perform(get("/api/auth/csrf").cookie(session)).andExpect(status().isOk());
    mockMvc
        .perform(get("/api/households").cookie(session))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("LEGAL_ACCEPTANCE_REQUIRED"));
    mockMvc
        .perform(post("/api/auth/legal-acceptance").cookie(session))
        .andExpect(status().isForbidden());

    CsrfResponse token = readCsrf(csrfWithCookie(session));
    mockMvc
        .perform(
            post("/api/auth/legal-acceptance")
                .cookie(session)
                .header(token.headerName(), token.token())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"termsAccepted":true}
                        """))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            post("/api/auth/legal-acceptance")
                .cookie(session)
                .header(token.headerName(), token.token())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"termsAccepted":true,"privacyPolicyAcknowledged":false}
                        """))
        .andExpect(status().isBadRequest());

    mockMvc
        .perform(
            post("/api/auth/legal-acceptance")
                .cookie(session)
                .header(token.headerName(), token.token())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"termsAccepted":true,"privacyPolicyAcknowledged":true}
                        """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.termsVersion").value(LegalDocumentVersions.TERMS))
        .andExpect(jsonPath("$.privacyPolicyVersion").value(LegalDocumentVersions.PRIVACY_POLICY))
        .andExpect(jsonPath("$.acceptedAt").isString());

    User acceptedUser = userRepository.findByEmailIgnoreCase(email).orElseThrow();
    assertThat(acceptedUser.getLegalAcceptedAt()).isNotNull();
    assertThat(acceptedUser.getTermsAcceptedVersion()).isEqualTo(LegalDocumentVersions.TERMS);
    assertThat(acceptedUser.getPrivacyPolicyAcceptedVersion())
        .isEqualTo(LegalDocumentVersions.PRIVACY_POLICY);
    mockMvc.perform(get("/api/households").cookie(session)).andExpect(status().isOk());
  }

  @Test
  void googleCreatedUserHasToAcceptDocumentsAndMeReportsRequirement() throws Exception {
    String email = uniqueEmail("google-legal");
    User user =
        googleIdentityService
            .authenticateVerifiedIdentity(
                "google-subject-" + UUID.randomUUID(), email, "Google User", true)
            .user();
    testUserIds.add(user.getId());

    assertThat(user.getLegalAcceptedAt()).isNull();
    mockMvc
        .perform(get("/api/auth/me").with(user(email)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.legalAcceptanceRequired").value(true));
    mockMvc
        .perform(get("/api/households").with(user(email)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("LEGAL_ACCEPTANCE_REQUIRED"));
  }

  @Test
  void existingGoogleLinkedUserCannotSkipAcceptance() throws Exception {
    String email = uniqueEmail("google-existing");
    register(email, AccountStatus.ACTIVE);
    User existingUser = userRepository.findByEmailIgnoreCase(email).orElseThrow();
    existingUser.setTermsAcceptedVersion(null);
    existingUser.setPrivacyPolicyAcceptedVersion(null);
    existingUser.setLegalAcceptedAt(null);
    userRepository.saveAndFlush(existingUser);

    googleIdentityService.linkToPasswordAccount("google-existing-subject", email);
    GoogleIdentityService.Result googleLogin =
        googleIdentityService.authenticateVerifiedIdentity(
            "google-existing-subject", email, "Test User", true);
    assertThat(googleLogin.type()).isEqualTo(GoogleIdentityService.ResultType.AUTHENTICATED);
    mockMvc
        .perform(get("/api/auth/me").with(user(email)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.legalAcceptanceRequired").value(true));
    mockMvc
        .perform(get("/api/households").with(user(email)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("LEGAL_ACCEPTANCE_REQUIRED"));
  }

  @Test
  void v11AddsNullableLegalAcceptanceFieldsToUsers() {
    Integer nullableColumns =
        jdbcTemplate.queryForObject(
            """
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'users'
              AND is_nullable = 'YES'
              AND column_name IN (
                'terms_accepted_version',
                'privacy_policy_accepted_version',
                'legal_accepted_at'
              )
            """,
            Integer.class);
    assertThat(nullableColumns).isEqualTo(3);
  }

  @Test
  void loginUsesSessionFixationProtectionStrategy() throws Exception {
    String email = uniqueEmail("fixation");
    register(email, AccountStatus.ACTIVE);
    MvcResult csrf = csrf();
    Cookie preLoginCookie = csrf.getResponse().getCookie("SESSION");
    MvcResult login = performLogin(email, "StrongPassword123!", csrf);
    Cookie postLoginCookie = login.getResponse().getCookie("SESSION");

    assertThat(sessionAuthenticationStrategy)
        .isInstanceOf(ChangeSessionIdAuthenticationStrategy.class);
    assertThat(preLoginCookie).isNotNull();
    assertThat(postLoginCookie).isNotNull();
    assertThat(postLoginCookie.getValue()).isNotEqualTo(preLoginCookie.getValue());
    mockMvc
        .perform(get("/api/auth/me").cookie(preLoginCookie))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void loginRequiresCsrfAndAcceptsTheCsrfTokenFromTheEndpoint() throws Exception {
    String email = uniqueEmail("csrf");
    register(email, AccountStatus.ACTIVE);

    mockMvc
        .perform(
            post("/api/auth/login")
                .contentType(APPLICATION_JSON)
                .content(loginJson(email, "StrongPassword123!")))
        .andExpect(status().isForbidden());

    MvcResult csrf = csrf();
    performLogin(email, "StrongPassword123!", csrf);
  }

  @Test
  void csrfTokenRemainsUsableAfterLoginButLogoutRequiresFreshSessionTokenAfterward()
      throws Exception {
    String email = uniqueEmail("csrf-lifecycle");
    register(email, AccountStatus.ACTIVE);

    MvcResult csrfBeforeLogin = csrf();
    CsrfResponse beforeLogin = readCsrf(csrfBeforeLogin);
    MvcResult login = performLogin(email, "StrongPassword123!", csrfBeforeLogin);
    Cookie authenticatedCookie = login.getResponse().getCookie("SESSION");

    CsrfResponse afterLogin = readCsrf(csrfWithCookie(authenticatedCookie));
    assertThat(afterLogin.token()).isNotEqualTo(beforeLogin.token());

    mockMvc
        .perform(
            post("/api/auth/logout")
                .cookie(authenticatedCookie)
                .header(afterLogin.headerName(), afterLogin.token()))
        .andExpect(status().isNoContent());

    CsrfResponse afterLogout = readCsrf(csrfWithCookie(authenticatedCookie));
    assertThat(afterLogout.token()).isNotEqualTo(afterLogin.token());
  }

  @Test
  void wrongAndUnknownCredentialsHaveTheSame401Response() throws Exception {
    String email = uniqueEmail("known");
    register(email, AccountStatus.ACTIVE);

    MvcResult wrongPassword = performLogin(email, "WrongPassword123!", csrf());
    MvcResult unknownEmail = performLogin(uniqueEmail("unknown"), "WrongPassword123!", csrf());

    assertThat(wrongPassword.getResponse().getStatus()).isEqualTo(401);
    assertThat(unknownEmail.getResponse().getStatus()).isEqualTo(401);
    assertThat(wrongPassword.getResponse().getContentAsString())
        .contains("Invalid email or password")
        .doesNotContain("User not found", "disabled", "deleted");
    assertThat(unknownEmail.getResponse().getContentAsString())
        .contains("Invalid email or password")
        .doesNotContain("User not found", "disabled", "deleted");
    assertThat(wrongPassword.getResponse().getContentAsString())
        .contains("\"status\":401", "\"error\":\"Unauthorized\"");
    assertThat(unknownEmail.getResponse().getContentAsString())
        .contains("\"status\":401", "\"error\":\"Unauthorized\"");
  }

  @Test
  void disabledAndDeletedUsersCannotLogin() throws Exception {
    String disabledEmail = uniqueEmail("disabled");
    register(disabledEmail, AccountStatus.DISABLED);
    String deletedEmail = uniqueEmail("deleted");
    register(deletedEmail, AccountStatus.DELETED);

    MvcResult disabledLogin = performLogin(disabledEmail, "StrongPassword123!", csrf());
    MvcResult deletedLogin = performLogin(deletedEmail, "StrongPassword123!", csrf());

    assertThat(disabledLogin.getResponse().getStatus()).isEqualTo(401);
    assertThat(deletedLogin.getResponse().getStatus()).isEqualTo(401);
    assertThat(disabledLogin.getResponse().getContentAsString())
        .contains("Invalid email or password")
        .doesNotContain("disabled", "deleted", "User not found");
    assertThat(deletedLogin.getResponse().getContentAsString())
        .contains("Invalid email or password")
        .doesNotContain("disabled", "deleted", "User not found");
  }

  @Test
  void passwordChangeRequiresCurrentPasswordAndInvalidatesAllSessions() throws Exception {
    String email = uniqueEmail("password-change");
    register(email, AccountStatus.ACTIVE);
    MvcResult initialLogin = performLogin(email, "StrongPassword123!", csrf());
    Cookie loginCookie = initialLogin.getResponse().getCookie("SESSION");
    Cookie secondLoginCookie =
        performLogin(email, "StrongPassword123!", csrf()).getResponse().getCookie("SESSION");
    String originalHash =
        userRepository.findByEmailIgnoreCase(email).orElseThrow().getPasswordHash();
    MvcResult csrfResult = csrfWithCookie(loginCookie);
    CsrfResponse csrfResponse = readCsrf(csrfResult);

    mockMvc
        .perform(
            post("/api/auth/change-password")
                .cookie(loginCookie)
                .contentType(APPLICATION_JSON)
                .header(csrfResponse.headerName(), csrfResponse.token())
                .content(
                    "{\"currentPassword\":\"StrongPassword123!\",\"newPassword\":\"NewPassword456!\"}"))
        .andExpect(status().isNoContent());

    mockMvc.perform(get("/api/auth/me").cookie(loginCookie)).andExpect(status().isUnauthorized());
    mockMvc
        .perform(get("/api/auth/me").cookie(secondLoginCookie))
        .andExpect(status().isUnauthorized());
    String changedHash =
        userRepository.findByEmailIgnoreCase(email).orElseThrow().getPasswordHash();
    assertThat(changedHash).startsWith("{argon2}").isNotEqualTo(originalHash);

    MvcResult newLogin = performLogin(email, "NewPassword456!", csrf());
    assertThat(newLogin.getResponse().getStatus()).isEqualTo(200);
    assertThat(performLogin(email, "StrongPassword123!", csrf()).getResponse().getStatus())
        .isEqualTo(401);
  }

  @Test
  void deleteAccountRequiresPasswordAndConfirmationThenTombstonesTheUser() throws Exception {
    String email = uniqueEmail("delete-account");
    register(email, AccountStatus.ACTIVE);
    UUID userId = userRepository.findByEmailIgnoreCase(email).orElseThrow().getId();

    MvcResult login = performLogin(email, "StrongPassword123!", csrf());
    Cookie loginCookie = login.getResponse().getCookie("SESSION");
    MvcResult csrfResult = csrfWithCookie(loginCookie);
    CsrfResponse csrfResponse = readCsrf(csrfResult);

    mockMvc
        .perform(
            post("/api/auth/delete-account")
                .cookie(loginCookie)
                .contentType(APPLICATION_JSON)
                .header(csrfResponse.headerName(), csrfResponse.token())
                .content("{\"password\":\"StrongPassword123!\",\"email\":\"" + email + "\"}"))
        .andExpect(status().isNoContent());

    mockMvc.perform(get("/api/auth/me").cookie(loginCookie)).andExpect(status().isUnauthorized());

    User user = userRepository.findById(userId).orElse(null);
    assertThat(user).isNotNull();
    assertThat(user.getAccountStatus()).isEqualTo(AccountStatus.DELETED);
    assertThat(user.getEmail()).startsWith("deleted-");
    assertThat(user.getDisplayName()).isEqualTo("Deleted User");
    assertThat(user.getAvatarUrl()).isNull();
    assertThat(user.getEmailVerifiedAt()).isNull();
    assertThat(user.getPasswordHash()).isNotEqualTo("StrongPassword123!");
    MvcResult oldPasswordLogin = performLogin(email, "StrongPassword123!", csrf());
    assertThat(oldPasswordLogin.getResponse().getStatus()).isEqualTo(401);
  }

  @Test
  void changePasswordRejectsWrongWeakAndUnchangedPasswords() throws Exception {
    String email = uniqueEmail("password-validation");
    register(email, AccountStatus.ACTIVE);
    MvcResult login = performLogin(email, "StrongPassword123!", csrf());
    Cookie cookie = login.getResponse().getCookie("SESSION");

    assertPasswordChangeStatus(cookie, "WrongPassword123!", "DifferentPassword456!", 400);
    assertPasswordChangeStatus(cookie, "StrongPassword123!", "short", 400);
    assertPasswordChangeStatus(cookie, "StrongPassword123!", "StrongPassword123!", 400);

    User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();
    assertThat(user.getPasswordHash()).startsWith("{argon2}");
    assertThat(user.getPasswordHash()).isNotEqualTo("StrongPassword123!");
  }

  @Test
  void passwordAndAccountRoutesRequireAuthenticationAndCsrf() throws Exception {
    for (String path : List.of("/api/auth/change-password", "/api/auth/delete-account")) {
      mockMvc
          .perform(post(path).contentType(APPLICATION_JSON).content("{}"))
          .andExpect(status().isForbidden());

      MvcResult csrf = csrf();
      CsrfResponse token = readCsrf(csrf);
      mockMvc
          .perform(
              post(path)
                  .cookie(csrf.getResponse().getCookie("SESSION"))
                  .contentType(APPLICATION_JSON)
                  .header(token.headerName(), token.token())
                  .content("{}"))
          .andExpect(status().isUnauthorized());
    }
  }

  @Test
  void authenticatedPasswordAndAccountMutationsRejectMissingCsrf() throws Exception {
    for (String path : List.of("/api/auth/change-password", "/api/auth/delete-account")) {
      String email = uniqueEmail("mutation-csrf");
      register(email, AccountStatus.ACTIVE);
      MvcResult login = performLogin(email, "StrongPassword123!", csrf());

      mockMvc
          .perform(
              post(path)
                  .cookie(login.getResponse().getCookie("SESSION"))
                  .contentType(APPLICATION_JSON)
                  .content("{}"))
          .andExpect(status().isForbidden());
    }
  }

  @Test
  void logoutRequiresCsrfInvalidatesSessionAndExpiresCookie() throws Exception {
    String email = uniqueEmail("logout");
    register(email, AccountStatus.ACTIVE);
    MvcResult login = performLogin(email, "StrongPassword123!", csrf());
    Cookie loginCookie = login.getResponse().getCookie("SESSION");
    MvcResult csrf = csrfWithCookie(loginCookie);
    CsrfResponse csrfResponse = readCsrf(csrf);

    mockMvc
        .perform(
            post("/api/auth/logout")
                .cookie(loginCookie)
                .header(csrfResponse.headerName(), csrfResponse.token()))
        .andExpect(status().isNoContent())
        .andExpect(
            header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));

    mockMvc.perform(get("/api/auth/me").cookie(loginCookie)).andExpect(status().isUnauthorized());
  }

  @Test
  void logoutWithoutCsrfTokenIsRejected() throws Exception {
    String email = uniqueEmail("logout-csrf");
    register(email, AccountStatus.ACTIVE);
    MvcResult login = performLogin(email, "StrongPassword123!", csrf());

    mockMvc
        .perform(post("/api/auth/logout").cookie(login.getResponse().getCookie("SESSION")))
        .andExpect(status().isForbidden());
  }

  @Test
  void corsAllowsOnlyConfiguredFrontendOriginWithCredentials() throws Exception {
    mockMvc
        .perform(
            options("/api/auth/login")
                .header("Origin", "http://localhost:3000")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type,x-csrf-token"))
        .andExpect(status().isOk())
        .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:3000"))
        .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
  }

  private void register(String email, AccountStatus status) {
    RegisterResponse response =
        authService.register(new RegisterRequest("Test User", email, "StrongPassword123!"));
    testUserIds.add(response.userId());
    if (status != AccountStatus.ACTIVE) {
      User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();
      user.setAccountStatus(status);
      userRepository.saveAndFlush(user);
    }
  }

  private MvcResult csrf() throws Exception {
    return mockMvc.perform(get("/api/auth/csrf")).andReturn();
  }

  private MvcResult csrfWithCookie(Cookie sessionCookie) throws Exception {
    return mockMvc.perform(get("/api/auth/csrf").cookie(sessionCookie)).andReturn();
  }

  private MvcResult performLogin(String email, String password, MvcResult csrf) throws Exception {
    CsrfResponse csrfResponse = readCsrf(csrf);
    return mockMvc
        .perform(
            post("/api/auth/login")
                .cookie(csrf.getResponse().getCookie("SESSION"))
                .contentType(APPLICATION_JSON)
                .header(csrfResponse.headerName(), csrfResponse.token())
                .content(loginJson(email, password)))
        .andReturn();
  }

  private void assertPasswordChangeStatus(
      Cookie cookie, String currentPassword, String newPassword, int expectedStatus)
      throws Exception {
    MvcResult csrf = csrfWithCookie(cookie);
    CsrfResponse token = readCsrf(csrf);
    mockMvc
        .perform(
            post("/api/auth/change-password")
                .cookie(cookie)
                .contentType(APPLICATION_JSON)
                .header(token.headerName(), token.token())
                .content(
                    "{\"currentPassword\":\""
                        + currentPassword
                        + "\",\"newPassword\":\""
                        + newPassword
                        + "\"}"))
        .andExpect(status().is(expectedStatus));
  }

  private CsrfResponse readCsrf(MvcResult result) throws Exception {
    return objectMapper.readValue(result.getResponse().getContentAsString(), CsrfResponse.class);
  }

  private String loginJson(String email, String password) {
    return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
  }

  private String uniqueEmail(String prefix) {
    String email = prefix + "-" + UUID.randomUUID() + "@example.com";
    testEmails.add(email);
    return email;
  }
}
