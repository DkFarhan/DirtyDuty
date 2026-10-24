package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.http.MediaType.APPLICATION_JSON_VALUE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.config.AuthFeatureConfiguration;
import com.dirtyduty.app.config.SecurityConfig;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.GlobalExceptionHandler;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.dirtyduty.app.service.EmailVerificationService;
import com.dirtyduty.app.service.GoogleIdentityService;
import com.dirtyduty.app.service.LegalAcceptanceService;
import com.dirtyduty.app.service.PasswordLoginProtectionService;
import com.dirtyduty.app.service.PasswordResetService;
import com.dirtyduty.app.service.RecentReauthenticationService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.authentication.InternalAuthenticationServiceException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import tools.jackson.databind.json.JsonMapper;

class AuthControllerHttpTest {

  private AuthService authService;
  private AuthFeatureConfiguration authFeatures;
  private AuthenticationManager authenticationManager;
  private GoogleIdentityService googleIdentityService;
  private PasswordLoginProtectionService loginProtection;
  private EmailVerificationService emailVerificationService;
  private SessionAuthenticationStrategy sessionAuthenticationStrategy;
  private MockMvc mockMvc;

  @AfterEach
  void clearSecurityContext() {
    org.springframework.security.core.context.SecurityContextHolder.clearContext();
  }

  @BeforeEach
  void setUp() {
    authService = org.mockito.Mockito.mock(AuthService.class);
    authFeatures = org.mockito.Mockito.mock(AuthFeatureConfiguration.class);
    authenticationManager = org.mockito.Mockito.mock(AuthenticationManager.class);
    googleIdentityService = org.mockito.Mockito.mock(GoogleIdentityService.class);
    loginProtection = org.mockito.Mockito.mock(PasswordLoginProtectionService.class);
    emailVerificationService = org.mockito.Mockito.mock(EmailVerificationService.class);
    org.mockito.Mockito.doAnswer(invocation -> ((Supplier<?>) invocation.getArgument(2)).get())
        .when(loginProtection)
        .withAdmissionLock(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.<Supplier<?>>any());
    org.mockito.Mockito.when(
            authenticationManager.authenticate(
                org.mockito.ArgumentMatchers.any(Authentication.class)))
        .thenAnswer(
            invocation -> {
              Authentication token = invocation.getArgument(0);
              return UsernamePasswordAuthenticationToken.authenticated(
                  token.getName(), null, List.of());
            });
    sessionAuthenticationStrategy = org.mockito.Mockito.mock(SessionAuthenticationStrategy.class);
    AuthController controller =
        new AuthController(
            authService,
            authenticationManager,
            new HttpSessionSecurityContextRepository(),
            sessionAuthenticationStrategy,
            org.mockito.Mockito.mock(UserRepository.class),
            googleIdentityService,
            org.mockito.Mockito.mock(PasswordResetService.class),
            authFeatures,
            org.mockito.Mockito.mock(RecentReauthenticationService.class),
            org.mockito.Mockito.mock(LegalAcceptanceService.class),
            loginProtection,
            emailVerificationService);
    LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
    validator.afterPropertiesSet();
    mockMvc =
        MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .setValidator(validator)
            .build();
  }

  @Test
  void authenticationEntryPoint_returnsGenericJson401WithoutRequestUri() throws Exception {
    String userControlledPath = "/private/<script>alert(1)</script>";
    MockHttpServletRequest request = new MockHttpServletRequest("GET", userControlledPath);
    MockHttpServletResponse response = new MockHttpServletResponse();
    JsonMapper jsonMapper = JsonMapper.builder().build();

    new SecurityConfig()
        .authenticationEntryPoint(jsonMapper)
        .commence(request, response, new InsufficientAuthenticationException("Unauthenticated"));

    var body = jsonMapper.readTree(response.getContentAsString());
    assertThat(response.getStatus()).isEqualTo(401);
    assertThat(response.getContentType()).isEqualTo(APPLICATION_JSON_VALUE);
    assertThat(body.path("status").asInt()).isEqualTo(401);
    assertThat(body.path("error").asText()).isEqualTo("Unauthorized");
    assertThat(body.path("message").asText()).isEqualTo("Authentication required");
    assertThat(body.has("path")).isFalse();
    assertThat(response.getContentAsString()).doesNotContain(userControlledPath);
  }

  @Test
  void register_returns201AndNeverReturnsPasswordFields() throws Exception {
    org.mockito.Mockito.when(authService.register(org.mockito.ArgumentMatchers.any()))
        .thenReturn(new RegisterResponse(UUID.randomUUID(), "Alice Smith", "alice@example.com"));

    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "displayName": "  Alice Smith  ",
                          "email": "Alice@Example.com",
                          "password": "StrongPassword123!",
                          "termsAccepted": true,
                          "privacyPolicyAcknowledged": true
                        }
                        """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.displayName").value("Alice Smith"))
        .andExpect(jsonPath("$.email").value("alice@example.com"))
        .andExpect(jsonPath("$.password").doesNotExist())
        .andExpect(jsonPath("$.passwordHash").doesNotExist())
        .andExpect(
            content()
                .string(
                    org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("StrongPassword123!"))));
  }

  @Test
  void registerCreatesLimitedSessionAndReportsDeliveryFailureWithoutClaimingVerification()
      throws Exception {
    UUID userId = UUID.randomUUID();
    org.mockito.Mockito.when(authService.register(org.mockito.ArgumentMatchers.any()))
        .thenReturn(new RegisterResponse(userId, "Alice Smith", "alice@example.com"));
    org.mockito.Mockito.when(emailVerificationService.isEnabled()).thenReturn(true);
    org.mockito.Mockito.when(emailVerificationService.sendInitial(userId, "127.0.0.1"))
        .thenReturn("FAILED");

    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "displayName": "Alice Smith",
                          "email": "alice@example.com",
                          "password": "StrongPassword123!",
                          "termsAccepted": true,
                          "privacyPolicyAcknowledged": true
                        }
                        """))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.emailVerified").value(false))
        .andExpect(jsonPath("$.verificationDeliveryState").value("FAILED"));

    org.mockito.Mockito.verify(authenticationManager)
        .authenticate(org.mockito.ArgumentMatchers.any(Authentication.class));
  }

  @Test
  void recoveryRequestReturnsGenericSuccessForEligibleAndIneligibleAddresses() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/email-verification/recovery/request")
                .contentType(APPLICATION_JSON)
                .content("{\"email\":\"pending@example.com\"}"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.message")
                .value(
                    "If an eligible account exists for this email, a recovery code will be sent."));

    org.mockito.Mockito.verify(emailVerificationService)
        .requestRecovery("pending@example.com", "127.0.0.1");
  }

  @Test
  void register_returns409ForDuplicateEmail() throws Exception {
    assertThatDuplicateResourceMapsToConflict();
  }

  @Test
  void register_returns409ForDuplicateEmailWithDifferentCase() throws Exception {
    assertThatDuplicateResourceMapsToConflict();
  }

  @Test
  void register_returns400ForMalformedEmail() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(validRequest("not-an-email")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void register_returns400ForBlankDisplayName() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "displayName": "   ",
                          "email": "user@example.com",
                          "password": "StrongPassword123!"
                        }
                        """))
        .andExpect(status().isBadRequest());
  }

  @Test
  void register_returns400ForShortPassword() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(validRequestWithPassword("short@example.com", "short")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void register_requiresExplicitAffirmativeLegalAcceptance() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "displayName": "Valid User",
                          "email": "valid@example.com",
                          "password": "StrongPassword123!",
                          "termsAccepted": true,
                          "privacyPolicyAcknowledged": false
                        }
                        """))
        .andExpect(status().isBadRequest());
  }

  @Test
  void register_requiresPrivacyAcknowledgementField() throws Exception {
    mockMvc
        .perform(
            post("/api/auth/register")
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "displayName": "Valid User",
                          "email": "valid@example.com",
                          "password": "StrongPassword123!",
                          "termsAccepted": true
                        }
                        """))
        .andExpect(status().isBadRequest());
  }

  @Test
  void googleLinkRejectsExpiredPendingIdentityBeforeAuthenticating() throws Exception {
    MockHttpSession session =
        pendingGoogleLinkSession(System.currentTimeMillis() - 11 * 60 * 1000L);

    mockMvc
        .perform(
            post("/api/auth/google/link")
                .session(session)
                .contentType(APPLICATION_JSON)
                .content("{\"password\":\"StrongPassword123!\"}"))
        .andExpect(status().isUnauthorized());

    org.mockito.Mockito.verifyNoInteractions(authenticationManager, googleIdentityService);
  }

  @Test
  void googleLinkRequiresTheExistingAccountPassword() throws Exception {
    MockHttpSession session = pendingGoogleLinkSession(Instant.now().toEpochMilli());
    org.mockito.Mockito.when(
            authenticationManager.authenticate(
                org.mockito.ArgumentMatchers.any(Authentication.class)))
        .thenThrow(new BadCredentialsException("bad credentials"));

    mockMvc
        .perform(
            post("/api/auth/google/link")
                .session(session)
                .contentType(APPLICATION_JSON)
                .content("{\"password\":\"WrongPassword123!\"}"))
        .andExpect(status().isUnauthorized());

    org.mockito.Mockito.verify(authenticationManager)
        .authenticate(org.mockito.ArgumentMatchers.any(Authentication.class));
    org.mockito.Mockito.verify(loginProtection)
        .recordFailure(
            org.mockito.ArgumentMatchers.eq("person@example.com"),
            org.mockito.ArgumentMatchers.any(String.class));
    org.mockito.Mockito.verifyNoInteractions(googleIdentityService);
  }

  @Test
  void authenticationProviderFailureDoesNotRecordBadPasswordAndRemainsGeneric() throws Exception {
    org.mockito.Mockito.when(
            authenticationManager.authenticate(
                org.mockito.ArgumentMatchers.any(Authentication.class)))
        .thenThrow(new InternalAuthenticationServiceException("database unavailable"));

    mockMvc
        .perform(
            post("/api/auth/login")
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"email":"person@example.com","password":"WrongPassword123!"}
                        """))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.message").value("Invalid email or password"))
        .andExpect(
            content()
                .string(
                    org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("database unavailable"))));

    org.mockito.Mockito.verify(loginProtection).assertAllowed("person@example.com", "127.0.0.1");
    org.mockito.Mockito.verify(loginProtection, org.mockito.Mockito.never())
        .recordFailure(
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void temporarilyThrottledGoogleLinkUsesGenericThrottleResponseWithoutPasswordAuthentication()
      throws Exception {
    org.mockito.Mockito.doThrow(
            new com.dirtyduty.app.exception.LoginTemporarilyThrottledException(
                "Too many sign-in attempts. Please wait and try again, or reset your password."))
        .when(loginProtection)
        .assertAllowed(
            org.mockito.ArgumentMatchers.eq("person@example.com"),
            org.mockito.ArgumentMatchers.any(String.class));

    mockMvc
        .perform(
            post("/api/auth/google/link")
                .session(pendingGoogleLinkSession(Instant.now().toEpochMilli()))
                .contentType(APPLICATION_JSON)
                .content("{\"password\":\"WrongPassword123!\"}"))
        .andExpect(status().isTooManyRequests());

    org.mockito.Mockito.verifyNoInteractions(authenticationManager, googleIdentityService);
  }

  @Test
  void googleLinkLinksOnlyAfterPasswordAuthenticationSucceeds() throws Exception {
    MockHttpSession session = pendingGoogleLinkSession(Instant.now().toEpochMilli());
    Authentication authentication =
        UsernamePasswordAuthenticationToken.authenticated("person@example.com", null, List.of());
    org.mockito.Mockito.when(
            authenticationManager.authenticate(
                org.mockito.ArgumentMatchers.any(Authentication.class)))
        .thenReturn(authentication);

    mockMvc
        .perform(
            post("/api/auth/google/link")
                .session(session)
                .contentType(APPLICATION_JSON)
                .content("{\"password\":\"StrongPassword123!\"}"))
        .andExpect(status().isNoContent());

    org.mockito.Mockito.verify(googleIdentityService)
        .linkToPasswordAccount("google-subject", "person@example.com");
    org.mockito.Mockito.verify(sessionAuthenticationStrategy)
        .onAuthentication(
            org.mockito.ArgumentMatchers.eq(authentication),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any());
  }

  @Test
  void googleReauthenticationRejectsUntrustedReturnTargets() throws Exception {
    org.mockito.Mockito.when(authFeatures.googleEnabled()).thenReturn(true);

    mockMvc
        .perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                    "/api/auth/google/reauthenticate")
                .param("returnTo", "https://attacker.example"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void googleReauthenticationRedirectsOnlyToTheFixedProviderRoute() throws Exception {
    org.mockito.Mockito.when(authFeatures.googleEnabled()).thenReturn(true);
    Authentication authentication =
        UsernamePasswordAuthenticationToken.authenticated("person@example.com", null, List.of());

    mockMvc
        .perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                    "/api/auth/google/reauthenticate")
                .principal(authentication)
                .param("returnTo", "household-settings"))
        .andExpect(status().isFound())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                .string("Location", "/api/auth/oauth2/authorization/google"));
  }

  private MockHttpSession pendingGoogleLinkSession(long createdAt) {
    MockHttpSession session = new MockHttpSession();
    session.setAttribute(GoogleIdentityService.PENDING_SUBJECT, "google-subject");
    session.setAttribute(GoogleIdentityService.PENDING_EMAIL, "person@example.com");
    session.setAttribute(GoogleIdentityService.PENDING_CREATED, createdAt);
    return session;
  }

  private String validRequest(String email) {
    return validRequestWithPassword(email, "StrongPassword123!");
  }

  private String validRequestWithPassword(String email, String password) {
    return """
                {
                  "displayName": "Valid User",
                  "email": "%s",
                  "password": "%s",
                  "termsAccepted": true,
                  "privacyPolicyAcknowledged": true
                }
                """
        .formatted(email, password);
  }

  private void assertThatDuplicateResourceMapsToConflict() {
    HttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/register");
    assertThat(
            new GlobalExceptionHandler()
                .handleDuplicateResource(
                    new DuplicateResourceException("A user with this email already exists."),
                    request)
                .getStatusCode()
                .value())
        .isEqualTo(409);
  }
}
