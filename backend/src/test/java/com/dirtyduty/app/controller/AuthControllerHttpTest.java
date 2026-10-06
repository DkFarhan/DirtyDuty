package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.http.MediaType.APPLICATION_JSON_VALUE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.config.SecurityConfig;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.GlobalExceptionHandler;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import tools.jackson.databind.json.JsonMapper;

class AuthControllerHttpTest {

  private AuthService authService;
  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    authService = org.mockito.Mockito.mock(AuthService.class);
    AuthController controller =
        new AuthController(
            authService,
            org.mockito.Mockito.mock(AuthenticationManager.class),
            new HttpSessionSecurityContextRepository(),
            org.mockito.Mockito.mock(SessionAuthenticationStrategy.class),
            org.mockito.Mockito.mock(UserRepository.class));
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
                          "password": "StrongPassword123!"
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

  private String validRequest(String email) {
    return validRequestWithPassword(email, "StrongPassword123!");
  }

  private String validRequestWithPassword(String email, String password) {
    return """
                {
                  "displayName": "Valid User",
                  "email": "%s",
                  "password": "%s"
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
