CREATE TABLE email_verification (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(320) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    delivery_state VARCHAR(16) NOT NULL
        CHECK (delivery_state IN ('PENDING', 'SENT', 'FAILED')),
    reclaimable BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX ix_email_verification_expiration ON email_verification(expires_at);

CREATE TABLE email_verification_rate_event (
    scope VARCHAR(32) NOT NULL
        CHECK (scope IN ('SEND_EMAIL', 'SEND_IP', 'VERIFY_EMAIL', 'VERIFY_IP')),
    subject_hash CHAR(64) NOT NULL,
    window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_email_verification_rate_window
    ON email_verification_rate_event(scope, window_seconds, subject_hash, requested_at);
