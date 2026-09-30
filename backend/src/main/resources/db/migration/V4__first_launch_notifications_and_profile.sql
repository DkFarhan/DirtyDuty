ALTER TABLE households
    ADD COLUMN description TEXT;

CREATE TABLE notification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(60) NOT NULL,
    actor_user_id UUID REFERENCES users(id),
    household_id UUID REFERENCES households(id),
    reference_type VARCHAR(60),
    reference_id UUID,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(40) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX ix_notification_events_unprocessed
    ON notification_events(created_at)
    WHERE processed_at IS NULL;

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL REFERENCES users(id),
    event_id UUID REFERENCES notification_events(id),
    type VARCHAR(60) NOT NULL,
    category VARCHAR(40) NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    reference_type VARCHAR(60),
    reference_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deduplication_key VARCHAR(200) NOT NULL UNIQUE
);

CREATE INDEX ix_notifications_recipient_created
    ON notifications(recipient_user_id, created_at DESC);
CREATE INDEX ix_notifications_recipient_unread
    ON notifications(recipient_user_id, created_at DESC)
    WHERE read_at IS NULL AND status = 'SENT';
CREATE INDEX ix_notifications_due
    ON notifications(scheduled_at)
    WHERE status = 'PENDING' AND scheduled_at IS NOT NULL;

CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chore_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    chore_completion_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    household_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    funny_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
