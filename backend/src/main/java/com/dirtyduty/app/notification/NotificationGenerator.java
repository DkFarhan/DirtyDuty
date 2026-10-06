package com.dirtyduty.app.notification;

import java.util.List;

public interface NotificationGenerator {
  List<NotificationMessage> generate(NotificationEvent event);
}
