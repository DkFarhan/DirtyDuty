package com.dirtyduty.app.notification;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
                SELECT n.id, n.scheduled_at, n.expires_at, d.status,
                       n.recipient_user_id, n.push_target_tracking_enabled,
                       d.push_targets_snapshotted_at
                FROM notifications n
                JOIN notification_deliveries d
                    ON d.notification_id=n.id AND d.channel='WEB_PUSH'
                WHERE n.deduplication_key=?
                FOR UPDATE OF d
                """,
            rs ->
                rs.next()
                    ? new NotificationDeliveryState(
                        rs.getObject("id", UUID.class),
                        rs.getObject("scheduled_at", java.time.OffsetDateTime.class),
                        rs.getObject("expires_at", java.time.OffsetDateTime.class),
                        rs.getString("status"),
                        rs.getObject("recipient_user_id", UUID.class),
                        rs.getBoolean("push_target_tracking_enabled"),
                        rs.getObject("push_targets_snapshotted_at", OffsetDateTime.class))
                    : null,
            notification.deduplicationKey());
    if (deliveryState == null) {
      return;
    }
    UUID notificationId = deliveryState.notificationId();
    if ("SENT".equals(deliveryState.status()) || "CANCELLED".equals(deliveryState.status())) {
      return;
    }
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    if (deliveryState.scheduledAt().isAfter(now)) {
      return;
    }
    if (deliveryState.expiresAt() != null && !deliveryState.expiresAt().isAfter(now)) {
      setDeliveryStatus(notificationId, "CANCELLED", "Reminder window expired.", false);
      return;
    }
    if (!deliveryState.targetTrackingEnabled()) {
      setDeliveryStatus(
          notificationId, "CANCELLED", "Legacy notification is not eligible for push.", false);
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
            deliveryState.recipientUserId());
    if (!Boolean.TRUE.equals(enabled)) {
      setDeliveryStatus(notificationId, "CANCELLED", "Push notifications are disabled.", false);
      return;
    }
    if (deliveryState.targetsSnapshottedAt() == null) {
      jdbc.update(
          """
              INSERT INTO notification_push_delivery_targets (notification_id, subscription_id)
              SELECT ?, id FROM push_subscriptions
              WHERE user_id=? AND active=TRUE
              ON CONFLICT (notification_id, subscription_id) DO NOTHING
              """,
          notificationId,
          deliveryState.recipientUserId());
      jdbc.update(
          """
              UPDATE notification_deliveries
              SET push_targets_snapshotted_at=NOW()
              WHERE notification_id=? AND channel='WEB_PUSH'
              """,
          notificationId);
    }
    jdbc.update(
        """
            UPDATE notification_push_delivery_targets t
            SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
            FROM push_subscriptions s
            WHERE t.notification_id=? AND t.subscription_id=s.id AND s.active=FALSE
              AND t.status IN ('PENDING', 'FAILED')
            """,
        notificationId);
    List<Subscription> subscriptions =
        jdbc.query(
            """
                SELECT s.id, s.endpoint, s.public_key, s.auth_secret
                FROM notification_push_delivery_targets t
                JOIN push_subscriptions s ON s.id=t.subscription_id
                WHERE t.notification_id=? AND s.active=TRUE
                  AND t.status IN ('PENDING', 'FAILED') AND t.attempts<3
                  AND (t.next_attempt_at IS NULL OR t.next_attempt_at<=NOW())
                ORDER BY s.id
                FOR UPDATE OF t
                """,
            (rs, row) ->
                new Subscription(
                    rs.getObject("id", UUID.class),
                    rs.getString("endpoint"),
                    rs.getString("public_key"),
                    rs.getString("auth_secret")),
            notificationId);
    if (deliveryState.targetsSnapshottedAt() == null && subscriptions.isEmpty()) {
      setDeliveryStatus(notificationId, "CANCELLED", "No active push subscriptions.", false);
      return;
    }
    if (!cooldownService.isAvailable(notification, now, notification.deduplicationKey())) {
      return;
    }
    String payload = serialize(notification);
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
          recordTargetResult(notificationId, subscription.id(), "SENT", null, true);
          jdbc.update(
              "UPDATE push_subscriptions SET last_used_at=NOW() WHERE id=?", subscription.id());
        } else if (status == 404 || status == 410) {
          recordTargetResult(notificationId, subscription.id(), "CANCELLED", "GONE", false);
          jdbc.update("UPDATE push_subscriptions SET active=FALSE WHERE id=?", subscription.id());
        } else {
          recordTargetResult(
              notificationId, subscription.id(), "FAILED", "PROVIDER_REJECTED", false);
          logger.warn("Web Push target delivery was rejected (HTTP {}).", status);
        }
      } catch (IOException
          | GeneralSecurityException
          | JoseException
          | ExecutionException exception) {
        recordTargetResult(notificationId, subscription.id(), "FAILED", "PROVIDER_ERROR", false);
        logger.warn("Web Push target delivery failed (provider error).");
      } catch (InterruptedException exception) {
        Thread.currentThread().interrupt();
        recordTargetResult(notificationId, subscription.id(), "FAILED", "INTERRUPTED", false);
        logger.warn("Web Push target delivery was interrupted.");
        break;
      }
    }
    updateAggregateDeliveryStatus(notificationId);
  }

  public PushTestResult sendTest(
      UUID subscriptionId, String endpoint, String subscriptionPublicKey, String authSecret) {
    if (!isConfigured()) return PushTestResult.UNAVAILABLE;
    String payload;
    try {
      payload =
          objectMapper.writeValueAsString(
              new PushPayload(
                  "DirtyDuty test notification",
                  "Push delivery is reaching this browser.",
                  "/?screen=notifications"));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Unable to serialize Web Push test notification.", exception);
    }
    try {
      int status =
          webPushClient.send(
              publicKey,
              privateKey,
              subject,
              endpoint,
              subscriptionPublicKey,
              authSecret,
              payload.getBytes(StandardCharsets.UTF_8));
      if (status >= 200 && status < 300) {
        jdbc.update("UPDATE push_subscriptions SET last_used_at=NOW() WHERE id=?", subscriptionId);
        return PushTestResult.ACCEPTED;
      }
      if (status == 404 || status == 410) {
        jdbc.update("UPDATE push_subscriptions SET active=FALSE WHERE id=?", subscriptionId);
        return PushTestResult.SUBSCRIPTION_EXPIRED;
      }
      logger.warn("Web Push test notification was rejected (HTTP {}).", status);
      return PushTestResult.PROVIDER_REJECTED;
    } catch (IOException
        | GeneralSecurityException
        | JoseException
        | ExecutionException exception) {
      logger.warn("Web Push test notification failed (provider error).");
      return PushTestResult.PROVIDER_ERROR;
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      logger.warn("Web Push test notification was interrupted.");
      return PushTestResult.PROVIDER_ERROR;
    }
  }

  private void recordTargetResult(
      UUID notificationId, UUID subscriptionId, String status, String error, boolean accepted) {
    jdbc.update(
        """
            UPDATE notification_push_delivery_targets
            SET status=?, attempts=attempts+1,
                sent_at=CASE WHEN ? THEN NOW() ELSE sent_at END,
                next_attempt_at=CASE
                    WHEN ?='FAILED' AND attempts=0 THEN NOW() + INTERVAL '1 minute'
                    WHEN ?='FAILED' AND attempts=1 THEN NOW() + INTERVAL '5 minutes'
                    ELSE NULL
                END,
                last_error=?, updated_at=NOW()
            WHERE notification_id=? AND subscription_id=?
            """,
        status,
        accepted,
        status,
        status,
        error,
        notificationId,
        subscriptionId);
  }

  private void updateAggregateDeliveryStatus(UUID notificationId) {
    AggregateTargetState targets =
        jdbc.query(
            """
                SELECT COUNT(*) FILTER (
                           WHERE status IN ('PENDING', 'FAILED') AND attempts<3) AS outstanding,
                       MIN(next_attempt_at) FILTER (
                           WHERE status IN ('PENDING', 'FAILED') AND attempts<3) AS next_attempt_at,
                       COUNT(*) FILTER (WHERE status='SENT') AS accepted,
                       COUNT(*) FILTER (WHERE status='FAILED') AS failed
                FROM notification_push_delivery_targets
                WHERE notification_id=?
                """,
            rs ->
                rs.next()
                    ? new AggregateTargetState(
                        rs.getInt("outstanding"),
                        rs.getObject("next_attempt_at", OffsetDateTime.class),
                        rs.getInt("accepted"),
                        rs.getInt("failed"))
                    : new AggregateTargetState(0, null, 0, 0),
            notificationId);
    String status =
        targets.outstanding() > 0
            ? "FAILED"
            : targets.accepted() > 0 ? "SENT" : targets.failed() > 0 ? "FAILED" : "CANCELLED";
    String error =
        targets.outstanding() > 0
            ? "One or more push subscriptions are awaiting retry."
            : targets.failed() > 0 ? "No push subscription accepted delivery." : null;
    jdbc.update(
        """
                UPDATE notification_deliveries SET status=?, attempts=attempts+1,
                    sent_at=CASE WHEN ?='SENT' THEN NOW() ELSE sent_at END,
                    next_attempt_at=?,
                    last_error=?
                WHERE notification_id=? AND channel='WEB_PUSH'
                """,
        status,
        status,
        targets.nextAttemptAt(),
        error,
        notificationId);
  }

  public enum PushTestResult {
    ACCEPTED,
    SUBSCRIPTION_EXPIRED,
    PROVIDER_REJECTED,
    PROVIDER_ERROR,
    UNAVAILABLE,
    DISABLED
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
    if ("CHORE_SCHEDULE".equals(notification.referenceType())) {
      return "/?screen=my-chores";
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
    if ("CANCELLED".equals(status)) {
      jdbc.update(
          """
              UPDATE notification_push_delivery_targets
              SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
              WHERE notification_id=? AND status IN ('PENDING', 'FAILED')
              """,
          notificationId);
    }
  }

  private record PushPayload(String title, String body, String targetPath) {}

  private record Subscription(UUID id, String endpoint, String publicKey, String authSecret) {}

  private record NotificationDeliveryState(
      UUID notificationId,
      java.time.OffsetDateTime scheduledAt,
      java.time.OffsetDateTime expiresAt,
      String status,
      UUID recipientUserId,
      boolean targetTrackingEnabled,
      OffsetDateTime targetsSnapshottedAt) {}

  private record AggregateTargetState(
      int outstanding, OffsetDateTime nextAttemptAt, int accepted, int failed) {}
}
