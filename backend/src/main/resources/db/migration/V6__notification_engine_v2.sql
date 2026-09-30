ALTER TABLE households
    ADD COLUMN notification_style VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
        CHECK (notification_style IN ('NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')),
    ADD COLUMN reminder_mode VARCHAR(20) NOT NULL DEFAULT 'AGGRESSIVE'
        CHECK (reminder_mode IN ('FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'CUSTOM'));

ALTER TABLE notification_preferences
    ADD COLUMN notification_style_override VARCHAR(20)
        CHECK (notification_style_override IS NULL OR notification_style_override IN
            ('NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')),
    ADD COLUMN chore_assigned_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN overdue_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN competitive_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(60) NOT NULL,
    style VARCHAR(20) NOT NULL
        CHECK (style IN ('SYSTEM', 'NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')),
    title_template VARCHAR(200) NOT NULL,
    message_template TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_notification_templates_resolution
    ON notification_templates(event_type, style)
    WHERE enabled = TRUE;

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('CHORE_ASSIGNED', 'SYSTEM', 'Chore assigned', 'You have been assigned {chore_name}'),
    ('CHORE_COMPLETED', 'SYSTEM', 'Chore completed', '{user_name} completed {chore_name}'),
    ('HOUSEHOLD_JOINED', 'SYSTEM', 'Household update', '{user_name} joined your household'),
    ('INVITE_ACCEPTED', 'SYSTEM', 'Household update', '{user_name} accepted your invitation');

CREATE TABLE notification_reminder_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode VARCHAR(20) NOT NULL
        CHECK (mode IN ('FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'CUSTOM')),
    event_type VARCHAR(60) NOT NULL,
    minutes_before_due INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_reminder_rule UNIQUE (mode, event_type, minutes_before_due)
);

INSERT INTO notification_reminder_rules (mode, event_type, minutes_before_due)
VALUES
    ('AGGRESSIVE', 'CHORE_DUE_SOON', 1440),
    ('AGGRESSIVE', 'CHORE_DUE_SOON', 360),
    ('AGGRESSIVE', 'CHORE_DUE_SOON', 60),
    ('AGGRESSIVE', 'CHORE_DUE_NOW', 0),
    ('AGGRESSIVE', 'CHORE_OVERDUE', -60),
    ('AGGRESSIVE', 'CHORE_OVERDUE', -180);

CREATE TABLE notification_cooldown_policies (
    event_type VARCHAR(60) PRIMARY KEY,
    window_minutes INTEGER NOT NULL CHECK (window_minutes > 0),
    max_notifications INTEGER NOT NULL CHECK (max_notifications > 0),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO notification_cooldown_policies (event_type, window_minutes, max_notifications)
VALUES
    ('CHORE_DUE_SOON', 60, 1),
    ('CHORE_DUE_NOW', 60, 1),
    ('CHORE_OVERDUE', 60, 1);

CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    auth_secret TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX ix_push_subscriptions_user_active
    ON push_subscriptions(user_id)
    WHERE active = TRUE;

CREATE TABLE notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'WEB_PUSH')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_delivery_channel UNIQUE (notification_id, channel)
);

CREATE INDEX ix_notification_deliveries_pending
    ON notification_deliveries(channel, created_at)
    WHERE status = 'PENDING';
