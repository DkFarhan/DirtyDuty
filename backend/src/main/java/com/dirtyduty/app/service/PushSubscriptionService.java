package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.notification.PushSubscriptionHealthRequest;
import com.dirtyduty.app.dto.notification.PushSubscriptionHealthResponse;
import com.dirtyduty.app.dto.notification.PushSubscriptionRequest;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.UserRepository;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
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
                    last_used_at=NULL,
                    last_client_confirmed_at=CASE
                        WHEN push_subscriptions.active=FALSE
                          OR push_subscriptions.public_key IS DISTINCT FROM EXCLUDED.public_key
                          OR push_subscriptions.auth_secret IS DISTINCT FROM EXCLUDED.auth_secret
                        THEN NULL ELSE push_subscriptions.last_client_confirmed_at END
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
  public PushSubscriptionHealthResponse confirmClientPossession(
      PushSubscriptionHealthRequest request, Authentication authentication) {
    UUID userId = currentUserId(authentication);
    Boolean enabled =
        jdbc.queryForObject(
            """
                SELECT COALESCE(
                    (SELECT push_enabled FROM notification_preferences WHERE user_id=?), FALSE)
                """,
            Boolean.class,
            userId);
    if (!Boolean.TRUE.equals(enabled)) {
      return new PushSubscriptionHealthResponse(
          PushSubscriptionHealthResponse.Status.DISABLED, null);
    }

    SubscriptionHealthState state =
        jdbc.query(
            """
                SELECT id, user_id, public_key, auth_secret, active, last_client_confirmed_at
                FROM push_subscriptions
                WHERE endpoint=?
                """,
            rs ->
                rs.next()
                    ? new SubscriptionHealthState(
                        rs.getObject("id", UUID.class),
                        rs.getObject("user_id", UUID.class),
                        rs.getString("public_key"),
                        rs.getString("auth_secret"),
                        rs.getBoolean("active"),
                        rs.getObject("last_client_confirmed_at", OffsetDateTime.class))
                    : null,
            request.endpoint());
    if (state == null
        || !state.userId().equals(userId)
        || !state.active()
        || !constantTimeEquals(state.publicKey(), request.publicKey())
        || !constantTimeEquals(state.authSecret(), request.authSecret())) {
      return new PushSubscriptionHealthResponse(
          PushSubscriptionHealthResponse.Status.SYNC_REQUIRED, null);
    }

    jdbc.update(
        """
            UPDATE push_subscriptions
            SET last_client_confirmed_at=NOW()
            WHERE id=? AND user_id=? AND active=TRUE
              AND (last_client_confirmed_at IS NULL
                   OR last_client_confirmed_at<=NOW() - INTERVAL '24 hours')
              AND EXISTS (
                  SELECT 1 FROM notification_preferences
                  WHERE user_id=? AND push_enabled=TRUE)
            """,
        state.id(),
        userId,
        userId);

    SubscriptionHealthState confirmed =
        jdbc.query(
            """
                SELECT id, user_id, public_key, auth_secret, active, last_client_confirmed_at
                FROM push_subscriptions
                WHERE id=?
                """,
            rs ->
                rs.next()
                    ? new SubscriptionHealthState(
                        rs.getObject("id", UUID.class),
                        rs.getObject("user_id", UUID.class),
                        rs.getString("public_key"),
                        rs.getString("auth_secret"),
                        rs.getBoolean("active"),
                        rs.getObject("last_client_confirmed_at", OffsetDateTime.class))
                    : null,
            state.id());
    Boolean stillEnabled =
        jdbc.queryForObject(
            """
                SELECT COALESCE(
                    (SELECT push_enabled FROM notification_preferences WHERE user_id=?), FALSE)
                """,
            Boolean.class,
            userId);
    if (!Boolean.TRUE.equals(stillEnabled)) {
      return new PushSubscriptionHealthResponse(
          PushSubscriptionHealthResponse.Status.DISABLED, null);
    }
    if (confirmed == null
        || !confirmed.userId().equals(userId)
        || !confirmed.active()
        || !constantTimeEquals(confirmed.publicKey(), request.publicKey())
        || !constantTimeEquals(confirmed.authSecret(), request.authSecret())) {
      return new PushSubscriptionHealthResponse(
          PushSubscriptionHealthResponse.Status.SYNC_REQUIRED, null);
    }
    return new PushSubscriptionHealthResponse(
        PushSubscriptionHealthResponse.Status.CONFIRMED, confirmed.lastClientConfirmedAt());
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

  private boolean constantTimeEquals(String expected, String actual) {
    return MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
  }

  private record SubscriptionHealthState(
      UUID id,
      UUID userId,
      String publicKey,
      String authSecret,
      boolean active,
      OffsetDateTime lastClientConfirmedAt) {}
}
