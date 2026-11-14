-- Single-occurrence actions (move, skip, reassign one chore date).
--
-- planned_for is the date the schedule's rule produced for an occurrence. scheduled_for and due_at
-- stay the effective values every read query uses; a moved occurrence keeps its planned_for, so
-- generation reconciles against the rule by planned_for and never cancels or recreates it.

ALTER TABLE chore_assignments ADD COLUMN planned_for DATE;

UPDATE chore_assignments SET planned_for = scheduled_for;

ALTER TABLE chore_assignments ALTER COLUMN planned_for SET NOT NULL;

-- Any insert that leaves planned_for out (older code paths, fixtures) plans the row on its own
-- scheduled date, which is what every occurrence meant before this migration.
CREATE FUNCTION chore_assignments_default_planned_for() RETURNS trigger AS $$
BEGIN
    NEW.planned_for := COALESCE(NEW.planned_for, NEW.scheduled_for);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chore_assignments_default_planned_for
    BEFORE INSERT ON chore_assignments
    FOR EACH ROW EXECUTE FUNCTION chore_assignments_default_planned_for();

-- Per-date overrides that series edits must keep while the planned date still exists.
ALTER TABLE chore_assignments
    ADD COLUMN date_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN assignees_overridden BOOLEAN NOT NULL DEFAULT FALSE;

-- One occurrence per planned date (was: per effective date).
DROP INDEX ux_schedule_occurrence;

CREATE UNIQUE INDEX ux_schedule_planned_occurrence
    ON chore_assignments(schedule_id, planned_for)
    WHERE schedule_id IS NOT NULL;

-- Keeps "is this day already taken" lookups by effective date fast.
CREATE INDEX ix_assignments_schedule_day
    ON chore_assignments(schedule_id, scheduled_for)
    WHERE schedule_id IS NOT NULL;

-- COUNT after a rule edit: the series continues from count_rebased_on (anchored on the original
-- starts_on, so intervals keep their weeks) and produces only COUNT - count_produced_before more.
ALTER TABLE chore_schedules
    ADD COLUMN count_rebased_on DATE,
    ADD COLUMN count_produced_before INTEGER,
    ADD CONSTRAINT ck_schedule_count_rebase
        CHECK ((count_rebased_on IS NULL) = (count_produced_before IS NULL)
               AND (count_produced_before IS NULL OR count_produced_before >= 0));

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('CHORE_OCCURRENCE_MOVED', 'SYSTEM', '{chore_name} moved', '{chore_name} moved to {new_date}'),
    ('CHORE_OCCURRENCE_SKIPPED', 'SYSTEM', '{chore_name} skipped',
     '{chore_name} on {original_day} was skipped');
