ALTER TABLE users
    ADD COLUMN terms_accepted_version VARCHAR(32),
    ADD COLUMN privacy_policy_accepted_version VARCHAR(32),
    ADD COLUMN legal_accepted_at TIMESTAMPTZ;
