ALTER TABLE chore_assignments
    ADD COLUMN cancelled_by_membership_exit BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE chore_assignments assignment
SET cancelled_by_membership_exit = TRUE
WHERE assignment.schedule_id IS NOT NULL
  AND assignment.status = 'CANCELLED'
  AND assignment.assigned_to_user_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM chore_assignment_assignees assignee
      WHERE assignee.assignment_id = assignment.id
  );
