-- Household Board, part 1: posts (events, problems and heads-ups) that every active member sees.
--
-- A post is active while past_at IS NULL. It becomes Past when an event's date has ended (in the
-- household's time zone), a heads-up is 7 days old, or a problem is marked fixed; a pinned post
-- never does. past_at is set lazily when the board is read and by the nightly retention job, which
-- also hard-deletes posts that have been Past for 30 days (recipients and reads go with them).
--
-- Posts stay when their author leaves or deletes their account: exit removes the person's
-- recipient and read rows and releases any problem they were handling; account deletion also
-- clears author_user_id and fixed_by_user_id so the post shows "Former member".

CREATE TABLE board_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('EVENT', 'PROBLEM', 'HEADS_UP')),
    title VARCHAR(120) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    details TEXT CHECK (details IS NULL OR char_length(details) <= 2000),
    event_date DATE,
    start_time TIME,
    end_time TIME,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    notify_mode VARCHAR(20) NOT NULL DEFAULT 'EVERYONE'
        CHECK (notify_mode IN ('EVERYONE', 'PICKED', 'NONE')),
    handler_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    fixed_at TIMESTAMPTZ,
    fixed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Remind (the author or an owner/admin): at most once per post per 2 hours.
    last_reminded_at TIMESTAMPTZ,
    past_at TIMESTAMPTZ,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Only events have a date, and every event has one; times are optional (all day).
    CONSTRAINT ck_board_post_event_date CHECK ((type = 'EVENT') = (event_date IS NOT NULL)),
    CONSTRAINT ck_board_post_times CHECK (
        (start_time IS NULL OR type = 'EVENT')
        AND (end_time IS NULL OR (start_time IS NOT NULL AND end_time > start_time))
    ),
    -- Only problems have a handler or get fixed; a fixed post keeps when, and by whom unless the
    -- account was deleted.
    CONSTRAINT ck_board_post_problem CHECK (
        (handler_user_id IS NULL OR type = 'PROBLEM')
        AND (fixed_at IS NULL OR type = 'PROBLEM')
        AND (fixed_by_user_id IS NULL OR fixed_at IS NOT NULL)
    ),
    -- Pinned house info never moves to Past.
    CONSTRAINT ck_board_post_pinned_active CHECK (NOT (pinned AND past_at IS NOT NULL))
);

CREATE INDEX ix_board_posts_household_active
    ON board_posts(household_id, created_at DESC)
    WHERE past_at IS NULL;

CREATE INDEX ix_board_posts_household_past
    ON board_posts(household_id, past_at DESC)
    WHERE past_at IS NOT NULL;

-- The nightly purge.
CREATE INDEX ix_board_posts_past_at
    ON board_posts(past_at)
    WHERE past_at IS NOT NULL;

-- notify_mode = PICKED: who is notified and reminded. Everyone can still see the post.
CREATE TABLE board_post_recipients (
    post_id UUID NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX ix_board_post_recipients_user ON board_post_recipients(user_id);

-- Seen is recorded automatically; Got it is an explicit tap and implies seen. The author has no
-- row: they count as seen.
CREATE TABLE board_post_reads (
    post_id UUID NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at TIMESTAMPTZ NOT NULL,
    got_it_at TIMESTAMPTZ,
    CONSTRAINT uq_board_post_read UNIQUE (post_id, user_id)
);

CREATE INDEX ix_board_post_reads_user ON board_post_reads(user_id);

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('BOARD_POST_NEW', 'SYSTEM', '{user_name} posted', '{post_title}{post_when}'),
    ('BOARD_POST_CHANGED', 'SYSTEM', '{post_title} moved', '{post_title} moved to {post_when_long}'),
    ('BOARD_EVENT_REMINDER', 'SYSTEM', 'Coming up: {post_title}',
     '{post_title} is {reminder_when}.'),
    ('BOARD_POST_REMIND', 'SYSTEM', 'Have you seen this?', '{user_name} asked you to read: {post_title}');
