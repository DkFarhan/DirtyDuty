package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WebPushNotificationProviderTest {
  @Test
  void chorePushUsesAnInternalMyChoresDeepLinkWithAssignmentId() {
    UUID assignmentId = UUID.randomUUID();
    NotificationMessage notification =
        new NotificationMessage(
            UUID.randomUUID(),
            "CHORE_DUE_SOON",
            "CHORE_REMINDER",
            "NORMAL",
            "Chore reminder",
            "Clean the kitchen",
            "CHORE_ASSIGNMENT",
            assignmentId,
            OffsetDateTime.now(),
            OffsetDateTime.now().plusHours(1),
            "dedup-key");

    assertThat(WebPushNotificationProvider.targetPath(notification))
        .isEqualTo("/?screen=my-chores&assignmentId=" + assignmentId);
  }

  @Test
  void householdAndGenericPushesUseOnlyInternalRoutes() {
    NotificationMessage household =
        new NotificationMessage(
            UUID.randomUUID(),
            "HOUSEHOLD_JOINED",
            "HOUSEHOLD",
            "NORMAL",
            "Household update",
            "A member joined",
            "HOUSEHOLD",
            UUID.randomUUID(),
            null,
            null,
            "household-key");
    NotificationMessage generic =
        new NotificationMessage(
            UUID.randomUUID(),
            "SYSTEM",
            "GENERAL",
            "NORMAL",
            "Update",
            "Something changed",
            null,
            null,
            null,
            null,
            "generic-key");

    assertThat(WebPushNotificationProvider.targetPath(household)).isEqualTo("/?screen=household");
    assertThat(WebPushNotificationProvider.targetPath(generic)).isEqualTo("/?screen=notifications");
  }
}
