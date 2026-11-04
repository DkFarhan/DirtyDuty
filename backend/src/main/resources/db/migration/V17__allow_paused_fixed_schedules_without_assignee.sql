ALTER TABLE chore_schedules
    DROP CONSTRAINT ck_fixed_strategy_requires_assignee;

ALTER TABLE chore_schedules
    ADD CONSTRAINT ck_fixed_strategy_requires_assignee
        CHECK (assignment_strategy <> 'FIXED' OR fixed_assignee_user_id IS NOT NULL OR is_active = FALSE);
