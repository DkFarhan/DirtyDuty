-- DirtyDuty core schema
-- Flyway migration: V1__create_core_schema.sql
-- PostgreSQL 17+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (account_status IN ('ACTIVE', 'DISABLED', 'DELETED')),
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ux_users_email_lower ON users (LOWER(email));

-- ============================================================
-- HOUSEHOLDS
-- ============================================================
CREATE TABLE households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_households_created_by ON households(created_by_user_id);

-- ============================================================
-- HOUSEHOLD MEMBERSHIPS
-- Keep membership rows instead of deleting them so historical
-- assignments/completions remain valid when a member leaves.
-- ============================================================
CREATE TABLE household_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER'
        CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('INVITED', 'ACTIVE', 'LEFT', 'REMOVED')),
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_household_membership UNIQUE (household_id, user_id)
);

CREATE INDEX ix_memberships_user ON household_memberships(user_id);
CREATE INDEX ix_memberships_household_status ON household_memberships(household_id, status);

-- ============================================================
-- HOUSEHOLD INVITATIONS
-- ============================================================
CREATE TABLE household_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id),
    invite_code VARCHAR(80) NOT NULL,
    created_by_user_id UUID NOT NULL,
    role_to_assign VARCHAR(20) NOT NULL DEFAULT 'MEMBER'
        CHECK (role_to_assign IN ('ADMIN', 'MEMBER')),
    expires_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_household_invite_code UNIQUE (invite_code),
    CONSTRAINT fk_invitation_creator_membership
        FOREIGN KEY (household_id, created_by_user_id)
        REFERENCES household_memberships(household_id, user_id)
);

CREATE INDEX ix_invitations_household ON household_invitations(household_id);

-- ============================================================
-- CHORE CATEGORIES
-- Categories are household-specific so households can create
-- their own vocabulary and icons later.
-- ============================================================
CREATE TABLE chore_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id),
    name VARCHAR(80) NOT NULL,
    icon_key VARCHAR(80),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ux_category_name_per_household
    ON chore_categories (household_id, LOWER(name));

-- ============================================================
-- CHORES
-- A chore is the reusable definition/template.
-- Actual dated occurrences live in chore_assignments.
-- ============================================================
CREATE TABLE chores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id),
    category_id UUID REFERENCES chore_categories(id),
    title VARCHAR(160) NOT NULL,
    description TEXT,
    default_priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
        CHECK (default_priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    difficulty SMALLINT NOT NULL DEFAULT 1
        CHECK (difficulty BETWEEN 1 AND 5),
    estimated_minutes INTEGER
        CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    requires_verification BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_chore_id_household UNIQUE (id, household_id),
    CONSTRAINT fk_chore_creator_membership
        FOREIGN KEY (household_id, created_by_user_id)
        REFERENCES household_memberships(household_id, user_id)
);

CREATE INDEX ix_chores_household_active ON chores(household_id, is_active);
CREATE INDEX ix_chores_category ON chores(category_id);

-- ============================================================
-- CHORE SCHEDULES
-- Recurrence uses an RRULE-style string so we can support
-- weekly/monthly/custom recurrence without redesigning columns.
--
-- assignment_strategy examples:
-- MANUAL, FIXED, ROUND_ROBIN, RANDOM
--
-- strategy_config JSONB is intentionally flexible for future
-- rotation rules while core relational data stays normalized.
-- ============================================================
CREATE TABLE chore_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    chore_id UUID NOT NULL,
    recurrence_rule TEXT NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE,
    due_time TIME,
    assignment_strategy VARCHAR(30) NOT NULL DEFAULT 'MANUAL'
        CHECK (assignment_strategy IN ('MANUAL', 'FIXED', 'ROUND_ROBIN', 'RANDOM')),
    fixed_assignee_user_id UUID,
    strategy_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_schedule_chore
        FOREIGN KEY (chore_id, household_id)
        REFERENCES chores(id, household_id),
    CONSTRAINT fk_schedule_fixed_assignee
        FOREIGN KEY (household_id, fixed_assignee_user_id)
        REFERENCES household_memberships(household_id, user_id),
    CONSTRAINT ck_schedule_dates
        CHECK (ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT ck_fixed_strategy_requires_assignee
        CHECK (assignment_strategy <> 'FIXED' OR fixed_assignee_user_id IS NOT NULL)
);

CREATE INDEX ix_schedules_household_active
    ON chore_schedules(household_id, is_active);
CREATE INDEX ix_schedules_chore
    ON chore_schedules(chore_id);

-- ============================================================
-- CHORE ASSIGNMENTS
-- This is the concrete occurrence shown on "Today" / "This Week".
-- Snapshot fields preserve historical meaning even if the chore
-- template is edited later.
--
-- OVERDUE is intentionally NOT stored: it is derived from due_at
-- + status, preventing stale data.
-- ============================================================
CREATE TABLE chore_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    chore_id UUID NOT NULL,
    schedule_id UUID REFERENCES chore_schedules(id),
    assigned_to_user_id UUID,
    assigned_by_user_id UUID,
    scheduled_for DATE NOT NULL,
    due_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUBMITTED', 'COMPLETED', 'SKIPPED', 'CANCELLED')),

    title_snapshot VARCHAR(160) NOT NULL,
    priority_snapshot VARCHAR(20) NOT NULL
        CHECK (priority_snapshot IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    difficulty_snapshot SMALLINT NOT NULL
        CHECK (difficulty_snapshot BETWEEN 1 AND 5),
    estimated_minutes_snapshot INTEGER
        CHECK (estimated_minutes_snapshot IS NULL OR estimated_minutes_snapshot > 0),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_assignment_id_household UNIQUE (id, household_id),
    CONSTRAINT fk_assignment_chore
        FOREIGN KEY (chore_id, household_id)
        REFERENCES chores(id, household_id),
    CONSTRAINT fk_assignment_assignee
        FOREIGN KEY (household_id, assigned_to_user_id)
        REFERENCES household_memberships(household_id, user_id),
    CONSTRAINT fk_assignment_assigner
        FOREIGN KEY (household_id, assigned_by_user_id)
        REFERENCES household_memberships(household_id, user_id)
);

-- Prevent the scheduler from generating the same recurrence twice.
CREATE UNIQUE INDEX ux_schedule_occurrence
    ON chore_assignments(schedule_id, scheduled_for)
    WHERE schedule_id IS NOT NULL;

CREATE INDEX ix_assignments_assignee_day
    ON chore_assignments(assigned_to_user_id, scheduled_for);
CREATE INDEX ix_assignments_household_day
    ON chore_assignments(household_id, scheduled_for);
CREATE INDEX ix_assignments_due_pending
    ON chore_assignments(due_at)
    WHERE status IN ('PENDING', 'SUBMITTED');
CREATE INDEX ix_assignments_status
    ON chore_assignments(status);

-- ============================================================
-- CHORE COMPLETIONS
-- Separate history table instead of chore.completed = true.
-- Multiple attempts allow future proof/approval workflows.
-- ============================================================
CREATE TABLE chore_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    assignment_id UUID NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1
        CHECK (attempt_number > 0),
    completed_by_user_id UUID NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    verification_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED'
        CHECK (verification_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
    verified_by_user_id UUID,
    verified_at TIMESTAMPTZ,

    note TEXT,
    proof_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_completion_attempt UNIQUE (assignment_id, attempt_number),
    CONSTRAINT fk_completion_assignment
        FOREIGN KEY (assignment_id, household_id)
        REFERENCES chore_assignments(id, household_id),
    CONSTRAINT fk_completion_actor
        FOREIGN KEY (household_id, completed_by_user_id)
        REFERENCES household_memberships(household_id, user_id),
    CONSTRAINT fk_completion_verifier
        FOREIGN KEY (household_id, verified_by_user_id)
        REFERENCES household_memberships(household_id, user_id)
);

CREATE INDEX ix_completions_user_time
    ON chore_completions(completed_by_user_id, completed_at DESC);
CREATE INDEX ix_completions_household_time
    ON chore_completions(household_id, completed_at DESC);
CREATE INDEX ix_completions_assignment
    ON chore_completions(assignment_id);

-- ============================================================
-- ACTIVITY EVENTS
-- This is the extension spine for future XP, streaks, badges,
-- leaderboards, challenges and notifications.
--
-- It is NOT full event sourcing. Normal tables above remain the
-- source of truth. Events simply describe important things that
-- happened so later systems can react without redesigning core.
-- ============================================================
CREATE TABLE activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id),
    actor_user_id UUID,
    event_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80),
    entity_id UUID,
    event_key VARCHAR(180),
    correlation_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_activity_event_key UNIQUE (event_key),
    CONSTRAINT fk_activity_actor
        FOREIGN KEY (household_id, actor_user_id)
        REFERENCES household_memberships(household_id, user_id)
);

CREATE INDEX ix_activity_household_time
    ON activity_events(household_id, occurred_at DESC);
CREATE INDEX ix_activity_actor_time
    ON activity_events(actor_user_id, occurred_at DESC);
CREATE INDEX ix_activity_event_type_time
    ON activity_events(event_type, occurred_at DESC);
CREATE INDEX ix_activity_entity
    ON activity_events(entity_type, entity_id);
CREATE INDEX ix_activity_metadata_gin
    ON activity_events USING GIN(metadata);

-- ============================================================
-- Helpful comments documenting the intended extension points.
-- ============================================================
COMMENT ON TABLE chore_assignments IS
'Concrete chore occurrences. Snapshot columns preserve historical values for future scoring/statistics.';

COMMENT ON TABLE chore_completions IS
'Immutable-ish completion history used later for streaks, records, XP, badges, Dirt Map and analytics.';

COMMENT ON TABLE activity_events IS
'Extension spine for future gamification, challenges, notifications and social features without coupling them to core chore tables.';

COMMENT ON COLUMN chore_schedules.recurrence_rule IS
'RRULE-style recurrence definition, e.g. FREQ=WEEKLY;BYDAY=MO,TH.';

COMMENT ON COLUMN chore_schedules.strategy_config IS
'Flexible config for assignment strategies such as round-robin member ordering.';

COMMENT ON COLUMN activity_events.metadata IS
'Event-specific facts such as on-time completion, minutes early/late, difficulty snapshot and future feature context.';
