CREATE TABLE auth_login_failure (
    scope VARCHAR(16) NOT NULL CHECK (scope IN ('ACCOUNT', 'IP')),
    subject_hash CHAR(64) NOT NULL,
    consecutive_failure_count INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failure_count BETWEEN 0 AND 100),
    window_started_at TIMESTAMPTZ NOT NULL,
    window_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (window_failure_count >= 0),
    last_failure_at TIMESTAMPTZ NOT NULL,
    cooldown_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, subject_hash)
);

CREATE INDEX ix_auth_login_failure_cleanup ON auth_login_failure(updated_at);
