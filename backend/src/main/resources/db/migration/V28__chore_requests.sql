-- E11 Hand-off and swap requests between members.
--
-- A current assignee asks someone (or anyone) to take one pending occurrence (HANDOFF), or offers
-- a trade for one of a member's pending occurrences in the next 14 days (SWAP). No admin approval.
-- A request is OPEN until it is accepted, declined, cancelled, or it expires (at the deadline, or
-- as soon as either occurrence changes: done, skipped, moved, given to someone else, cancelled).

CREATE TABLE chore_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK (type IN ('HANDOFF', 'SWAP')),
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')),
    requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- NULL: anyone eligible may take it (hand-offs only).
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    occurrence_id UUID NOT NULL REFERENCES chore_assignments(id) ON DELETE CASCADE,
    swap_occurrence_id UUID REFERENCES chore_assignments(id) ON DELETE CASCADE,
    -- What each occurrence looked like when asked (day, deadline, people sorted by id). Any change
    -- closes the request, so nobody accepts something that is no longer what was asked.
    occurrence_day DATE NOT NULL,
    occurrence_due_at TIMESTAMPTZ,
    occurrence_people UUID[] NOT NULL,
    swap_day DATE,
    swap_due_at TIMESTAMPTZ,
    swap_people UUID[],
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT ck_chore_request_swap
        CHECK ((type = 'SWAP') = (swap_occurrence_id IS NOT NULL)
               AND (type <> 'SWAP' OR (target_user_id IS NOT NULL AND swap_day IS NOT NULL
                                       AND swap_people IS NOT NULL))
               AND (swap_occurrence_id IS NULL OR swap_occurrence_id <> occurrence_id)),
    CONSTRAINT ck_chore_request_target CHECK (target_user_id IS DISTINCT FROM requester_user_id),
    CONSTRAINT ck_chore_request_resolved CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);

-- An occurrence is in at most one OPEN request, in either column. A value appearing in one column
-- of one request and the other column of another is rejected by the service, which checks both
-- columns under the household lock every writer takes.
CREATE UNIQUE INDEX uq_chore_request_open_occurrence
    ON chore_requests (occurrence_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX uq_chore_request_open_swap_occurrence
    ON chore_requests (swap_occurrence_id) WHERE status = 'OPEN' AND swap_occurrence_id IS NOT NULL;

CREATE INDEX ix_chore_requests_household_open ON chore_requests (household_id) WHERE status = 'OPEN';
CREATE INDEX ix_chore_requests_open_expiry ON chore_requests (expires_at) WHERE status = 'OPEN';
CREATE INDEX ix_chore_requests_requester ON chore_requests (requester_user_id, status);
CREATE INDEX ix_chore_requests_target ON chore_requests (target_user_id, status);

-- "Anyone" requests: who said no. It stays open for everyone else.
CREATE TABLE chore_request_declines (
    request_id UUID NOT NULL REFERENCES chore_requests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    declined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (request_id, user_id)
);

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('REQUEST_HANDOFF_ASK', 'SYSTEM', '{user_name} asks for a hand',
     'Can you take {chore_name} ({request_when})?'),
    ('REQUEST_SWAP_ASK', 'SYSTEM', '{user_name} wants to swap',
     'You do {chore_name} ({request_when}), {user_name} does your {other_chore} ({other_when}).'),
    ('REQUEST_ACCEPTED', 'SYSTEM', '{user_name} said yes', '{request_summary}'),
    ('REQUEST_DECLINED', 'SYSTEM', '{user_name} can''t this time', '{request_summary}'),
    ('REQUEST_UNCLAIMED', 'SYSTEM', 'Nobody has taken {chore_name} yet',
     'Your request ends {expires_when}. It stays yours until someone accepts.'),
    ('REQUEST_EXPIRED', 'SYSTEM', 'Your request for {chore_name} closed',
     '{chore_name} changed, so your request was closed.');
