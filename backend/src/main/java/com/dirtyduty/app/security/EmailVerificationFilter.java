package com.dirtyduty.app.security;

import com.dirtyduty.app.service.EmailVerificationService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

public class EmailVerificationFilter extends OncePerRequestFilter {
  private final EmailVerificationService verification;
  private final JsonMapper jsonMapper;

  public EmailVerificationFilter(EmailVerificationService verification, JsonMapper jsonMapper) {
    this.verification = verification;
    this.jsonMapper = jsonMapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (request.getMethod().equals("OPTIONS")
        || !isApiRequest(request)
        || authentication == null
        || authentication instanceof AnonymousAuthenticationToken
        || !authentication.isAuthenticated()
        || isVerificationEndpoint(request)) {
      filterChain.doFilter(request, response);
      return;
    }

    if (!verification.isVerified(authentication.getName())) {
      response.setStatus(HttpServletResponse.SC_FORBIDDEN);
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      jsonMapper.writeValue(
          response.getOutputStream(),
          Map.of(
              "status",
              HttpServletResponse.SC_FORBIDDEN,
              "error",
              "Forbidden",
              "code",
              "EMAIL_VERIFICATION_REQUIRED",
              "emailVerificationRequired",
              true));
      return;
    }
    filterChain.doFilter(request, response);
  }

  private boolean isApiRequest(HttpServletRequest request) {
    return request.getRequestURI().startsWith(request.getContextPath() + "/api/");
  }

  private boolean isVerificationEndpoint(HttpServletRequest request) {
    String uri = request.getRequestURI().substring(request.getContextPath().length());
    if (uri.equals("/api/auth/me")
        || uri.equals("/api/auth/logout")
        || uri.equals("/api/auth/csrf")
        || uri.equals("/api/auth/providers")
        || uri.equals("/api/auth/password-reset/request")
        || uri.equals("/api/auth/password-reset/confirm")
        || uri.equals("/api/auth/google/link")
        || uri.startsWith("/api/auth/oauth2/")
        || uri.startsWith("/api/auth/email-verification/")) {
      return true;
    }
    return false;
  }
}
