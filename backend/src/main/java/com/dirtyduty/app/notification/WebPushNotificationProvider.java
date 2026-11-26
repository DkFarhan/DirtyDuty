package com.dirtyduty.app.notification;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.stream.Collectors;
import org.jose4j.lang.JoseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@Order(2)
public class WebPushNotificationProvider implements NotificationDeliveryProvider {
  private static final Logger logger = LoggerFactory.getLogger(WebPushNotificationProvider.class);

  /**
   * Turn changes on "After it's done" and "When needed" chores are an in-app line, never a push.
   */
  static final java.util.Set<String> IN_APP_ONLY_TYPES = java.util.Set.of("CHORE_TURN");

  private final JdbcTemplate jdbc;
  private final NotificationCooldownService cooldownService;
  private final WebPushClient webPushClient;
  private final QuietHoursService quietHours;
  private final ObjectMapper objectMapper;
  private final String publicKey;
  private final String privateKey;
  private final String subject;

  /** How long a claimed push is kept from other runs while it is being sent. */
  private static final String SEND_LEASE = "10 minutes";

  private static final java.time.Duration SEND_LEASE_DURATION = java.time.Duration.ofMinutes(10);

  /** Records send results in a short transaction of their own, after the caller's has ended. */
  private final TransactionTemplate records;

  public WebPushNotificationProvider(
      JdbcTemplate jdbc,
      NotificationCooldownService cooldownService,
      WebPushClient webPushClient,
      QuietHoursService quietHours,
      @Value("${app.notifications.web-push.public-key:}") String publicKey,
      @Value("${app.notifications.web-push.private-key:}") String privateKey,
      @Value("${app.notifications.web-push.subject:mailto:support@dirtyduty.app}") String subject,
      PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.cooldownService = cooldownService;
    this.webPushClient = webPushClient;
    this.quietHours = quietHours;
    this.objectMapper = new ObjectMapper();
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.subject = subject;
    this.records = new TransactionTemplate(transactionManager);
    this.records.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
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
    if (IN_APP_ONLY_TYPES.contains(notification.type())) {
      return;
    }
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
    // Quiet hours hold the push (every type, here once) until the end of the recipient's window;
    // the in-app row is already there. The morning release then cleans up, collapses and groups
    // everything held for the person (QuietHoursRelease). Targets are snapshotted only on send.
    OffsetDateTime holdUntil = quietHours.holdUntil(notificationId);
    if (holdUntil != null) {
      jdbc.update(
          """
              UPDATE notification_deliveries
              SET quiet_held_until=?, next_attempt_at=?, last_error='Held for quiet hours.'
              WHERE notification_id=? AND channel='WEB_PUSH'
              """,
          holdUntil,
          holdUntil,
          notificationId);
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
    if (subscriptions.isEmpty()) {
      updateAggregateDeliveryStatus(notificationId, false);
      return;
    }
    // Claim the targets (and the delivery) for a short lease, so no other run or request picks
    // them while the push is on its way; the lease ends when the results are recorded, or lapses
    // into an ordinary retry if this process stops before then.
    jdbc.update(
        """
            UPDATE notification_push_delivery_targets
            SET next_attempt_at=NOW() + CAST(? AS interval), updated_at=NOW()
            WHERE notification_id=? AND subscription_id = ANY(CAST(? AS uuid[]))
            """,
        SEND_LEASE,
        notificationId,
        uuidArray(subscriptions.stream().map(Subscription::id).toList()));
    jdbc.update(
        """
            UPDATE notification_deliveries SET next_attempt_at=NOW() + CAST(? AS interval)
            WHERE notification_id=? AND channel='WEB_PUSH'
            """,
        SEND_LEASE,
        notificationId);
    String payload = serialize(notification);
    afterCommit(() -> sendAndRecord(notificationId, subscriptions, payload));
  }

  /**
   * Sends a claimed push to its subscriptions with no transaction (and so no lock) open, then
   * records every result in one short transaction of its own.
   */
  private void sendAndRecord(
      UUID notificationId, List<Subscription> subscriptions, String payload) {
    List<TargetResult> results = new ArrayList<>();
    for (Subscription subscription : subscriptions) {
      if (Thread.currentThread().isInterrupted()) {
        results.add(TargetResult.released(subscription.id()));
        continue;
      }
      try {
        int status = send(subscription, payload);
        if (status >= 200 && status < 300) {
          results.add(new TargetResult(subscription.id(), "SENT", null, true, false));
        } else if (status == 404 || status == 410) {
          results.add(new TargetResult(subscription.id(), "CANCELLED", "GONE", false, true));
        } else {
          results.add(
              new TargetResult(subscription.id(), "FAILED", "PROVIDER_REJECTED", false, false));
          logger.warn("Web Push target delivery was rejected (HTTP {}).", status);
        }
      } catch (IOException
          | GeneralSecurityException
          | JoseException
          | ExecutionException exception) {
        results.add(new TargetResult(subscription.id(), "FAILED", "PROVIDER_ERROR", false, false));
        logger.warn("Web Push target delivery failed (provider error).");
      } catch (InterruptedException exception) {
        Thread.currentThread().interrupt();
        results.add(new TargetResult(subscription.id(), "FAILED", "INTERRUPTED", false, false));
        logger.warn("Web Push target delivery was interrupted.");
      } catch (IllegalArgumentException exception) {
        // A stored subscription whose keys can't be decoded will never work: drop it, and never
        // let it fail the request that triggered the push (e.g. creating a post).
        results.add(
            new TargetResult(subscription.id(), "CANCELLED", "INVALID_SUBSCRIPTION", false, true));
        logger.warn("Web Push target has an invalid subscription key; it was deactivated.");
      }
    }
    records.executeWithoutResult(
        status -> {
          for (TargetResult result : results) {
            if (result.status() == null) {
              jdbc.update(
                  """
                      UPDATE notification_push_delivery_targets
                      SET next_attempt_at=NULL, updated_at=NOW()
                      WHERE notification_id=? AND subscription_id=?
                        AND status IN ('PENDING', 'FAILED')
                      """,
                  notificationId,
                  result.subscriptionId());
              continue;
            }
            recordTargetResult(
                notificationId,
                result.subscriptionId(),
                result.status(),
                result.error(),
                result.accepted());
            if (result.accepted()) {
              jdbc.update(
                  "UPDATE push_subscriptions SET last_used_at=NOW() WHERE id=?",
                  result.subscriptionId());
            } else if (result.deactivate()) {
              jdbc.update(
                  "UPDATE push_subscriptions SET active=FALSE WHERE id=?", result.subscriptionId());
            }
          }
          updateAggregateDeliveryStatus(
              notificationId, results.stream().anyMatch(TargetResult::accepted));
        });
  }

  private int send(Subscription subscription, String payload)
      throws IOException,
          GeneralSecurityException,
          JoseException,
          ExecutionException,
          InterruptedException {
    return webPushClient.send(
        publicKey,
        privateKey,
        subject,
        subscription.endpoint(),
        subscription.publicKey(),
        subscription.authSecret(),
        payload.getBytes(StandardCharsets.UTF_8));
  }

  /**
   * Runs push sends once the caller's transaction has committed (its household, person and row
   * locks released), or straight away when there is none. A failure is logged, never thrown: the
   * caller's work is already saved, and the lease turns an unrecorded push into a retry.
   */
  private void afterCommit(Runnable work) {
    Runnable guarded =
        () -> {
          try {
            work.run();
          } catch (RuntimeException exception) {
            logger.warn("Recording a Web Push result failed; it will be retried.", exception);
          }
        };
    if (TransactionSynchronizationManager.isActualTransactionActive()
        && TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              guarded.run();
            }
          });
    } else {
      guarded.run();
    }
  }

  private static String uuidArray(List<UUID> ids) {
    return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
  }

  /**
   * Sends one grouped morning push (push only: there is no notification row behind it) to every
   * active subscription of the person, after the caller's transaction commits, and records the
   * digest's outcome: SENT when any subscription accepted it, CANCELLED when push is off or there
   * is nowhere to send it, FAILED otherwise. Until then the digest is leased (its send time moved
   * ahead) so no other run sends it too; the original send time is put back with the outcome.
   */
  public void sendDigest(
      UUID digestId,
      OffsetDateTime sendAt,
      UUID recipientUserId,
      String title,
      String body,
      String targetPath) {
    List<Subscription> subscriptions = digestSubscriptions(recipientUserId);
    if (subscriptions.isEmpty()) {
      recordDigest(digestId, sendAt, "CANCELLED");
      return;
    }
    String payload;
    try {
      payload = objectMapper.writeValueAsString(new PushPayload(title, body, targetPath));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Unable to serialize a grouped push.", exception);
    }
    jdbc.update(
        "UPDATE notification_push_digests SET send_at=? WHERE id=?",
        quietHours.now().plus(SEND_LEASE_DURATION),
        digestId);
    afterCommit(
        () -> {
          boolean accepted = false;
          List<UUID> used = new ArrayList<>();
          List<UUID> gone = new ArrayList<>();
          for (Subscription subscription : subscriptions) {
            try {
              int status = send(subscription, payload);
              if (status >= 200 && status < 300) {
                accepted = true;
                used.add(subscription.id());
              } else if (status == 404 || status == 410) {
                gone.add(subscription.id());
              } else {
                logger.warn("Grouped Web Push was rejected (HTTP {}).", status);
              }
            } catch (IOException
                | GeneralSecurityException
                | JoseException
                | ExecutionException exception) {
              logger.warn("Grouped Web Push failed (provider error).");
            } catch (InterruptedException exception) {
              Thread.currentThread().interrupt();
              logger.warn("Grouped Web Push was interrupted.");
              break;
            } catch (IllegalArgumentException exception) {
              gone.add(subscription.id());
              logger.warn(
                  "Grouped Web Push skipped a subscription with an invalid key; it was"
                      + " deactivated.");
            }
          }
          String outcome = accepted ? "SENT" : "FAILED";
          records.executeWithoutResult(
              status -> {
                used.forEach(
                    id ->
                        jdbc.update(
                            "UPDATE push_subscriptions SET last_used_at=NOW() WHERE id=?", id));
                gone.forEach(
                    id -> jdbc.update("UPDATE push_subscriptions SET active=FALSE WHERE id=?", id));
                recordDigest(digestId, sendAt, outcome);
              });
        });
  }

  private List<Subscription> digestSubscriptions(UUID recipientUserId) {
    if (!isConfigured()) {
      return List.of();
    }
    Boolean enabled =
        jdbc.queryForObject(
            "SELECT COALESCE((SELECT push_enabled FROM notification_preferences WHERE user_id=?), FALSE)",
            Boolean.class,
            recipientUserId);
    if (!Boolean.TRUE.equals(enabled)) {
      return List.of();
    }
    return jdbc.query(
        """
            SELECT id, endpoint, public_key, auth_secret FROM push_subscriptions
            WHERE user_id=? AND active=TRUE ORDER BY id
            """,
        (rs, row) ->
            new Subscription(
                rs.getObject("id", UUID.class),
                rs.getString("endpoint"),
                rs.getString("public_key"),
                rs.getString("auth_secret")),
        recipientUserId);
  }

  private void recordDigest(UUID digestId, OffsetDateTime sendAt, String status) {
    jdbc.update(
        """
            UPDATE notification_push_digests
            SET status=?, send_at=?, sent_at=CASE WHEN ?='SENT' THEN NOW() ELSE sent_at END
            WHERE id=?
            """,
        status,
        sendAt,
        status,
        digestId);
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
              AND (status IN ('PENDING', 'FAILED') OR ?)
            """,
        status,
        accepted,
        status,
        status,
        error,
        notificationId,
        subscriptionId,
        accepted);
  }

  /**
   * Sets the delivery from its targets. A delivery cancelled while its push was on the way (the
   * chore was done meanwhile) stays cancelled unless the push was in fact accepted.
   */
  private void updateAggregateDeliveryStatus(UUID notificationId, boolean accepted) {
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
                  AND (status<>'CANCELLED' OR ?)
                """,
        status,
        status,
        targets.nextAttemptAt(),
        error,
        notificationId,
        accepted);
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
    if ("AWAY_MODE_ENDING".equals(notification.type())) {
      return "/?screen=away-mode";
    }
    if ("CHORE_ASSIGNMENT".equals(notification.referenceType())
        && notification.referenceId() != null) {
      return "/?screen=my-chores&assignmentId=" + notification.referenceId();
    }
    if ("CHORE_REQUEST".equals(notification.referenceType())
        && notification.referenceId() != null) {
      // Hand-off and swap requests (E11) open Home with the request in view.
      return "/?screen=dashboard&requestId=" + notification.referenceId();
    }
    if ("BOARD_POST".equals(notification.referenceType()) && notification.referenceId() != null) {
      return "/?screen=board&postId=" + notification.referenceId();
    }
    if ("BOARD_LIST".equals(notification.referenceType()) && notification.referenceId() != null) {
      return "/?screen=board&listId=" + notification.referenceId();
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

  /** One target's send result; a null status releases the claim without an attempt. */
  private record TargetResult(
      UUID subscriptionId, String status, String error, boolean accepted, boolean deactivate) {
    static TargetResult released(UUID subscriptionId) {
      return new TargetResult(subscriptionId, null, null, false, false);
    }
  }

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
