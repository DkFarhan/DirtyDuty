ALTER TABLE push_subscriptions
    ADD COLUMN last_client_confirmed_at TIMESTAMPTZ;
