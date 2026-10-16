package com.dirtyduty.app.security;

import com.dirtyduty.app.service.GoogleIdentityService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;

public class GoogleLoginPromptResolver implements OAuth2AuthorizationRequestResolver {
  private final DefaultOAuth2AuthorizationRequestResolver delegate;

  public GoogleLoginPromptResolver(ClientRegistrationRepository registrations, String baseUri) {
    delegate = new DefaultOAuth2AuthorizationRequestResolver(registrations, baseUri);
  }

  @Override
  public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
    return addFreshLoginPrompt(delegate.resolve(request), request);
  }

  @Override
  public OAuth2AuthorizationRequest resolve(
      HttpServletRequest request, String clientRegistrationId) {
    return addFreshLoginPrompt(delegate.resolve(request, clientRegistrationId), request);
  }

  private OAuth2AuthorizationRequest addFreshLoginPrompt(
      OAuth2AuthorizationRequest authorizationRequest, HttpServletRequest request) {
    if (authorizationRequest == null
        || !Boolean.TRUE.equals(
            request.getSession(false) == null
                ? null
                : request.getSession(false).getAttribute(GoogleIdentityService.OAUTH_INTENT))) {
      return authorizationRequest;
    }
    var parameters = new HashMap<>(authorizationRequest.getAdditionalParameters());
    parameters.put("prompt", "login");
    return OAuth2AuthorizationRequest.from(authorizationRequest)
        .additionalParameters(parameters)
        .build();
  }
}
