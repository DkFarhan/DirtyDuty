package com.dirtyduty.app.config;

import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;

@Configuration
public class GoogleOAuthConfiguration {
  @Bean
  @ConditionalOnProperty(name = "app.auth.google.enabled", havingValue = "true")
  ClientRegistrationRepository googleClientRegistrationRepository(
      AuthFeatureConfiguration configuration) {
    ClientRegistration registration =
        ClientRegistration.withRegistrationId("google")
            .clientId(configuration.googleClientId())
            .clientSecret(configuration.googleClientSecret())
            .clientName("Google")
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .redirectUri("{baseUrl}/api/auth/oauth2/callback/{registrationId}")
            .scope("openid", "profile", "email")
            .authorizationUri("https://accounts.google.com/o/oauth2/v2/auth")
            .tokenUri("https://oauth2.googleapis.com/token")
            .userInfoUri("https://openidconnect.googleapis.com/v1/userinfo")
            .userNameAttributeName("sub")
            .jwkSetUri("https://www.googleapis.com/oauth2/v3/certs")
            .issuerUri("https://accounts.google.com")
            .build();
    return new InMemoryClientRegistrationRepository(List.of(registration));
  }

  @Bean
  @ConditionalOnProperty(
      name = "app.auth.google.enabled",
      havingValue = "false",
      matchIfMissing = true)
  ClientRegistrationRepository emptyClientRegistrationRepository() {
    return registrationId -> null;
  }
}
