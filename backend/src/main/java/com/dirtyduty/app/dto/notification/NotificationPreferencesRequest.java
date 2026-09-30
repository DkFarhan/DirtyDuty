package com.dirtyduty.app.dto.notification;

import java.time.LocalTime;

public record NotificationPreferencesRequest(
        boolean choreRemindersEnabled,
        boolean choreCompletionEnabled,
        boolean householdUpdatesEnabled,
        LocalTime quietHoursStart,
        LocalTime quietHoursEnd,
        boolean funnyNotificationsEnabled,
        boolean pushEnabled) {}
