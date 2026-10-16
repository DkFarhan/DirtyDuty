package com.dirtyduty.app.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.config.AuthFeatureConfiguration;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.service.GoogleIdentityService;
import com.dirtyduty.app.service.GoogleIdentityService.Result;
import com.dirtyduty.app.service.GoogleIdentityService.ResultType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.context.SecurityContextRepository;

class GoogleAuthenticationSuccessHandlerTest {
  @Test
  void normalGoogleLoginDoesNotCountAsRecentReauthentication() throws Exception {
    MockHttpSession session = new MockHttpSession();
    invokeSuccess(session, false);

    assertThat(session.getAttribute(GoogleIdentityService.REAUTHENTICATION_TIME)).isNull();
  }

  @Test
  void explicitGoogleReauthenticationSetsSingleSessionProof() throws Exception {
    MockHttpSession session = new MockHttpSession();
    session.setAttribute(GoogleIdentityService.OAUTH_INTENT, true);
    session.setAttribute(GoogleIdentityService.PENDING_EMAIL, "person@example.com");
    session.setAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN, "privacy-security");

    invokeSuccess(session, true);

    assertThat(session.getAttribute(GoogleIdentityService.REAUTHENTICATION_TIME))
        .isInstanceOf(Long.class);
    assertThat(session.getAttribute(GoogleIdentityService.OAUTH_INTENT)).isNull();
    assertThat(session.getAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN)).isNull();
  }

  private void invokeSuccess(MockHttpSession session, boolean reauthentication) throws Exception {
    GoogleIdentityService identities = mock(GoogleIdentityService.class);
    UserDetailsService userDetailsService = mock(UserDetailsService.class);
    SecurityContextRepository contextRepository = mock(SecurityContextRepository.class);
    AuthFeatureConfiguration configuration = mock(AuthFeatureConfiguration.class);
    when(configuration.appBaseUrl()).thenReturn("https://dirtyduty.test");

    User user = new User();
    user.setEmail("person@example.com");
    when(identities.authenticateVerifiedIdentity(
            "google-subject", "person@example.com", "Person", true))
        .thenReturn(new Result(ResultType.AUTHENTICATED, user));
    UserDetails details =
        org.springframework.security.core.userdetails.User.withUsername("person@example.com")
            .password("")
            .authorities(List.of())
            .build();
    when(userDetailsService.loadUserByUsername("person@example.com")).thenReturn(details);

    OidcUser oidcUser = mock(OidcUser.class);
    when(oidcUser.getSubject()).thenReturn("google-subject");
    when(oidcUser.getEmail()).thenReturn("person@example.com");
    when(oidcUser.getClaim("email_verified")).thenReturn(true);
    when(oidcUser.getFullName()).thenReturn("Person");
    Authentication authentication = mock(Authentication.class);
    when(authentication.getPrincipal()).thenReturn(oidcUser);

    GoogleAuthenticationSuccessHandler handler =
        new GoogleAuthenticationSuccessHandler(
            identities, userDetailsService, contextRepository, configuration);
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setSession(session);
    MockHttpServletResponse response = new MockHttpServletResponse();

    handler.onAuthenticationSuccess(request, response, authentication);

    assertThat(response.getRedirectedUrl())
        .isEqualTo(
            reauthentication
                ? "https://dirtyduty.test/?auth=google-reauthenticated&screen=privacy-security"
                : "https://dirtyduty.test/?auth=google-success");
    verify(contextRepository)
        .saveContext(any(), any(HttpServletRequest.class), any(HttpServletResponse.class));
  }
}
