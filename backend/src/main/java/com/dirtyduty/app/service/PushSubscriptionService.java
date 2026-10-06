package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.notification.PushSubscriptionRequest;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.UserRepository;
import java.net.InetAddress;
import java.net.URI;
import java.util.Base64;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PushSubscriptionService {
  private final JdbcTemplate jdbc;
  private final UserRepository userRepository;

  public PushSubscriptionService(JdbcTemplate jdbc, UserRepository userRepository) {
    this.jdbc = jdbc;
    this.userRepository = userRepository;
  }

  @Transactional
  public void subscribe(PushSubscriptionRequest request, Authentication authentication) {
    UUID userId = currentUserId(authentication);
    validateEndpoint(request.endpoint());
    validateKey(request.publicKey(), 65, "public key");
    validateKey(request.authSecret(), 16, "auth secret");
    int updated =
        jdbc.update(
            """
                INSERT INTO push_subscriptions (user_id, endpoint, public_key, auth_secret, active)
                VALUES (?, ?, ?, ?, TRUE)
                ON CONFLICT (endpoint) DO UPDATE SET
                    public_key=EXCLUDED.public_key,
                    auth_secret=EXCLUDED.auth_secret,
                    active=TRUE,
                    last_used_at=NULL
                WHERE push_subscriptions.user_id=EXCLUDED.user_id
                """,
            userId,
            request.endpoint(),
            request.publicKey(),
            request.authSecret());
    if (updated == 0) {
      throw new DuplicateResourceException(
          "This push subscription is already registered to another user.");
    }
    jdbc.update(
        """
                INSERT INTO notification_preferences (user_id, push_enabled, updated_at)
                VALUES (?, TRUE, NOW())
                ON CONFLICT (user_id) DO UPDATE SET push_enabled=TRUE, updated_at=NOW()
                """,
        userId);
  }

  @Transactional
  public void unsubscribe(String endpoint, Authentication authentication) {
    UUID userId = currentUserId(authentication);
    if (endpoint == null || endpoint.isBlank() || endpoint.length() > 2048) {
      throw new InvalidHouseholdException("A valid push endpoint is required.");
    }
    jdbc.update(
        "UPDATE push_subscriptions SET active=FALSE WHERE user_id=? AND endpoint=?",
        userId,
        endpoint);
  }

  private UUID currentUserId(Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new ResourceNotFoundException("Authenticated user was not found.");
    }
    return userRepository
        .findByEmailIgnoreCase(authentication.getName())
        .map(user -> user.getId())
        .orElseThrow(() -> new ResourceNotFoundException("Authenticated user was not found."));
  }

  private void validateEndpoint(String endpoint) {
    try {
      URI uri = URI.create(endpoint);
      if (!"https".equalsIgnoreCase(uri.getScheme())
          || uri.getHost() == null
          || (uri.getPort() != -1 && uri.getPort() != 443)
          || uri.getUserInfo() != null
          || uri.getHost().equalsIgnoreCase("localhost")
          || uri.getHost().endsWith(".local")) {
        throw new InvalidHouseholdException("Push endpoints must be public HTTPS URLs.");
      }
      for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
        if (address.isAnyLocalAddress()
            || address.isLoopbackAddress()
            || address.isLinkLocalAddress()
            || address.isSiteLocalAddress()
            || address.isMulticastAddress()) {
          throw new InvalidHouseholdException("Push endpoints must resolve to a public address.");
        }
      }
    } catch (IllegalArgumentException | java.net.UnknownHostException exception) {
      throw new InvalidHouseholdException("A valid public HTTPS push endpoint is required.");
    }
  }

  private void validateKey(String encoded, int expectedMinimumBytes, String label) {
    try {
      byte[] decoded = Base64.getUrlDecoder().decode(encoded);
      if (decoded.length < expectedMinimumBytes) {
        throw new InvalidHouseholdException("The push subscription " + label + " is invalid.");
      }
    } catch (IllegalArgumentException exception) {
      throw new InvalidHouseholdException("The push subscription " + label + " is invalid.");
    }
  }
}
