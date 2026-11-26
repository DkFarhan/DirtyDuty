-- Checklists (E12): optional steps inside a chore, ticked per occurrence.

-- A chore's steps, in order. At most 15 (positions 0 to 14), each 1 to 80 characters.
CREATE TABLE chore_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chore_id UUID NOT NULL REFERENCES chores (id) ON DELETE CASCADE,
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 14),
    text VARCHAR(80) NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Deferred so a reorder can swap positions within one statement batch.
    CONSTRAINT uq_chore_steps_position UNIQUE (chore_id, position) DEFERRABLE INITIALLY DEFERRED
);

-- Ticks belong to one occurrence, so the next occurrence starts with none. A removed step takes
-- its ticks with it; who ticked stays when they leave ("Former member"), and becomes NULL when
-- their account is deleted.
CREATE TABLE chore_step_ticks (
    occurrence_id UUID NOT NULL REFERENCES chore_assignments (id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES chore_steps (id) ON DELETE CASCADE,
    ticked_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    ticked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (occurrence_id, step_id)
);

CREATE INDEX ix_chore_step_ticks_step ON chore_step_ticks (step_id);

-- What a completed occurrence had: "4 of 5 steps". NULL when the chore had no steps then.
ALTER TABLE chore_assignments
    ADD COLUMN steps_total SMALLINT,
    ADD COLUMN steps_ticked SMALLINT,
    ADD CONSTRAINT ck_chore_assignments_steps_snapshot CHECK (
        (steps_total IS NULL AND steps_ticked IS NULL)
        OR (steps_total BETWEEN 1 AND 15 AND steps_ticked BETWEEN 0 AND steps_total)
    );
