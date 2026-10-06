package com.dirtyduty.app.dto.notification;

import java.time.LocalTime;

public record NotificationPreferencesResponse(
    boolean choreAssignedEnabled,
    boolean choreRemindersEnabled,
    boolean overdueEnabled,
    boolean choreCompletionEnabled,
    boolean householdUpdatesEnabled,
    LocalTime quietHoursStart,
    LocalTime quietHoursEnd,
    String notificationStyleOverride,
    String householdNotificationStyle,
    boolean funnyNotificationsEnabled,
    boolean competitiveNotificationsEnabled,
    boolean pushEnabled) {}
