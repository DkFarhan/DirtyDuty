package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DefaultNotificationGeneratorTest {
    @Test
    void rerunningReminderPlanningProducesTheSameDeduplicationKeyAndExpiry() {
        NotificationTemplateResolver resolver = mock(NotificationTemplateResolver.class);
        DefaultNotificationGenerator generator = new DefaultNotificationGenerator(resolver);
        UUID userId = UUID.randomUUID();
        UUID assignmentId = UUID.randomUUID();
        OffsetDateTime scheduledAt = OffsetDateTime.parse("2026-10-01T12:00:00Z");
        OffsetDateTime expiresAt = scheduledAt.plusHours(5);
        NotificationEvent event = new NotificationEvent(
                "CHORE_DUE_SOON", null, UUID.randomUUID(), "CHORE_ASSIGNMENT", assignmentId,
                "CHORE_REMINDER", Map.of(
                        "scheduled_at", scheduledAt.toString(),
                        "expires_at", expiresAt.toString()),
                List.of(userId));
        when(resolver.resolve(event, userId))
                .thenReturn(new NotificationTemplateResolver.ResolvedTemplate("Reminder", "Chore due soon"));

        NotificationMessage first = generator.generate(event).getFirst();
        NotificationMessage rerun = generator.generate(event).getFirst();

        assertThat(first.deduplicationKey()).isEqualTo(rerun.deduplicationKey());
        assertThat(first.scheduledAt()).isEqualTo(scheduledAt);
        assertThat(first.expiresAt()).isEqualTo(expiresAt);
        assertThat(first.deduplicationKey()).contains(assignmentId.toString(), userId.toString());
    }
}
