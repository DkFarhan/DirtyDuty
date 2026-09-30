package com.dirtyduty.app.notification;

import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;

public final class ReminderSchedulePlanner {
    private static final long FINAL_OVERDUE_WINDOW_HOURS = 24;

    private ReminderSchedulePlanner() {}

    public static List<PlannedReminder> plan(
            OffsetDateTime dueAt, List<ReminderRule> rules, OffsetDateTime planningTime) {
        List<ReminderRule> ordered = rules.stream()
                .sorted(Comparator.comparingInt(ReminderRule::minutesBeforeDue).reversed())
                .toList();
        return java.util.stream.IntStream.range(0, ordered.size())
                .mapToObj(index -> {
                    ReminderRule rule = ordered.get(index);
                    OffsetDateTime scheduledAt = dueAt.minusMinutes(rule.minutesBeforeDue());
                    if (scheduledAt.isBefore(planningTime)) {
                        return null;
                    }
                    OffsetDateTime expiresAt = index + 1 < ordered.size()
                            ? dueAt.minusMinutes(ordered.get(index + 1).minutesBeforeDue())
                            : scheduledAt.plusHours(FINAL_OVERDUE_WINDOW_HOURS);
                    if ("CHORE_DUE_SOON".equals(rule.eventType()) && dueAt.isBefore(expiresAt)) {
                        expiresAt = dueAt;
                    } else if ("CHORE_DUE_NOW".equals(rule.eventType())
                            && dueAt.plusHours(1).isBefore(expiresAt)) {
                        expiresAt = dueAt.plusHours(1);
                    }
                    return new PlannedReminder(rule, scheduledAt, expiresAt);
                })
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    public record ReminderRule(String eventType, int minutesBeforeDue) {}

    public record PlannedReminder(ReminderRule rule, OffsetDateTime scheduledAt, OffsetDateTime expiresAt) {}
}
