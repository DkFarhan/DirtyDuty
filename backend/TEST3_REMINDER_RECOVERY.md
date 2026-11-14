# Test3 one-time reminder recovery proposal

**Review only. Do not run against production before the deadline-comparison fix is
deployed and reviewed.** This is not a migration or an automatic repair. The
historical cancellation caller is not recorded, so this proposal does not
attribute the cancellation to a particular caller.

The target is assignment
`04a0974f-fb25-47f8-a057-9254a8c00b0e` (Test3). First run this read-only
diagnostic against the intended database:

```sql
WITH target AS (
    SELECT a.id AS assignment_id, a.household_id, a.chore_id, a.schedule_id,
           a.scheduled_for, a.due_at, a.status AS assignment_status,
           s.recurrence_rule, s.timezone, s.starts_on, s.ends_on, s.due_time,
           s.is_active AS schedule_active, h.reminder_mode,
           c.is_active AS chore_active, c.archived_at,
           (a.scheduled_for + s.due_time) AT TIME ZONE s.timezone AS schedule_due_at
    FROM chore_assignments a
    LEFT JOIN chore_schedules s ON s.id=a.schedule_id
    LEFT JOIN households h ON h.id=a.household_id
    LEFT JOIN chores c ON c.id=a.chore_id AND c.household_id=a.household_id
    WHERE a.id='04a0974f-fb25-47f8-a057-9254a8c00b0e'::uuid
),
assignees AS (
    SELECT DISTINCT user_id
    FROM (
        SELECT aa.user_id
        FROM target a
        JOIN chore_assignment_assignees aa ON aa.assignment_id=a.assignment_id
        UNION
        SELECT assignment.assigned_to_user_id
        FROM target a
        JOIN chore_assignments assignment ON assignment.id=a.assignment_id
        WHERE assignment.assigned_to_user_id IS NOT NULL
    ) assigned
)
SELECT a.assignment_id, a.assignment_status, a.household_id, a.schedule_id,
       a.recurrence_rule, a.schedule_active, a.chore_active, a.archived_at,
       a.scheduled_for, a.starts_on, a.ends_on, a.timezone, a.due_time,
       a.due_at, a.schedule_due_at,
       aa.user_id AS current_assignee_id, membership.status AS membership_status,
       n.id AS notification_id, n.type, n.status AS notification_status,
       n.scheduled_at, n.expires_at, n.sent_at,
       rule.minutes_before_due, rule.enabled AS reminder_rule_enabled,
       (rule.enabled
        AND n.scheduled_at=a.due_at - make_interval(mins => rule.minutes_before_due))
           AS matches_current_rule_time,
       planned_window.expected_expires_at,
       (n.expires_at=planned_window.expected_expires_at
        AND n.expires_at>NOW()) AS reminder_window_open,
       COALESCE(preference.chore_reminders_enabled, TRUE) AS reminders_enabled,
       COALESCE(preference.overdue_enabled, TRUE) AS overdue_enabled,
       COALESCE(preference.push_enabled, FALSE) AS push_enabled,
       delivery.channel, delivery.status AS delivery_status, delivery.attempts,
       delivery.sent_at AS delivery_sent_at, delivery.next_attempt_at,
       delivery.push_targets_snapshotted_at,
       (SELECT string_agg(
                   format('%s attempts=%s sent_at=%s active=%s next_attempt_at=%s',
                          target.status, target.attempts, target.sent_at,
                          subscription.active, target.next_attempt_at),
                   '; ' ORDER BY subscription.id)
        FROM notification_push_delivery_targets target
        JOIN push_subscriptions subscription ON subscription.id=target.subscription_id
        WHERE target.notification_id=n.id) AS push_target_history,
       (SELECT count(*) FROM push_subscriptions subscription
        WHERE subscription.user_id=n.recipient_user_id AND subscription.active=TRUE)
           AS active_push_subscriptions
FROM target a
LEFT JOIN assignees aa ON TRUE
LEFT JOIN household_memberships membership
  ON membership.household_id=a.household_id AND membership.user_id=aa.user_id
LEFT JOIN notifications n
  ON n.reference_type='CHORE_ASSIGNMENT'
 AND n.reference_id=a.assignment_id
 AND n.recipient_user_id=aa.user_id
 AND n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
LEFT JOIN notification_reminder_rules rule
  ON rule.mode=a.reminder_mode AND rule.event_type=n.type
 AND n.scheduled_at=a.due_at - make_interval(mins => rule.minutes_before_due)
LEFT JOIN LATERAL (
    SELECT a.due_at - make_interval(mins => MAX(next_rule.minutes_before_due))
               AS next_schedule
    FROM notification_reminder_rules next_rule
    WHERE next_rule.mode=a.reminder_mode
      AND next_rule.enabled=TRUE
      AND next_rule.minutes_before_due<rule.minutes_before_due
) next_rule ON TRUE
LEFT JOIN LATERAL (
    SELECT CASE
        WHEN n.type='CHORE_DUE_SOON'
             AND a.due_at<COALESCE(next_rule.next_schedule, n.scheduled_at + INTERVAL '24 hours')
            THEN a.due_at
        WHEN n.type='CHORE_DUE_NOW'
             AND a.due_at + INTERVAL '1 hour'
                 < COALESCE(next_rule.next_schedule, n.scheduled_at + INTERVAL '24 hours')
            THEN a.due_at + INTERVAL '1 hour'
        ELSE COALESCE(next_rule.next_schedule, n.scheduled_at + INTERVAL '24 hours')
    END AS expected_expires_at
) planned_window ON TRUE
LEFT JOIN notification_preferences preference ON preference.user_id=n.recipient_user_id
LEFT JOIN notification_deliveries delivery ON delivery.notification_id=n.id
ORDER BY n.type, n.scheduled_at, n.id, delivery.channel;
```

Consider a notification only if the assignment is still `PENDING`, the schedule
is active and still `FREQ=ONCE`, the chore is active and not archived, the
assignment date still matches the schedule date, and its stored deadline still
matches the schedule's local date/time in `America/Halifax`. Its recipient must
still be a current assignee with `ACTIVE` household membership. The matching
reminder rule must still be enabled and the notification must still be within
its stored expiry window.

## Proposed manual repair

For review after deployment only, this draft selects eligible rows in a
transaction-local table. It rechecks current assignment/schedule/chore state,
active assignees and memberships, enabled reminder rules, the exact schedule
window, notification expiry, preferences, and the absence of accepted/sent
history. Review the selected IDs and diagnostic output before continuing:

```sql
BEGIN;

CREATE TEMP TABLE eligible_test3_reminders ON COMMIT DROP AS
WITH target AS (
    SELECT a.id AS assignment_id, a.household_id, a.chore_id, a.schedule_id,
           a.scheduled_for, a.due_at, a.status AS assignment_status,
           s.recurrence_rule, s.timezone, s.starts_on, s.ends_on, s.due_time,
           s.is_active AS schedule_active, h.reminder_mode,
           c.is_active AS chore_active, c.archived_at
    FROM chore_assignments a
    JOIN chore_schedules s ON s.id=a.schedule_id AND s.household_id=a.household_id
    JOIN households h ON h.id=a.household_id
    JOIN chores c ON c.id=a.chore_id AND c.household_id=a.household_id
    WHERE a.id='04a0974f-fb25-47f8-a057-9254a8c00b0e'::uuid
),
assignees AS (
    SELECT DISTINCT user_id
    FROM (
        SELECT aa.user_id
        FROM target a
        JOIN chore_assignment_assignees aa ON aa.assignment_id=a.assignment_id
        UNION
        SELECT assignment.assigned_to_user_id
        FROM target a
        JOIN chore_assignments assignment ON assignment.id=a.assignment_id
        WHERE assignment.assigned_to_user_id IS NOT NULL
    ) assigned
)
SELECT DISTINCT n.id AS notification_id
FROM target a
JOIN assignees aa ON TRUE
JOIN household_memberships membership
  ON membership.household_id=a.household_id
 AND membership.user_id=aa.user_id
 AND membership.status='ACTIVE'
JOIN notifications n
  ON n.reference_type='CHORE_ASSIGNMENT'
 AND n.reference_id=a.assignment_id
 AND n.recipient_user_id=aa.user_id
 AND n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
JOIN notification_reminder_rules rule
  ON rule.mode=a.reminder_mode
 AND rule.event_type=n.type
 AND rule.enabled=TRUE
 AND n.scheduled_at=a.due_at - make_interval(mins => rule.minutes_before_due)
LEFT JOIN LATERAL (
    SELECT a.due_at - make_interval(mins => MAX(next_rule.minutes_before_due))
               AS next_schedule
    FROM notification_reminder_rules next_rule
    WHERE next_rule.mode=a.reminder_mode
      AND next_rule.enabled=TRUE
      AND next_rule.minutes_before_due<rule.minutes_before_due
) next_rule ON TRUE
LEFT JOIN LATERAL (
    SELECT CASE
        WHEN n.type='CHORE_DUE_SOON'
             AND a.due_at<COALESCE(next_rule.next_schedule, n.scheduled_at + INTERVAL '24 hours')
            THEN a.due_at
        WHEN n.type='CHORE_DUE_NOW'
             AND a.due_at + INTERVAL '1 hour'
                 < COALESCE(next_rule.next_schedule, n.scheduled_at + INTERVAL '24 hours')
            THEN a.due_at + INTERVAL '1 hour'
        ELSE COALESCE(next_rule.next_schedule, n.scheduled_at + INTERVAL '24 hours')
    END AS expected_expires_at
) planned_window ON TRUE
LEFT JOIN notification_preferences preference
  ON preference.user_id=n.recipient_user_id
WHERE a.assignment_status='PENDING'
  AND a.recurrence_rule='FREQ=ONCE'
  AND a.schedule_active=TRUE
  AND a.chore_active=TRUE
  AND a.archived_at IS NULL
  AND a.scheduled_for=a.starts_on
  AND (a.ends_on IS NULL OR a.scheduled_for<=a.ends_on)
  AND a.due_time IS NOT NULL
  AND a.due_at=(a.scheduled_for + a.due_time) AT TIME ZONE a.timezone
  AND n.status='CANCELLED'
  AND n.sent_at IS NULL
  AND n.expires_at IS NOT NULL
  AND n.expires_at=planned_window.expected_expires_at
  AND n.expires_at>NOW()
  AND COALESCE(preference.chore_reminders_enabled, TRUE)=TRUE
  AND (n.type<>'CHORE_OVERDUE' OR COALESCE(preference.overdue_enabled, TRUE)=TRUE)
  AND NOT EXISTS (
      SELECT 1
      FROM notification_deliveries sent
      WHERE sent.notification_id=n.id
        AND (sent.status='SENT' OR sent.sent_at IS NOT NULL)
  )
  AND NOT EXISTS (
      SELECT 1
      FROM notification_push_delivery_targets sent
      WHERE sent.notification_id=n.id
        AND (sent.status='SENT' OR sent.sent_at IS NOT NULL)
  )
  AND EXISTS (
      SELECT 1
      FROM notification_deliveries delivery
      WHERE delivery.notification_id=n.id
        AND delivery.status='CANCELLED'
        AND delivery.sent_at IS NULL
        AND delivery.attempts<3
        AND (
            delivery.channel='IN_APP'
            OR (
                delivery.channel='WEB_PUSH'
                AND COALESCE(preference.push_enabled, FALSE)=TRUE
                AND (
                    (delivery.push_targets_snapshotted_at IS NULL AND EXISTS (
                        SELECT 1
                        FROM push_subscriptions subscription
                        WHERE subscription.user_id=n.recipient_user_id
                          AND subscription.active=TRUE
                    ))
                    OR EXISTS (
                        SELECT 1
                        FROM notification_push_delivery_targets push_target
                        JOIN push_subscriptions subscription
                          ON subscription.id=push_target.subscription_id
                        WHERE push_target.notification_id=n.id
                          AND push_target.status='CANCELLED'
                          AND push_target.sent_at IS NULL
                          AND push_target.attempts<3
                          AND subscription.user_id=n.recipient_user_id
                          AND subscription.active=TRUE
                    )
                )
            )
        )
  );

SELECT notification_id
FROM eligible_test3_reminders
ORDER BY notification_id;
```

**Stop and review at this point.** If the IDs, current state, or row count do
not match the exact Test3 records reviewed for repair, roll back. After the
code fix is deployed and the candidate list is approved, the only proposed
mutations are:

```sql
UPDATE notification_push_delivery_targets target
SET status='PENDING', updated_at=NOW()
FROM eligible_test3_reminders candidate, push_subscriptions subscription
WHERE target.notification_id=candidate.notification_id
  AND subscription.id=target.subscription_id
  AND subscription.active=TRUE
  AND target.status='CANCELLED'
  AND target.sent_at IS NULL
  AND target.attempts<3;

UPDATE notification_deliveries delivery
SET status='PENDING'
FROM eligible_test3_reminders candidate
JOIN notifications n ON n.id=candidate.notification_id
LEFT JOIN notification_preferences preference ON preference.user_id=n.recipient_user_id
WHERE delivery.notification_id=candidate.notification_id
  AND delivery.status='CANCELLED'
  AND delivery.sent_at IS NULL
  AND delivery.attempts<3
  AND (
      delivery.channel='IN_APP'
      OR (
          delivery.channel='WEB_PUSH'
          AND COALESCE(preference.push_enabled, FALSE)=TRUE
          AND EXISTS (
              SELECT 1
              FROM push_subscriptions subscription
              WHERE subscription.user_id=n.recipient_user_id
                AND subscription.active=TRUE
          )
          AND (
              delivery.push_targets_snapshotted_at IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM notification_push_delivery_targets target
                  JOIN push_subscriptions subscription
                    ON subscription.id=target.subscription_id
                  WHERE target.notification_id=n.id
                    AND target.status IN ('PENDING', 'FAILED')
                    AND target.sent_at IS NULL
                    AND target.attempts<3
                    AND subscription.active=TRUE
              )
          )
      )
  )
RETURNING delivery.notification_id, delivery.channel, delivery.attempts,
          delivery.next_attempt_at;

UPDATE notifications n
SET status='PENDING'
FROM eligible_test3_reminders candidate
WHERE n.id=candidate.notification_id
  AND n.status='CANCELLED'
  AND n.sent_at IS NULL
  AND EXISTS (
      SELECT 1
      FROM notification_deliveries delivery
      WHERE delivery.notification_id=n.id
        AND delivery.status='PENDING'
        AND delivery.sent_at IS NULL
  )
RETURNING n.id, n.type, n.scheduled_at, n.expires_at;

-- Review all RETURNING rows before COMMIT; otherwise ROLLBACK.
```

The proposed statements do not change attempt counters, retry times, reminder
times, expiry times, sent timestamps, or deduplication keys. They do not insert
notifications or targets and do not revive ineligible Web Push deliveries.
Commit only after the returned IDs and counts are reviewed in the transaction.

This deliberately does not replay expired reminders, revive all cancelled
notifications, insert replacement notifications, reset retry budgets, or
modify accepted/sent delivery history. It should not be applied if any
precondition fails or the diagnostic shows different ownership/state.
