ALTER TABLE households
    ADD COLUMN IF NOT EXISTS notification_style VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
        CHECK (notification_style IN ('NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')),
    ADD COLUMN IF NOT EXISTS reminder_mode VARCHAR(20) NOT NULL DEFAULT 'AGGRESSIVE'
        CHECK (reminder_mode IN ('FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'CUSTOM'));

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS chore_assigned_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS overdue_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notification_style_override VARCHAR(20)
        CHECK (notification_style_override IS NULL OR notification_style_override IN
            ('NORMAL', 'FUNNY', 'MOTIVATIONAL', 'COMPETITIVE', 'MINIMAL')),
    ADD COLUMN IF NOT EXISTS competitive_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notification_preferences
    ALTER COLUMN chore_reminders_enabled SET DEFAULT TRUE,
    ALTER COLUMN chore_completion_enabled SET DEFAULT TRUE,
    ALTER COLUMN household_updates_enabled SET DEFAULT TRUE,
    ALTER COLUMN funny_notifications_enabled SET DEFAULT FALSE,
    ALTER COLUMN push_enabled SET DEFAULT FALSE;
