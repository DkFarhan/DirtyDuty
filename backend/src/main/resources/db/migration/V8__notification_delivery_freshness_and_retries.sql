ALTER TABLE notifications
    ADD COLUMN expires_at TIMESTAMPTZ;

ALTER TABLE notification_deliveries
    ADD COLUMN next_attempt_at TIMESTAMPTZ;

INSERT INTO notification_templates (event_type, style, title_template, message_template)
VALUES
    ('CHORE_DUE_SOON', 'SYSTEM', 'Chore coming up', '{chore_name} is due at {due_time}.'),
    ('CHORE_DUE_NOW', 'SYSTEM', 'Chore due now', '{chore_name} is due now.'),
    ('CHORE_OVERDUE', 'SYSTEM', 'Chore overdue', '{chore_name} is overdue.');

UPDATE notifications n
SET expires_at = CASE
    WHEN n.type = 'CHORE_DUE_SOON' AND n.scheduled_at < a.due_at - INTERVAL '12 hours'
        THEN a.due_at - INTERVAL '6 hours'
    WHEN n.type = 'CHORE_DUE_SOON' AND n.scheduled_at < a.due_at - INTERVAL '5 hours'
        THEN a.due_at - INTERVAL '1 hour'
    WHEN n.type = 'CHORE_DUE_SOON'
        THEN a.due_at
    WHEN n.type = 'CHORE_DUE_NOW'
        THEN a.due_at + INTERVAL '1 hour'
    WHEN n.type = 'CHORE_OVERDUE' AND n.scheduled_at <= a.due_at + INTERVAL '2 hours'
        THEN a.due_at + INTERVAL '3 hours'
    WHEN n.type = 'CHORE_OVERDUE'
        THEN n.scheduled_at + INTERVAL '24 hours'
    ELSE NULL
END
FROM chore_assignments a
WHERE n.reference_type = 'CHORE_ASSIGNMENT'
  AND n.reference_id = a.id
  AND n.status = 'PENDING'
  AND n.expires_at IS NULL
  AND n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE');
