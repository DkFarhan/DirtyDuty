-- Normalize occurrence assignees while retaining the legacy single-user
-- column for compatibility with pre-existing integrations.
CREATE TABLE chore_assignment_assignees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    assignment_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assignment_assignee UNIQUE (assignment_id, user_id),
    CONSTRAINT fk_assignment_assignee_occurrence
        FOREIGN KEY (assignment_id, household_id)
        REFERENCES chore_assignments(id, household_id) ON DELETE CASCADE,
    CONSTRAINT fk_assignment_assignee_member
        FOREIGN KEY (household_id, user_id)
        REFERENCES household_memberships(household_id, user_id)
);

INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
SELECT household_id, id, assigned_to_user_id
FROM chore_assignments
WHERE assigned_to_user_id IS NOT NULL
ON CONFLICT (assignment_id, user_id) DO NOTHING;

CREATE INDEX ix_assignment_assignees_user ON chore_assignment_assignees(user_id, assignment_id);
CREATE INDEX ix_assignment_assignees_household ON chore_assignment_assignees(household_id, assignment_id);
