ALTER TABLE notification_events
    DROP CONSTRAINT notification_events_actor_user_id_fkey,
    DROP CONSTRAINT notification_events_household_id_fkey,
    ADD CONSTRAINT fk_notification_events_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_notification_events_household
        FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL;

ALTER TABLE notifications
    DROP CONSTRAINT notifications_recipient_user_id_fkey,
    DROP CONSTRAINT notifications_event_id_fkey,
    ADD CONSTRAINT fk_notifications_recipient
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_notifications_event
        FOREIGN KEY (event_id) REFERENCES notification_events(id) ON DELETE SET NULL;
