ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE external_auth_identity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    provider_email_at_link_time VARCHAR(320),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    CONSTRAINT uq_external_auth_provider_subject UNIQUE (provider, provider_subject),
    CONSTRAINT uq_external_auth_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX ix_external_auth_identity_user ON external_auth_identity(user_id);

CREATE TABLE password_reset_token (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    CONSTRAINT ck_password_reset_expiration CHECK (expires_at > created_at)
);

CREATE INDEX ix_password_reset_token_user_active
    ON password_reset_token(user_id, expires_at)
    WHERE used_at IS NULL;

CREATE TABLE auth_rate_limit_bucket (
    scope VARCHAR(32) NOT NULL,
    subject_hash CHAR(64) NOT NULL,
    window_start BIGINT NOT NULL,
    request_count INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, subject_hash, window_start)
);

CREATE INDEX ix_auth_rate_limit_cleanup ON auth_rate_limit_bucket(updated_at);
