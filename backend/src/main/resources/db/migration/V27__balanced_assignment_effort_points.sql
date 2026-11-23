-- E8 Balanced assignment and fairness effort points.

-- A new Who option: whoever has done the least work lately. It is not offered for "When needed"
-- chores, which keep their turns.
ALTER TABLE chore_schedules DROP CONSTRAINT chore_schedules_assignment_strategy_check;
ALTER TABLE chore_schedules
    ADD CONSTRAINT chore_schedules_assignment_strategy_check
        CHECK (assignment_strategy IN ('MANUAL', 'FIXED', 'ROUND_ROBIN', 'RANDOM', 'BALANCED')),
    ADD CONSTRAINT ck_schedule_balanced_kind
        CHECK (assignment_strategy <> 'BALANCED' OR kind <> 'AS_NEEDED');

-- Fairness effort of each completion: the chore's effort (difficulty 1-5) when it was done, so a
-- later effort change never rewrites history. This is not a reward score; rewards (bonuses,
-- streaks) will be a separate number.
ALTER TABLE chore_completions ADD COLUMN effort_points SMALLINT;

UPDATE chore_completions c
SET effort_points = COALESCE(a.difficulty_snapshot, ch.difficulty, 1)
FROM chore_assignments a
LEFT JOIN chores ch ON ch.id = a.chore_id
WHERE a.id = c.assignment_id;

-- A completion without its occurrence cannot exist (foreign key); this only guards the NOT NULL.
UPDATE chore_completions SET effort_points = 1 WHERE effort_points IS NULL;

ALTER TABLE chore_completions
    ALTER COLUMN effort_points SET NOT NULL,
    ADD CONSTRAINT ck_completion_effort_points CHECK (effort_points BETWEEN 1 AND 5);

-- Pending work per day, read when Balanced picks someone.
CREATE INDEX IF NOT EXISTS ix_assignments_household_pending_day
    ON chore_assignments (household_id, scheduled_for)
    WHERE status = 'PENDING';
