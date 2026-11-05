UPDATE notifications n
SET push_target_tracking_enabled=TRUE
FROM notification_deliveries d
WHERE d.notification_id=n.id
  AND d.channel='WEB_PUSH'
  AND d.status IN ('PENDING', 'FAILED')
  AND d.attempts<3
  AND n.status<>'CANCELLED'
  AND (n.expires_at IS NULL OR n.expires_at>NOW());

INSERT INTO notification_push_delivery_targets
    (notification_id, subscription_id, status, attempts, next_attempt_at)
SELECT d.notification_id, s.id, d.status, d.attempts, d.next_attempt_at
FROM notification_deliveries d
JOIN notifications n ON n.id=d.notification_id
JOIN push_subscriptions s
  ON s.user_id=n.recipient_user_id AND s.active=TRUE AND s.created_at<=d.created_at
WHERE d.channel='WEB_PUSH'
  AND d.status IN ('PENDING', 'FAILED')
  AND d.attempts>0 AND d.attempts<3
  AND n.push_target_tracking_enabled=TRUE;

UPDATE notification_deliveries d
SET push_targets_snapshotted_at=NOW()
FROM notifications n
WHERE d.notification_id=n.id
  AND d.channel='WEB_PUSH'
  AND d.status IN ('PENDING', 'FAILED')
  AND d.attempts>0 AND d.attempts<3
  AND n.push_target_tracking_enabled=TRUE;
