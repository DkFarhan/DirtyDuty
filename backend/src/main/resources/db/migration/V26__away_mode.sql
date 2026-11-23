-- E10 Away mode: a member's away period in one household, and what it changed on occurrences.

-- One row per away period. Dates are inclusive and in the household's time zone. A member has at
-- most one current-or-upcoming period; overlaps are rejected by the service under the household
-- lock (the same lock every writer of a household's periods takes).
CREATE TABLE member_away_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    -- "Until I'm back": ends_on is the 90-day limit, and the person is reminded the day before.
    until_back BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The Board heads-up posted with it, kept in step with its dates.
    board_post_id UUID REFERENCES board_posts(id) ON DELETE SET NULL,
    -- The "Your away mode ends tomorrow" reminder, sent once per end date.
    ending_reminder_for DATE,
    -- When the member's rotation standing was brought level on their return (once per period).
    levelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_member_away_dates CHECK (ends_on >= starts_on),
    CONSTRAINT ck_member_away_length CHECK (ends_on - starts_on <= 90)
);

CREATE INDEX ix_member_away_household_user ON member_away_periods (household_id, user_id, ends_on);
CREATE INDEX ix_member_away_ends_on ON member_away_periods (ends_on);

-- Occurrences changed because someone was away. away_paused: skipped because everyone who would
-- do it is away (it comes back if the dates change, counts for nobody, and isn't shown in
-- Upcoming). away_from_user_id: whose slot was covered, for the card note.
ALTER TABLE chore_assignments
    ADD COLUMN away_paused BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN away_from_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- A heads-up that stays on the Board until a date (the away notice) instead of for 7 days.
ALTER TABLE board_posts
    ADD COLUMN active_until DATE,
    ADD CONSTRAINT ck_board_post_active_until CHECK (active_until IS NULL OR type = 'HEADS_UP');

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES ('AWAY_MODE_ENDING', 'SYSTEM', 'Your away mode ends tomorrow',
        'Welcome back {return_day}. Your turns start again then.');
