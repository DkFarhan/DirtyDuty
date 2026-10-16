package com.dirtyduty.app.security;

import com.dirtyduty.app.config.AuthFeatureConfiguration;
import com.dirtyduty.app.service.GoogleIdentityService;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

@Component
public class GoogleAuthenticationFailureHandler implements AuthenticationFailureHandler {
  private final AuthFeatureConfiguration configuration;

  public GoogleAuthenticationFailureHandler(AuthFeatureConfiguration configuration) {
    this.configuration = configuration;
  }

  @Override
  public void onAuthenticationFailure(
      HttpServletRequest request, HttpServletResponse response, AuthenticationException exception)
      throws IOException, ServletException {
    var session = request.getSession(false);
    String returnTo =
        session == null
            ? null
            : (String) session.getAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN);
    if (session != null) {
      session.removeAttribute(GoogleIdentityService.OAUTH_INTENT);
      session.removeAttribute(GoogleIdentityService.PENDING_SUBJECT);
      session.removeAttribute(GoogleIdentityService.PENDING_EMAIL);
      session.removeAttribute(GoogleIdentityService.PENDING_CREATED);
      session.removeAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN);
    }
    response.sendRedirect(
        configuration.appBaseUrl()
            + "/?auth=google-error"
            + (isReauthReturnScreen(returnTo) ? "&screen=" + returnTo : ""));
  }

  private boolean isReauthReturnScreen(String screen) {
    return "privacy-security".equals(screen) || "household-settings".equals(screen);
  }
}
