-- Quiet hours (E14). People could already save quiet_hours_start/end (V4); now they hold pushes.
--
-- Off by default. Someone who saved both times before chose them, so they start enabled; rows
-- without times, and people without a preferences row, stay off. The times are kept when quiet
-- hours are switched off, so switching back on restores them.

ALTER TABLE notification_preferences
    ADD COLUMN quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- A start equal to its end, or only one of the two, never described a window: clear it.
UPDATE notification_preferences
SET quiet_hours_start = NULL, quiet_hours_end = NULL
WHERE (quiet_hours_start IS NULL) <> (quiet_hours_end IS NULL)
   OR quiet_hours_start = quiet_hours_end;

UPDATE notification_preferences
SET quiet_hours_enabled = TRUE
WHERE quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL
  AND quiet_hours_start <> quiet_hours_end;

-- A window has a start and an end, and they differ (a window may cross midnight).
ALTER TABLE notification_preferences
    ADD CONSTRAINT ck_notification_preferences_quiet_hours CHECK (
        (quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)
        AND (quiet_hours_start IS NULL OR quiet_hours_start <> quiet_hours_end)
        AND (NOT quiet_hours_enabled OR quiet_hours_start IS NOT NULL)
    );

-- A push due during the recipient's quiet hours waits on its WEB_PUSH delivery row until the end
-- of their window. next_attempt_at is set to the same time so the scheduler picks the row up
-- then; quiet_held_until marks it as held (not a retry), so the morning release can clean up,
-- collapse and group everything held for one person instead of sending it piece by piece.
-- The in-app row (notifications.status = 'SENT') is created right away as before.
ALTER TABLE notification_deliveries
    ADD COLUMN quiet_held_until TIMESTAMPTZ;

CREATE INDEX ix_notification_deliveries_quiet_held
    ON notification_deliveries(quiet_held_until)
    WHERE quiet_held_until IS NOT NULL AND status = 'PENDING';

-- The morning's grouped pushes ("Take out organic is overdue, plus 2 more chores today"). They
-- are push-only: they never appear in the notification list or the unread count, whose rows stay
-- as they were. At most two per person per window: chores, then everything else 5 minutes later.
CREATE TABLE notification_push_digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('CHORES', 'OTHER')),
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    target_path VARCHAR(200) NOT NULL,
    -- The end of the window it was held for; one digest of each kind per window.
    window_end TIMESTAMPTZ NOT NULL,
    send_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_push_digest UNIQUE (recipient_user_id, window_end, kind)
);

CREATE INDEX ix_notification_push_digests_due
    ON notification_push_digests(send_at)
    WHERE status = 'PENDING';

-- Urgent board posts notify everyone even during quiet hours (creation push and Remind). Any
-- member may post one urgent post an hour.
ALTER TABLE board_posts
    ADD COLUMN urgent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX ix_board_posts_urgent_author
    ON board_posts(author_user_id, created_at DESC)
    WHERE urgent;
