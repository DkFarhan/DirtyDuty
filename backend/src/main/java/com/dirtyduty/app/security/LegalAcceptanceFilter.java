package com.dirtyduty.app.security;

import com.dirtyduty.app.service.LegalAcceptanceService;
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

public class LegalAcceptanceFilter extends OncePerRequestFilter {
  private final LegalAcceptanceService legalAcceptanceService;
  private final JsonMapper jsonMapper;

  public LegalAcceptanceFilter(
      LegalAcceptanceService legalAcceptanceService, JsonMapper jsonMapper) {
    this.legalAcceptanceService = legalAcceptanceService;
    this.jsonMapper = jsonMapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (request.getMethod().equals("OPTIONS")
        || !isBusinessApi(request)
        || authentication == null
        || authentication instanceof AnonymousAuthenticationToken
        || !authentication.isAuthenticated()) {
      filterChain.doFilter(request, response);
      return;
    }
    if (legalAcceptanceService.isAcceptanceRequiredForEmail(authentication.getName())) {
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
              "LEGAL_ACCEPTANCE_REQUIRED",
              "legalAcceptanceRequired",
              true));
      return;
    }
    filterChain.doFilter(request, response);
  }

  private boolean isBusinessApi(HttpServletRequest request) {
    return request.getRequestURI().startsWith(request.getContextPath() + "/api/")
        && !request.getRequestURI().startsWith(request.getContextPath() + "/api/auth/");
  }
}
