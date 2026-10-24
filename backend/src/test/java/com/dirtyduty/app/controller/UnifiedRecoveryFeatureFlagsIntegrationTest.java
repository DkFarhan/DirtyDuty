package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.dirtyduty.app.service.EmailVerificationMailer;
import com.dirtyduty.app.service.EmailVerificationService;
import com.dirtyduty.app.service.PasswordResetMailer;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(
    properties = {
      "app.auth.email-verification.enabled=true",
      "app.auth.email-verification.delivery-enabled=true",
      "app.auth.password-reset.enabled=false",
      "app.auth.password-reset.rate-limit-hmac-secret=local-test-only-hmac-secret-minimum-32",
      "app.base-url=https://dirtyduty.test",
      "spring.mail.host=localhost",
      "spring.mail.username=test-user",
      "spring.mail.password=test-only-password",
      "MAIL_FROM_ADDRESS=verify@dirtyduty.test"
    })
@ActiveProfiles("ci")
@AutoConfigureMockMvc
class UnifiedRecoveryFeatureFlagsIntegrationTest {
  private static final String GENERIC_MESSAGE =
      "If your account is eligible for recovery, we'll send instructions to your email.";

  private final List<UUID> testUserIds = new ArrayList<>();
  private final List<String> testEmails = new ArrayList<>();

  @Autowired private MockMvc mockMvc;
  @Autowired private AuthService authService;
  @Autowired private EmailVerificationService emailVerificationService;
  @Autowired private UserRepository userRepository;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper objectMapper;

  @MockitoBean private EmailVerificationMailer emailVerificationMailer;
  @MockitoBean private PasswordResetMailer passwordResetMailer;

  @AfterEach
  void cleanUp() {
    for (String email : testEmails) {
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
    for (UUID id : testUserIds) {
      userRepository.findById(id).ifPresent(userRepository::delete);
    }
  }

  @Test
  void pendingRecoveryWorksWhileVerifiedPasswordResetRemainsDisabled() throws Exception {
    RegisterResponse verified = register("verified");
    User verifiedUser = userRepository.findById(verified.userId()).orElseThrow();
    verifiedUser.setEmailVerifiedAt(java.time.OffsetDateTime.now());
    userRepository.saveAndFlush(verifiedUser);

    MvcResult initialCsrf = csrf();
    Cookie session = initialCsrf.getResponse().getCookie("SESSION");
    CsrfResponse token = readCsrf(initialCsrf);
    mockMvc
        .perform(
            post("/api/auth/password-reset/request")
                .cookie(session)
                .contentType(APPLICATION_JSON)
                .header(token.headerName(), token.token())
                .content("{\"email\":\"" + verified.email() + "\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.message").value(GENERIC_MESSAGE));
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM password_reset_token WHERE user_id = ?",
                Integer.class,
                verified.userId()))
        .isZero();

    RegisterResponse pending = register("pending");
    emailVerificationService.sendReservedInitial(pending.userId());
    org.mockito.ArgumentCaptor<String> code = org.mockito.ArgumentCaptor.forClass(String.class);
    org.mockito.Mockito.verify(emailVerificationMailer)
        .sendVerificationCode(org.mockito.ArgumentMatchers.eq(pending.email()), code.capture());

    token = readCsrf(csrfWithCookie(session));
    mockMvc
        .perform(
            post("/api/auth/password-reset/request")
                .cookie(session)
                .contentType(APPLICATION_JSON)
                .header(token.headerName(), token.token())
                .content("{\"email\":\"" + pending.email() + "\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.message").value(GENERIC_MESSAGE));

    token = readCsrf(csrfWithCookie(session));
    mockMvc
        .perform(
            post("/api/auth/email-verification/recovery/complete")
                .cookie(session)
                .contentType(APPLICATION_JSON)
                .header(token.headerName(), token.token())
                .content(
                    objectMapper.writeValueAsString(
                        Map.of(
                            "email", pending.email(),
                            "code", code.getValue(),
                            "newPassword", "RecoveredPassword123!"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.emailVerified").value(true));

    User recovered = userRepository.findById(pending.userId()).orElseThrow();
    assertThat(recovered.getDisplayName()).isEqualTo(pending.displayName());
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM password_reset_token WHERE user_id = ?",
                Integer.class,
                pending.userId()))
        .isZero();
    org.mockito.Mockito.verify(emailVerificationMailer)
        .sendVerificationCode(
            org.mockito.ArgumentMatchers.eq(pending.email()),
            org.mockito.ArgumentMatchers.eq(code.getValue()));
    org.mockito.Mockito.verifyNoInteractions(passwordResetMailer);
  }

  private RegisterResponse register(String label) {
    RegisterResponse registered =
        authService.register(
            new RegisterRequest(
                "Recovery " + label,
                label + "-" + UUID.randomUUID() + "@example.com",
                "StrongPassword123!"));
    testUserIds.add(registered.userId());
    testEmails.add(registered.email());
    return registered;
  }

  private MvcResult csrf() throws Exception {
    return mockMvc.perform(get("/api/auth/csrf")).andReturn();
  }

  private MvcResult csrfWithCookie(Cookie cookie) throws Exception {
    return mockMvc.perform(get("/api/auth/csrf").cookie(cookie)).andReturn();
  }

  private CsrfResponse readCsrf(MvcResult result) throws Exception {
    return objectMapper.readValue(result.getResponse().getContentAsString(), CsrfResponse.class);
  }
}
