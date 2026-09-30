package com.dirtyduty.app.notification;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationEventService {
    private final JdbcTemplate jdbc;
    private final NotificationEngine engine;

    public NotificationEventService(JdbcTemplate jdbc, NotificationEngine engine) {
        this.jdbc = jdbc;
        this.engine = engine;
    }

    @Transactional
    public void publish(NotificationEvent event) {
        UUID eventId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO notification_events
                    (id, event_type, actor_user_id, household_id, reference_type,
                     reference_id, title, message, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                eventId, event.type(), event.actorUserId(), event.householdId(), event.referenceType(),
                event.referenceId(), event.type(), "", event.category());
        engine.process(event, eventId);
        jdbc.update("UPDATE notification_events SET processed_at=NOW() WHERE id=?", eventId);
    }
}
