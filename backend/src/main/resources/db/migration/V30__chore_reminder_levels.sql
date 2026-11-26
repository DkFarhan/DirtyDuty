-- E13: per-chore reminder levels and a household default for new chores.
--
-- Levels (label -> mode): Off -> OFF, Light -> FRIENDLY, Standard -> STANDARD, Full -> AGGRESSIVE,
-- Intense -> INTENSE. CUSTOM stays allowed (unused).
--
-- Until now the reminder mode lived only on households (V6/V7, always AGGRESSIVE) and applied to
-- every chore. Each chore now carries its own mode; existing chores copy their household's mode,
-- so they keep exactly the reminders they had (Full). households.reminder_mode is no longer read.

-- 1. Widen every CHECK that limits a reminder mode (V6 and V7 each declared one; on a database
--    where both ran only one exists, so find them by definition rather than by name).
DO $$
DECLARE
    item RECORD;
BEGIN
    FOR item IN
        SELECT c.conname, c.conrelid::regclass AS table_name
        FROM pg_constraint c
        WHERE c.contype = 'c'
          AND c.conrelid IN ('households'::regclass, 'notification_reminder_rules'::regclass)
          AND pg_get_constraintdef(c.oid) LIKE '%AGGRESSIVE%'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.table_name, item.conname);
    END LOOP;
END $$;

ALTER TABLE households
    ADD CONSTRAINT households_reminder_mode_check
        CHECK (reminder_mode IN ('OFF', 'FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'INTENSE', 'CUSTOM'));

ALTER TABLE notification_reminder_rules
    ADD CONSTRAINT notification_reminder_rules_mode_check
        CHECK (mode IN ('OFF', 'FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'INTENSE', 'CUSTOM'));

-- 2. Rule sets (minutes before the due time; negative = after it). AGGRESSIVE is unchanged and
--    OFF has no rules. The three new sets are written exactly, replacing anything seeded by hand.
DELETE FROM notification_reminder_rules WHERE mode IN ('FRIENDLY', 'STANDARD', 'INTENSE');

INSERT INTO notification_reminder_rules (mode, event_type, minutes_before_due)
VALUES
    ('FRIENDLY', 'CHORE_DUE_NOW', 0),
    ('FRIENDLY', 'CHORE_OVERDUE', -720),
    ('STANDARD', 'CHORE_DUE_SOON', 360),
    ('STANDARD', 'CHORE_DUE_NOW', 0),
    ('STANDARD', 'CHORE_OVERDUE', -180),
    ('INTENSE', 'CHORE_DUE_SOON', 2880),
    ('INTENSE', 'CHORE_DUE_SOON', 1440),
    ('INTENSE', 'CHORE_DUE_SOON', 720),
    ('INTENSE', 'CHORE_DUE_SOON', 360),
    ('INTENSE', 'CHORE_DUE_SOON', 120),
    ('INTENSE', 'CHORE_DUE_SOON', 60),
    ('INTENSE', 'CHORE_DUE_NOW', 0),
    ('INTENSE', 'CHORE_OVERDUE', -60),
    ('INTENSE', 'CHORE_OVERDUE', -180),
    ('INTENSE', 'CHORE_OVERDUE', -360),
    ('INTENSE', 'CHORE_OVERDUE', -600);

-- 3. Each chore's own level. Existing chores keep their household's mode (AGGRESSIVE); chores
--    made from now on default to STANDARD unless the app sets the household default.
ALTER TABLE chores
    ADD COLUMN reminder_mode VARCHAR(20) NOT NULL DEFAULT 'AGGRESSIVE'
        CONSTRAINT chores_reminder_mode_check
        CHECK (reminder_mode IN ('OFF', 'FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'INTENSE', 'CUSTOM'));

UPDATE chores c SET reminder_mode = h.reminder_mode
FROM households h
WHERE h.id = c.household_id AND c.reminder_mode <> h.reminder_mode;

ALTER TABLE chores ALTER COLUMN reminder_mode SET DEFAULT 'STANDARD';

-- 4. The household default for new chores (owners and admins change it in settings).
ALTER TABLE households
    ADD COLUMN default_reminder_mode VARCHAR(20) NOT NULL DEFAULT 'STANDARD'
        CONSTRAINT households_default_reminder_mode_check
        CHECK (default_reminder_mode IN
            ('OFF', 'FRIENDLY', 'STANDARD', 'AGGRESSIVE', 'INTENSE', 'CUSTOM'));

COMMENT ON COLUMN households.reminder_mode IS
    'Legacy (V6). Reminder levels are per chore (chores.reminder_mode) since V30.';
