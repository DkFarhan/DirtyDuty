package com.dirtyduty.app.dto.notification;

import jakarta.validation.constraints.Pattern;
import java.time.LocalTime;

public record NotificationPreferencesRequest(
    boolean choreAssignedEnabled,
    boolean choreRemindersEnabled,
    boolean overdueEnabled,
    boolean choreCompletionEnabled,
    boolean householdUpdatesEnabled,
    LocalTime quietHoursStart,
    LocalTime quietHoursEnd,
    /*
     * Null (older clients): on when both times are given. On without times starts at 10 PM–8 AM.
     */
    Boolean quietHoursEnabled,
    @Pattern(regexp = "NORMAL|FUNNY|MOTIVATIONAL|COMPETITIVE|MINIMAL")
        String notificationStyleOverride,
    boolean funnyNotificationsEnabled,
    boolean competitiveNotificationsEnabled,
    boolean pushEnabled) {}
