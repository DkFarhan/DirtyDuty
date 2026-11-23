package com.dirtyduty.app.notification;

import com.dirtyduty.app.service.AwayPeriods;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class NotificationEngine {
  private final NotificationGenerator generator;
  private final List<NotificationDeliveryProvider> providers;
  private final AwayPeriods awayPeriods;

  public NotificationEngine(
      NotificationGenerator generator,
      List<NotificationDeliveryProvider> providers,
      AwayPeriods awayPeriods) {
    this.generator = generator;
    this.providers = providers;
    this.awayPeriods = awayPeriods;
  }

  public void process(NotificationEvent event, UUID eventId) {
    for (NotificationMessage message : generator.generate(event)) {
      // Away mode: no chore notifications for an away member's away days (E10).
      OffsetDateTime at =
          message.scheduledAt() == null
              ? OffsetDateTime.now(ZoneOffset.UTC)
              : message.scheduledAt();
      if (awayPeriods.suppresses(
          message.type(),
          message.referenceType(),
          message.referenceId(),
          message.recipientUserId(),
          at)) {
        continue;
      }
      for (NotificationDeliveryProvider provider : providers) {
        provider.deliver(message, eventId);
      }
    }
  }
}
