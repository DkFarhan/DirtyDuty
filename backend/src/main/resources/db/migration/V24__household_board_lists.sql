-- Household Board, part 2: shared lists (Shopping and any others the house makes).
--
-- Every household has one default "Shopping" list, created the first time someone opens Lists (no
-- backfill). It can't be renamed or archived. Members can make up to 20 active lists; names are
-- unique per household among active lists, ignoring case. An archived list keeps its rows but
-- leaves the board, and its name can be used again.
--
-- Items are fully shared: any member adds, edits, deletes, claims ("I'll get it"), flags ("Need it
-- today") and buys them. An item is open while bought_at IS NULL; an open name appears once per
-- list (ignoring case). A bought item shows under "bought today" until the household's day ends and
-- is hard-deleted 24 hours after it was bought by the nightly retention job.
--
-- "Need it today" is the only list action that notifies: one push to every other member, at most
-- one per list per 30 minutes (board_lists.last_today_push_at). Flags set inside that window are
-- bundled into the next push (today_notified_at stays NULL until one carries them). A flag is for
-- one household day (needed_today_on) and clears when that day ends.
--
-- Items stay when the person who added them leaves ("Former member"); their claims are released.

CREATE TABLE board_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name VARCHAR(40) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    last_today_push_at TIMESTAMPTZ,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_board_list_id_household UNIQUE (id, household_id),
    -- Shopping is never archived.
    CONSTRAINT ck_board_list_default_active CHECK (NOT (is_default AND archived_at IS NOT NULL))
);

-- One default list per household.
CREATE UNIQUE INDEX ux_board_lists_default ON board_lists(household_id) WHERE is_default;

-- Active list names are unique per household, ignoring case and surrounding spaces.
CREATE UNIQUE INDEX ux_board_lists_active_name
    ON board_lists(household_id, lower(btrim(name)))
    WHERE archived_at IS NULL;

CREATE INDEX ix_board_lists_household_active
    ON board_lists(household_id, created_at)
    WHERE archived_at IS NULL;

CREATE TABLE board_list_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL,
    household_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    note VARCHAR(60) CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 60),
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    claimed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    claimed_at TIMESTAMPTZ,
    needed_today_at TIMESTAMPTZ,
    needed_today_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The household day the flag is for.
    needed_today_on DATE,
    -- Set once a push has carried this flag; NULL while it waits to be bundled into the next one.
    today_notified_at TIMESTAMPTZ,
    bought_at TIMESTAMPTZ,
    bought_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The household day it was bought on; it shows under "bought today" only on that day.
    bought_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_board_list_item_list
        FOREIGN KEY (list_id, household_id)
        REFERENCES board_lists(id, household_id) ON DELETE CASCADE,
    CONSTRAINT ck_board_list_item_claim
        CHECK (claimed_by_user_id IS NULL OR claimed_at IS NOT NULL),
    CONSTRAINT ck_board_list_item_today CHECK (
        (needed_today_at IS NULL) = (needed_today_on IS NULL)
        AND (needed_today_by_user_id IS NULL OR needed_today_at IS NOT NULL)
        AND (today_notified_at IS NULL OR needed_today_at IS NOT NULL)
    ),
    CONSTRAINT ck_board_list_item_bought CHECK (
        (bought_at IS NULL) = (bought_on IS NULL)
        AND (bought_by_user_id IS NULL OR bought_at IS NOT NULL)
    )
);

-- An open name is on a list once (adding it again highlights the existing item).
CREATE UNIQUE INDEX ux_board_list_items_open_name
    ON board_list_items(list_id, lower(btrim(name)))
    WHERE bought_at IS NULL;

CREATE INDEX ix_board_list_items_list_open
    ON board_list_items(list_id, created_at)
    WHERE bought_at IS NULL;

-- Bought today, and the purge 24 hours after buying.
CREATE INDEX ix_board_list_items_bought
    ON board_list_items(bought_at)
    WHERE bought_at IS NOT NULL;

-- Suggestions: names this household added, most recent first.
CREATE INDEX ix_board_list_items_household_recent
    ON board_list_items(household_id, created_at DESC);

-- Member exit releases claims; nightly clearing of stale Today flags.
CREATE INDEX ix_board_list_items_claimed
    ON board_list_items(household_id, claimed_by_user_id)
    WHERE claimed_by_user_id IS NOT NULL;

CREATE INDEX ix_board_list_items_needed_today
    ON board_list_items(household_id, needed_today_on)
    WHERE needed_today_on IS NOT NULL;

-- Names this household has added, for suggestions as someone types. Items are purged a day after
-- they're bought; the names stay (the most recent 200 per household are kept).
CREATE TABLE board_list_item_names (
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name_key VARCHAR(80) NOT NULL,
    name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    last_added_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (household_id, name_key)
);

CREATE INDEX ix_board_list_item_names_recent
    ON board_list_item_names(household_id, last_added_at DESC);

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('BOARD_LIST_NEEDED_TODAY', 'SYSTEM', '{list_name}', '{user_name} needs {item_names} today');
