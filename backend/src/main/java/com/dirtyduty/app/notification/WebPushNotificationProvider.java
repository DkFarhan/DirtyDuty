package com.dirtyduty.app.notification;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import org.jose4j.lang.JoseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@Order(2)
public class WebPushNotificationProvider implements NotificationDeliveryProvider {
  private static final Logger logger = LoggerFactory.getLogger(WebPushNotificationProvider.class);

  private final JdbcTemplate jdbc;
  private final NotificationCooldownService cooldownService;
  private final WebPushClient webPushClient;
  private final ObjectMapper objectMapper;
  private final String publicKey;
  private final String privateKey;
  private final String subject;

  public WebPushNotificationProvider(
      JdbcTemplate jdbc,
      NotificationCooldownService cooldownService,
      WebPushClient webPushClient,
      @Value("${app.notifications.web-push.public-key:}") String publicKey,
      @Value("${app.notifications.web-push.private-key:}") String privateKey,
      @Value("${app.notifications.web-push.subject:mailto:support@dirtyduty.app}") String subject) {
    this.jdbc = jdbc;
    this.cooldownService = cooldownService;
    this.webPushClient = webPushClient;
    this.objectMapper = new ObjectMapper();
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.subject = subject;
  }

  public boolean isConfigured() {
    return !publicKey.isBlank() && !privateKey.isBlank();
  }

  public String publicKey() {
    return isConfigured() ? publicKey : null;
  }

  @Override
  public String channel() {
    return "WEB_PUSH";
  }

  @Override
  public void deliver(NotificationMessage notification, UUID eventId) {
    jdbc.update(
        """
                INSERT INTO notification_deliveries (notification_id, channel, status)
                SELECT id, 'WEB_PUSH', 'PENDING'
                FROM notifications WHERE deduplication_key=?
                ON CONFLICT (notification_id, channel) DO NOTHING
                """,
        notification.deduplicationKey());
    NotificationDeliveryState deliveryState =
        jdbc.query(
            """
                SELECT n.id, n.scheduled_at, n.expires_at, d.status, d.attempts,
                       n.recipient_user_id
                FROM notifications n
                JOIN notification_deliveries d
                    ON d.notification_id=n.id AND d.channel='WEB_PUSH'
                WHERE n.deduplication_key=?
                """,
            rs ->
                rs.next()
                    ? new NotificationDeliveryState(
                        rs.getObject("id", UUID.class),
                        rs.getObject("scheduled_at", java.time.OffsetDateTime.class),
                        rs.getObject("expires_at", java.time.OffsetDateTime.class),
                        rs.getString("status"),
                        rs.getInt("attempts"))
                    : null,
            notification.deduplicationKey());
    if (deliveryState == null) {
      return;
    }
    UUID notificationId = deliveryState.notificationId();
    if ("SENT".equals(deliveryState.status()) || "CANCELLED".equals(deliveryState.status())) {
      return;
    }
    java.time.OffsetDateTime now = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC);
    if (deliveryState.scheduledAt().isAfter(now)) {
      return;
    }
    if (deliveryState.expiresAt() != null && !deliveryState.expiresAt().isAfter(now)) {
      setDeliveryStatus(notificationId, "CANCELLED", "Reminder window expired.", false);
      return;
    }
    if (deliveryState.attempts() >= 3) {
      return;
    }
    if (!isConfigured()) {
      setDeliveryStatus(notificationId, "CANCELLED", "Web Push is not configured.", false);
      return;
    }
    Boolean enabled =
        jdbc.queryForObject(
            """
                SELECT COALESCE((SELECT push_enabled FROM notification_preferences WHERE user_id=?), FALSE)
                """,
            Boolean.class,
            notification.recipientUserId());
    if (!Boolean.TRUE.equals(enabled)) {
      setDeliveryStatus(notificationId, "CANCELLED", "Push notifications are disabled.", false);
      return;
    }
    List<Subscription> subscriptions =
        jdbc.query(
            """
                SELECT id, endpoint, public_key, auth_secret
                FROM push_subscriptions
                WHERE user_id=? AND active=TRUE
                """,
            (rs, row) ->
                new Subscription(
                    rs.getObject("id", UUID.class), rs.getString("endpoint"),
                    rs.getString("public_key"), rs.getString("auth_secret")),
            notification.recipientUserId());
    if (subscriptions.isEmpty()) {
      setDeliveryStatus(notificationId, "CANCELLED", "No active push subscriptions.", false);
      return;
    }
    if (!cooldownService.isAvailable(notification, now, notification.deduplicationKey())) {
      return;
    }
    String payload = serialize(notification);
    int successes = 0;
    int failures = 0;
    int retryableFailures = 0;
    for (Subscription subscription : subscriptions) {
      try {
        int status =
            webPushClient.send(
                publicKey,
                privateKey,
                subject,
                subscription.endpoint(),
                subscription.publicKey(),
                subscription.authSecret(),
                payload.getBytes(StandardCharsets.UTF_8));
        if (status >= 200 && status < 300) {
          successes++;
          jdbc.update(
              "UPDATE push_subscriptions SET last_used_at=NOW() WHERE id=?", subscription.id());
        } else {
          failures++;
          if (status == 404 || status == 410) {
            jdbc.update("UPDATE push_subscriptions SET active=FALSE WHERE id=?", subscription.id());
          } else {
            retryableFailures++;
          }
          logger.warn("Web Push provider rejected a delivery with status {}", status);
        }
      } catch (IOException
          | GeneralSecurityException
          | JoseException
          | ExecutionException exception) {
        failures++;
        retryableFailures++;
        logger.warn("Web Push delivery failed for subscription {}", subscription.id(), exception);
      } catch (InterruptedException exception) {
        Thread.currentThread().interrupt();
        failures++;
        retryableFailures++;
        logger.warn(
            "Web Push delivery was interrupted for subscription {}", subscription.id(), exception);
        break;
      }
    }

    String status = successes > 0 ? "SENT" : retryableFailures > 0 ? "FAILED" : "CANCELLED";
    String error = failures > 0 && successes == 0 ? "All active push subscriptions failed." : null;
    jdbc.update(
        """
                UPDATE notification_deliveries SET status=?, attempts=attempts+1,
                    sent_at=CASE WHEN ?='SENT' THEN NOW() ELSE sent_at END,
                    next_attempt_at=CASE WHEN ?='FAILED' AND attempts<2
                        THEN NOW() + CASE WHEN attempts=0 THEN INTERVAL '1 minute'
                                           ELSE INTERVAL '5 minutes' END
                        ELSE NULL END,
                    last_error=?
                WHERE notification_id=? AND channel='WEB_PUSH'
                """,
        status,
        status,
        status,
        error,
        notificationId);
  }

  private String serialize(NotificationMessage notification) {
    try {
      return objectMapper.writeValueAsString(
          new PushPayload(notification.title(), notification.message(), targetPath(notification)));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Unable to serialize Web Push notification.", exception);
    }
  }

  static String targetPath(NotificationMessage notification) {
    if ("CHORE_ASSIGNMENT".equals(notification.referenceType())
        && notification.referenceId() != null) {
      return "/?screen=my-chores&assignmentId=" + notification.referenceId();
    }
    if ("HOUSEHOLD".equals(notification.referenceType())
        || "HOUSEHOLD_JOINED".equals(notification.type())
        || "INVITE_ACCEPTED".equals(notification.type())) {
      return "/?screen=household";
    }
    return "/?screen=notifications";
  }

  private void setDeliveryStatus(
      UUID notificationId, String status, String error, boolean incrementAttempts) {
    jdbc.update(
        """
                UPDATE notification_deliveries
                SET status=?, last_error=?, next_attempt_at=NULL,
                    attempts=attempts+?
                WHERE notification_id=? AND channel='WEB_PUSH'
                """,
        status,
        error,
        incrementAttempts ? 1 : 0,
        notificationId);
  }

  private record PushPayload(String title, String body, String targetPath) {}

  private record Subscription(UUID id, String endpoint, String publicKey, String authSecret) {}

  private record NotificationDeliveryState(
      UUID notificationId,
      java.time.OffsetDateTime scheduledAt,
      java.time.OffsetDateTime expiresAt,
      String status,
      int attempts) {}
}
