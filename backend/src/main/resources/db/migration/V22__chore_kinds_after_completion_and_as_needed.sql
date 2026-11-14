-- Chore kinds: "After it's done" (AFTER_COMPLETION) and "When needed" (AS_NEEDED) next to the
-- existing calendar chores (CALENDAR, which includes one-time FREQ=ONCE chores).
--
-- Both new kinds keep exactly one open occurrence (PENDING or SUBMITTED); the next one is created
-- when it is completed (or skipped), dated from that day. Every existing schedule and occurrence
-- becomes CALENDAR, so nothing changes for them.
--
-- Settings are real columns rather than strategy_config keys so the database can check them per
-- kind. strategy_config keeps assignment data only (participants, peopleNeeded, and the per-person
-- turn offsets that let a late joiner start level).

ALTER TABLE chore_schedules
    ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'CALENDAR'
        CHECK (kind IN ('CALENDAR', 'AFTER_COMPLETION', 'AS_NEEDED')),
    ADD COLUMN interval_count INTEGER,
    ADD COLUMN interval_unit VARCHAR(10) CHECK (interval_unit IN ('DAY', 'WEEK')),
    ADD COLUMN backstop_days INTEGER;

-- Only calendar chores have a recurrence rule.
ALTER TABLE chore_schedules ALTER COLUMN recurrence_rule DROP NOT NULL;

ALTER TABLE chore_schedules
    ADD CONSTRAINT ck_schedule_kind_settings CHECK (
        (kind = 'CALENDAR'
            AND recurrence_rule IS NOT NULL
            AND interval_count IS NULL AND interval_unit IS NULL AND backstop_days IS NULL)
        OR (kind = 'AFTER_COMPLETION'
            AND recurrence_rule IS NULL AND ends_on IS NULL AND backstop_days IS NULL
            AND count_rebased_on IS NULL
            AND ((interval_unit = 'DAY' AND interval_count BETWEEN 1 AND 365)
                 OR (interval_unit = 'WEEK' AND interval_count BETWEEN 1 AND 52)))
        OR (kind = 'AS_NEEDED'
            AND recurrence_rule IS NULL AND ends_on IS NULL
            AND interval_count IS NULL AND interval_unit IS NULL AND count_rebased_on IS NULL
            AND (backstop_days IS NULL OR backstop_days BETWEEN 1 AND 30))
    );

-- The kind an occurrence was created under. A kind change keeps history rows as they were.
ALTER TABLE chore_assignments
    ADD COLUMN kind_snapshot VARCHAR(20) NOT NULL DEFAULT 'CALENDAR'
        CHECK (kind_snapshot IN ('CALENDAR', 'AFTER_COMPLETION', 'AS_NEEDED')),
    -- "Needs doing" (AS_NEEDED only): who flagged the open occurrence, and when.
    ADD COLUMN flagged_at TIMESTAMPTZ,
    ADD COLUMN flagged_by_user_id UUID,
    ADD CONSTRAINT fk_assignment_flagged_by
        FOREIGN KEY (household_id, flagged_by_user_id)
        REFERENCES household_memberships(household_id, user_id),
    ADD CONSTRAINT ck_assignment_flag
        CHECK ((flagged_at IS NULL) = (flagged_by_user_id IS NULL)
               AND (flagged_at IS NULL OR kind_snapshot = 'AS_NEEDED'));

-- One occurrence per planned date applies to calendar chores only. The new kinds may plan the
-- same day again (a repair after a member exit, or pause and activate on one day).
DROP INDEX ux_schedule_planned_occurrence;

CREATE UNIQUE INDEX ux_schedule_planned_occurrence
    ON chore_assignments(schedule_id, planned_for)
    WHERE schedule_id IS NOT NULL AND kind_snapshot = 'CALENDAR';

-- At most one open occurrence per AFTER_COMPLETION or AS_NEEDED schedule, so a double tap, two
-- members completing at once, or the hourly repair can never leave two open copies.
CREATE UNIQUE INDEX ux_schedule_single_open_occurrence
    ON chore_assignments(schedule_id)
    WHERE schedule_id IS NOT NULL AND kind_snapshot <> 'CALENDAR'
      AND status IN ('PENDING', 'SUBMITTED');

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('CHORE_NEEDS_DOING', 'SYSTEM', '{chore_name} needs doing',
     '{chore_name} needs doing. It''s your turn.'),
    ('CHORE_TURN', 'SYSTEM', 'Your turn', 'It''s your turn for {chore_name}.');
