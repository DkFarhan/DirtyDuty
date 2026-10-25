CREATE TABLE recurring_chore_assignment_announcements (
    schedule_id UUID NOT NULL REFERENCES chore_schedules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (schedule_id, user_id)
);

-- Existing schedules are already known to their current participants; seed the
-- ledger so deploying this migration does not announce every existing schedule.
INSERT INTO recurring_chore_assignment_announcements (schedule_id, user_id)
SELECT s.id, participant.user_id::UUID
FROM chore_schedules s
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
        WHEN jsonb_typeof(s.strategy_config -> 'participantUserIds') = 'array'
            THEN s.strategy_config -> 'participantUserIds'
        ELSE '[]'::jsonb
    END
) AS participant(user_id)
WHERE s.recurrence_rule <> 'FREQ=ONCE'
ON CONFLICT (schedule_id, user_id) DO NOTHING;

INSERT INTO recurring_chore_assignment_announcements (schedule_id, user_id)
SELECT id, fixed_assignee_user_id
FROM chore_schedules
WHERE recurrence_rule <> 'FREQ=ONCE'
  AND fixed_assignee_user_id IS NOT NULL
ON CONFLICT (schedule_id, user_id) DO NOTHING;

INSERT INTO recurring_chore_assignment_announcements (schedule_id, user_id)
SELECT DISTINCT a.schedule_id, aa.user_id
FROM chore_assignments a
JOIN chore_assignment_assignees aa ON aa.assignment_id = a.id
WHERE a.schedule_id IS NOT NULL
  AND a.schedule_id IN (
      SELECT id FROM chore_schedules WHERE recurrence_rule <> 'FREQ=ONCE'
  )
ON CONFLICT (schedule_id, user_id) DO NOTHING;
