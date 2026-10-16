package com.dirtyduty.app.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.config.AuthFeatureConfiguration;
import com.dirtyduty.app.service.GoogleIdentityService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.BadCredentialsException;

class GoogleAuthenticationFailureHandlerTest {
  @Test
  void failureRedirectUsesOnlyAnAllowlistedReauthenticationScreen() throws Exception {
    AuthFeatureConfiguration configuration =
        org.mockito.Mockito.mock(AuthFeatureConfiguration.class);
    when(configuration.appBaseUrl()).thenReturn("https://dirtyduty.test");
    GoogleAuthenticationFailureHandler handler =
        new GoogleAuthenticationFailureHandler(configuration);
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockHttpSession session = new MockHttpSession();
    session.setAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN, "javascript:alert(1)");
    session.setAttribute(GoogleIdentityService.OAUTH_INTENT, true);
    request.setSession(session);

    handler.onAuthenticationFailure(
        request, response, new BadCredentialsException("authentication failed"));

    assertThat(response.getRedirectedUrl()).isEqualTo("https://dirtyduty.test/?auth=google-error");
    assertThat(session.getAttribute(GoogleIdentityService.OAUTH_INTENT)).isNull();
    assertThat(session.getAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN)).isNull();
  }

  @Test
  void failureRedirectPreservesValidReauthenticationScreen() throws Exception {
    AuthFeatureConfiguration configuration =
        org.mockito.Mockito.mock(AuthFeatureConfiguration.class);
    when(configuration.appBaseUrl()).thenReturn("https://dirtyduty.test");
    GoogleAuthenticationFailureHandler handler =
        new GoogleAuthenticationFailureHandler(configuration);
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockHttpSession session = new MockHttpSession();
    session.setAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN, "privacy-security");
    request.setSession(session);

    handler.onAuthenticationFailure(
        request, response, new BadCredentialsException("authentication failed"));

    assertThat(response.getRedirectedUrl())
        .isEqualTo("https://dirtyduty.test/?auth=google-error&screen=privacy-security");
  }
}
