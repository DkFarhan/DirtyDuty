package com.dirtyduty.app.security;

import com.dirtyduty.app.config.AuthFeatureConfiguration;
import com.dirtyduty.app.service.GoogleIdentityService;
import com.dirtyduty.app.service.GoogleIdentityService.Result;
import com.dirtyduty.app.service.GoogleIdentityService.ResultType;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Component;

@Component
public class GoogleAuthenticationSuccessHandler implements AuthenticationSuccessHandler {
  private final GoogleIdentityService identities;
  private final UserDetailsService userDetailsService;
  private final SecurityContextRepository contextRepository;
  private final AuthFeatureConfiguration configuration;

  public GoogleAuthenticationSuccessHandler(
      GoogleIdentityService identities,
      UserDetailsService userDetailsService,
      SecurityContextRepository contextRepository,
      AuthFeatureConfiguration configuration) {
    this.identities = identities;
    this.userDetailsService = userDetailsService;
    this.contextRepository = contextRepository;
    this.configuration = configuration;
  }

  @Override
  public void onAuthenticationSuccess(
      HttpServletRequest request, HttpServletResponse response, Authentication authentication)
      throws IOException, ServletException {
    try {
      if (!(authentication.getPrincipal() instanceof OidcUser oidcUser)) {
        throw new BadCredentialsException("Google authentication could not be completed.");
      }
      String subject = oidcUser.getSubject();
      String email = oidcUser.getEmail();
      boolean emailVerified = Boolean.TRUE.equals(oidcUser.getClaim("email_verified"));
      var session = request.getSession(true);
      boolean reauthentication =
          Boolean.TRUE.equals(session.getAttribute(GoogleIdentityService.OAUTH_INTENT));
      String expectedEmail = (String) session.getAttribute(GoogleIdentityService.PENDING_EMAIL);

      Result result =
          identities.authenticateVerifiedIdentity(
              subject, email, oidcUser.getFullName(), emailVerified);
      if (reauthentication) {
        if (result.type() != ResultType.AUTHENTICATED
            || expectedEmail == null
            || !result.user().getEmail().equalsIgnoreCase(expectedEmail)) {
          throw new BadCredentialsException("Google reauthentication could not be completed.");
        }
        session.setAttribute(
            GoogleIdentityService.REAUTHENTICATION_TIME, Instant.now().toEpochMilli());
        session.removeAttribute(GoogleIdentityService.OAUTH_INTENT);
        session.removeAttribute(GoogleIdentityService.PENDING_EMAIL);
        String returnTo = (String) session.getAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN);
        session.removeAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN);
        authenticateDirtyDutyUser(result.user().getEmail(), request, response);
        response.sendRedirect(
            configuration.appBaseUrl()
                + "/?auth=google-reauthenticated&screen="
                + (returnTo == null ? "privacy-security" : returnTo));
        return;
      }

      if (result.type() == ResultType.LINK_REQUIRED) {
        session.setAttribute(GoogleIdentityService.PENDING_SUBJECT, subject);
        session.setAttribute(GoogleIdentityService.PENDING_EMAIL, email.trim().toLowerCase());
        session.setAttribute(GoogleIdentityService.PENDING_CREATED, Instant.now().toEpochMilli());
        SecurityContextHolder.clearContext();
        contextRepository.saveContext(
            SecurityContextHolder.createEmptyContext(), request, response);
        response.sendRedirect(configuration.appBaseUrl() + "/?auth=google-link-required");
        return;
      }

      session.removeAttribute(GoogleIdentityService.PENDING_SUBJECT);
      session.removeAttribute(GoogleIdentityService.PENDING_EMAIL);
      session.removeAttribute(GoogleIdentityService.PENDING_CREATED);
      session.removeAttribute(GoogleIdentityService.REAUTHENTICATION_TIME);
      authenticateDirtyDutyUser(result.user().getEmail(), request, response);
      response.sendRedirect(configuration.appBaseUrl() + "/?auth=google-success");
    } catch (RuntimeException exception) {
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
        session.removeAttribute(GoogleIdentityService.REAUTHENTICATION_TIME);
      }
      SecurityContextHolder.clearContext();
      contextRepository.saveContext(SecurityContextHolder.createEmptyContext(), request, response);
      response.sendRedirect(
          configuration.appBaseUrl()
              + "/?auth=google-error"
              + (isReauthReturnScreen(returnTo) ? "&screen=" + returnTo : ""));
    }
  }

  private void authenticateDirtyDutyUser(
      String email, HttpServletRequest request, HttpServletResponse response) {
    UserDetails details = userDetailsService.loadUserByUsername(email);
    Authentication dirtyDutyAuthentication =
        org.springframework.security.authentication.UsernamePasswordAuthenticationToken
            .authenticated(details, null, details.getAuthorities());
    SecurityContext context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(dirtyDutyAuthentication);
    SecurityContextHolder.setContext(context);
    contextRepository.saveContext(context, request, response);
  }

  private boolean isReauthReturnScreen(String screen) {
    return "privacy-security".equals(screen) || "household-settings".equals(screen);
  }
}
