package com.dirtyduty.app.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.service.EmailVerificationService;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import tools.jackson.databind.json.JsonMapper;

class EmailVerificationFilterTest {
  private final EmailVerificationService verification =
      org.mockito.Mockito.mock(EmailVerificationService.class);
  private final EmailVerificationFilter filter =
      new EmailVerificationFilter(verification, JsonMapper.builder().build());

  @AfterEach
  void clearContext() {
    SecurityContextHolder.clearContext();
  }

  @Test
  void blocksBusinessApiRequestsForAuthenticatedUnverifiedUsers() throws Exception {
    when(verification.isVerified("pending@example.com")).thenReturn(false);
    SecurityContextHolder.getContext()
        .setAuthentication(
            UsernamePasswordAuthenticationToken.authenticated(
                "pending@example.com", null, java.util.List.of()));
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/households");
    MockHttpServletResponse response = new MockHttpServletResponse();
    FilterChain chain = org.mockito.Mockito.mock(FilterChain.class);

    filter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(403);
    assertThat(response.getContentAsString()).contains("EMAIL_VERIFICATION_REQUIRED");
    verify(verification).isVerified("pending@example.com");
    verifyNoInteractions(chain);
  }

  @Test
  void keepsSessionAndVerificationRoutesAvailableBeforeVerification() throws Exception {
    SecurityContextHolder.getContext()
        .setAuthentication(
            UsernamePasswordAuthenticationToken.authenticated(
                "pending@example.com", null, java.util.List.of()));
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/auth/me");
    MockHttpServletResponse response = new MockHttpServletResponse();
    FilterChain chain = org.mockito.Mockito.mock(FilterChain.class);

    filter.doFilter(request, response, chain);

    verify(chain).doFilter(request, response);
    verifyNoInteractions(verification);
  }
}
