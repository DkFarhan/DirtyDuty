ALTER TABLE notifications
    ADD COLUMN push_target_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE notifications
    ALTER COLUMN push_target_tracking_enabled SET DEFAULT TRUE;

ALTER TABLE notification_deliveries
    ADD COLUMN push_targets_snapshotted_at TIMESTAMPTZ;

CREATE TABLE notification_push_delivery_targets (
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ,
    last_error VARCHAR(40),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, subscription_id)
);

CREATE INDEX ix_notification_push_delivery_targets_retry
    ON notification_push_delivery_targets(next_attempt_at, notification_id)
    WHERE status IN ('PENDING', 'FAILED');

CREATE TABLE push_test_notification_limits (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_attempt_at TIMESTAMPTZ NOT NULL
);
