package com.dirtyduty.app.notification;

import com.dirtyduty.app.service.AwayPeriods;
import com.dirtyduty.app.service.BoardListService;
import com.dirtyduty.app.service.BoardPostService;
import com.dirtyduty.app.service.MembershipExitCleanupService;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class NotificationScheduler {
  private static final Logger log = LoggerFactory.getLogger(NotificationScheduler.class);
  private static final DateTimeFormatter DUE_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");
  private static final String NOTIFICATION_SCOPE_CTE =
      """
      WITH notification_scope AS (
          SELECT n.id, n.recipient_user_id,
              COALESCE(
                  e.household_id,
                  CASE n.reference_type
                      WHEN 'HOUSEHOLD' THEN n.reference_id
                      WHEN 'CHORE_ASSIGNMENT' THEN (
                          SELECT a.household_id FROM chore_assignments a WHERE a.id=n.reference_id
                      )
                      WHEN 'CHORE_SCHEDULE' THEN (
                          SELECT s.household_id FROM chore_schedules s WHERE s.id=n.reference_id
                      )
                  END,
                  CASE e.reference_type
                      WHEN 'HOUSEHOLD' THEN e.reference_id
                      WHEN 'CHORE_ASSIGNMENT' THEN (
                          SELECT a.household_id FROM chore_assignments a WHERE a.id=e.reference_id
                      )
                      WHEN 'CHORE_SCHEDULE' THEN (
                          SELECT s.household_id FROM chore_schedules s WHERE s.id=e.reference_id
                      )
                  END
              ) AS household_id
          FROM notifications n
          LEFT JOIN notification_events e ON e.id=n.event_id
      )
      """;

  private final JdbcTemplate jdbc;
  private final NotificationEventService eventService;
  private final List<NotificationDeliveryProvider> providers;
  private final NotificationCooldownService cooldownService;
  private final NotificationTemplateResolver templateResolver;
  private final MembershipExitCleanupService membershipExitCleanupService;
  private final BoardPostService boardPostService;
  private final BoardListService boardListService;
  private final QuietHoursRelease quietHoursRelease;
  private final AwayPeriods awayPeriods;
  private final com.dirtyduty.app.service.ChoreRequestService choreRequests;
  private final QuietHoursService quietHours;

  /** Unlocked reads (finding work, planning reminders). */
  private final TransactionTemplate reads;

  /** One short locked write per household or person. */
  private final TransactionTemplate writes;

  public NotificationScheduler(
      JdbcTemplate jdbc,
      NotificationEventService eventService,
      List<NotificationDeliveryProvider> providers,
      NotificationCooldownService cooldownService,
      NotificationTemplateResolver templateResolver,
      MembershipExitCleanupService membershipExitCleanupService,
      BoardPostService boardPostService,
      BoardListService boardListService,
      QuietHoursRelease quietHoursRelease,
      AwayPeriods awayPeriods,
      com.dirtyduty.app.service.ChoreRequestService choreRequests,
      QuietHoursService quietHours,
      PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.eventService = eventService;
    this.providers = providers;
    this.cooldownService = cooldownService;
    this.templateResolver = templateResolver;
    this.membershipExitCleanupService = membershipExitCleanupService;
    this.boardPostService = boardPostService;
    this.boardListService = boardListService;
    this.quietHoursRelease = quietHoursRelease;
    this.awayPeriods = awayPeriods;
    this.choreRequests = choreRequests;
    this.quietHours = quietHours;
    this.reads = new TransactionTemplate(transactionManager);
    this.reads.setReadOnly(true);
    this.writes = new TransactionTemplate(transactionManager);
  }

  /**
   * One pass. Slow work (finding what needs doing, reading live notifications and planning
   * reminders) runs without any lock. Each household is then written in its own short transaction
   * that takes the household lock, re-checks the plan against what is there now, and writes; then
   * each person with account-level or quiet-hours work gets one short transaction of their own.
   *
   * <p>Lock order in every transaction: households, users, notifications/deliveries, then push
   * subscriptions (updated by providers). Every processing statement is restricted to notifications
   * whose household and recipient are locked.
   */
  @Scheduled(
      fixedDelayString = "${app.notifications.scheduler-delay:60000}",
      initialDelayString = "${app.notifications.scheduler-initial-delay:0}")
  public void run() {
    long started = System.nanoTime();
    // Hand-off and swap requests past their deadline (or whose chores changed) close first, each
    // household in its own transaction, before this pass takes any lock (E11).
    choreRequests.maintain();
    List<UUID> householdIds = reads.execute(status -> householdsTouchedByRun());
    LiveNotifications live = reads.execute(status -> liveNotifications());
    Map<String, List<ReminderSchedulePlanner.ReminderRule>> rulesByMode = new HashMap<>();
    long longestLock = 0;
    int written = 0;
    for (UUID householdId : householdIds) {
      try {
        List<ReminderCandidate> plan =
            reads.execute(status -> planReminders(householdId, rulesByMode));
        List<LiveNotification> scope = live.byHousehold().getOrDefault(householdId, List.of());
        if (plan.isEmpty() && scope.isEmpty()) {
          continue;
        }
        long lockStarted = System.nanoTime();
        writes.executeWithoutResult(status -> processHousehold(householdId, plan, scope));
        longestLock = Math.max(longestLock, millisSince(lockStarted));
        written++;
      } catch (RuntimeException exception) {
        log.warn("Notification run failed for household {}", householdId, exception);
      }
    }
    List<UUID> people = reads.execute(status -> peopleWithAccountLevelWork(live));
    for (UUID userId : people) {
      try {
        List<UUID> accountLevel = live.accountLevelByUser().getOrDefault(userId, List.of());
        long lockStarted = System.nanoTime();
        writes.executeWithoutResult(status -> processPerson(userId, accountLevel));
        longestLock = Math.max(longestLock, millisSince(lockStarted));
      } catch (RuntimeException exception) {
        log.warn("Notification run failed for user {}", userId, exception);
      }
    }
    log.debug(
        "Notification run: {} ms, {} households written ({} touched), {} people,"
            + " longest lock held {} ms",
        millisSince(started),
        written,
        householdIds.size(),
        people.size(),
        longestLock);
  }

  private static long millisSince(long nanoTime) {
    return Duration.ofNanos(System.nanoTime() - nanoTime).toMillis();
  }

  /**
   * Notifications the run can still act on, by household (or by recipient when they belong to no
   * household). Every processing statement requires a pending notification or a pending/failed
   * delivery or push target, so nothing else is needed. Read without locks: anything created after
   * this snapshot is picked up by the next run, as before.
   */
  private LiveNotifications liveNotifications() {
    Map<UUID, List<LiveNotification>> byHousehold = new HashMap<>();
    Map<UUID, List<UUID>> accountLevelByUser = new HashMap<>();
    jdbc.query(
        NOTIFICATION_SCOPE_CTE
            + """
            SELECT s.id, s.recipient_user_id, s.household_id
            FROM notification_scope s
            JOIN notifications n ON n.id=s.id
            WHERE n.status='PENDING'
               OR EXISTS (SELECT 1 FROM notification_deliveries d
                          WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED'))
               OR EXISTS (SELECT 1 FROM notification_push_delivery_targets t
                          WHERE t.notification_id=n.id AND t.status IN ('PENDING', 'FAILED'))
            """,
        (RowCallbackHandler)
            rs -> {
              UUID id = rs.getObject("id", UUID.class);
              UUID recipient = rs.getObject("recipient_user_id", UUID.class);
              UUID householdId = rs.getObject("household_id", UUID.class);
              if (householdId == null) {
                accountLevelByUser.computeIfAbsent(recipient, key -> new ArrayList<>()).add(id);
              } else {
                byHousehold
                    .computeIfAbsent(householdId, key -> new ArrayList<>())
                    .add(new LiveNotification(id, recipient));
              }
            });
    return new LiveNotifications(byHousehold, accountLevelByUser);
  }

  /** The short write for one household: lock, re-check the plan, write, deliver what is due. */
  private void processHousehold(
      UUID householdId, List<ReminderCandidate> plan, List<LiveNotification> scope) {
    if (membershipExitCleanupService.lockExistingHouseholds(List.of(householdId)).isEmpty()) {
      return;
    }
    Set<UUID> people = new HashSet<>();
    scope.forEach(notification -> people.add(notification.recipientId()));
    plan.forEach(candidate -> people.add(candidate.recipientId()));
    Set<UUID> lockedPeople =
        Set.copyOf(membershipExitCleanupService.lockExistingUsers(List.copyOf(people)));
    List<UUID> ids = new ArrayList<>();
    for (LiveNotification notification : scope) {
      if (lockedPeople.contains(notification.recipientId())) {
        ids.add(notification.id());
      }
    }
    cancelInactiveAssignmentReminders(idScope(ids));
    ids.addAll(publishReminders(householdId, plan, lockedPeople));
    QueryScope locked = idScope(ids);
    cancelExpiredNotifications(locked);
    dispatchPending(locked);
    dispatchPushRetries(locked);
  }

  /**
   * People with work outside any household lock: notifications that belong to no household, pushes
   * held for quiet hours whose window has ended, and grouped morning pushes that are due.
   */
  private List<UUID> peopleWithAccountLevelWork(LiveNotifications live) {
    OffsetDateTime now = quietHours.now();
    Set<UUID> people = new TreeSet<>(Comparator.comparing(UUID::toString));
    people.addAll(live.accountLevelByUser().keySet());
    people.addAll(
        jdbc.queryForList(
            """
                SELECT DISTINCT n.recipient_user_id
                FROM notification_deliveries d
                JOIN notifications n ON n.id=d.notification_id
                WHERE d.channel='WEB_PUSH' AND d.quiet_held_until IS NOT NULL
                  AND d.status IN ('PENDING', 'FAILED') AND d.next_attempt_at<=?
                """,
            UUID.class,
            now));
    people.addAll(
        jdbc.queryForList(
            """
                SELECT DISTINCT recipient_user_id FROM notification_push_digests
                WHERE status='PENDING' AND send_at<=?
                """,
            UUID.class,
            now));
    return List.copyOf(people);
  }

  /**
   * The short write for one person: their account-level notifications, the morning release of
   * pushes held for quiet hours, grouped pushes, then push retries for what was released. The
   * households of the held pushes are locked first (the release checks those chores and posts).
   */
  private void processPerson(UUID userId, List<UUID> accountLevel) {
    OffsetDateTime now = quietHours.now();
    List<UUID> lockedHouseholds =
        membershipExitCleanupService.lockExistingHouseholds(householdsOf(heldPushes(userId, now)));
    if (membershipExitCleanupService.lockExistingUsers(List.of(userId)).isEmpty()) {
      return;
    }
    List<UUID> held = heldPushes(userId, now);
    if (!lockedHouseholds.containsAll(householdsOf(held))) {
      // A push was held in another household meanwhile; households lock before people, so the
      // next run takes this person again in order.
      return;
    }
    QueryScope accountScope = idScope(accountLevel);
    cancelInactiveAssignmentReminders(accountScope);
    cancelExpiredNotifications(accountScope);
    dispatchPending(accountScope);
    // Pushes held for quiet hours: at the end of the window, clean up, collapse and group them;
    // the one or two that go as themselves are then picked up by the retry pass below.
    quietHoursRelease.releaseDue(List.of(userId));
    quietHoursRelease.sendDue(List.of(userId));
    List<UUID> retries = new ArrayList<>(accountLevel);
    retries.addAll(held);
    dispatchPushRetries(idScope(retries));
  }

  private List<UUID> heldPushes(UUID userId, OffsetDateTime now) {
    return jdbc.queryForList(
        """
            SELECT d.notification_id
            FROM notification_deliveries d
            JOIN notifications n ON n.id=d.notification_id
            WHERE d.channel='WEB_PUSH' AND d.quiet_held_until IS NOT NULL
              AND d.status IN ('PENDING', 'FAILED') AND d.next_attempt_at<=?
              AND n.recipient_user_id=?
            """,
        UUID.class,
        now,
        userId);
  }

  private List<UUID> householdsOf(List<UUID> notificationIds) {
    if (notificationIds.isEmpty()) {
      return List.of();
    }
    return jdbc.queryForList(
        NOTIFICATION_SCOPE_CTE
            + """
            SELECT DISTINCT s.household_id FROM notification_scope s
            WHERE s.id = ANY(CAST(? AS uuid[])) AND s.household_id IS NOT NULL
            """,
        UUID.class,
        uuidArray(notificationIds));
  }

  private List<UUID> householdsTouchedByRun() {
    return jdbc.query(
        NOTIFICATION_SCOPE_CTE
            + """
        , candidate_scope AS (
            SELECT s.id, s.recipient_user_id, s.household_id, n.status, n.reference_type,
                   n.reference_id, n.scheduled_at, n.expires_at, n.type,
                   d.status AS delivery_status, d.next_attempt_at, d.push_targets_snapshotted_at,
                   EXISTS (
                       SELECT 1 FROM notification_push_delivery_targets t
                       WHERE t.notification_id=n.id
                         AND t.status IN ('PENDING', 'FAILED') AND t.attempts<3
                   ) AS has_eligible_push_target
            FROM notification_scope s
            JOIN notifications n ON n.id=s.id
            LEFT JOIN notification_deliveries d
              ON d.notification_id=n.id AND d.channel='WEB_PUSH'
        )
        SELECT DISTINCT household_id FROM (
            SELECT a.household_id
            FROM chore_assignments a
            JOIN households h ON h.id=a.household_id
            JOIN notification_reminder_rules r ON r.mode=h.reminder_mode AND r.enabled=TRUE
            WHERE a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
            UNION
            SELECT s.household_id
            FROM candidate_scope s
            LEFT JOIN chore_assignments a
              ON s.reference_type='CHORE_ASSIGNMENT' AND a.id=s.reference_id
            WHERE s.household_id IS NOT NULL
              AND (
                  (s.status='PENDING' AND (
                      s.reference_type='CHORE_ASSIGNMENT'
                      OR s.expires_at<=NOW()
                      OR (s.scheduled_at<=NOW()
                          AND (s.expires_at IS NULL OR s.expires_at>NOW()))
                  ))
                  OR (s.delivery_status IN ('PENDING', 'FAILED') AND (
                      s.status='CANCELLED'
                      OR (s.reference_type='CHORE_ASSIGNMENT'
                          AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                              OR (s.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                                  AND a.assigned_to_user_id IS DISTINCT FROM s.recipient_user_id
                                  AND NOT EXISTS (
                                      SELECT 1 FROM chore_assignment_assignees aa
                                      WHERE aa.assignment_id=a.id
                                        AND aa.user_id=s.recipient_user_id
                                  ))))
                      OR (s.status IN ('PENDING', 'SENT', 'FAILED')
                          AND s.scheduled_at<=NOW()
                          AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=NOW())
                          AND (s.push_targets_snapshotted_at IS NULL
                               OR s.has_eligible_push_target)
                          AND (s.expires_at IS NULL OR s.expires_at>NOW()))
                  ))
              )
        ) affected
        WHERE household_id IS NOT NULL
        ORDER BY household_id
        """,
        (rs, row) -> rs.getObject("household_id", UUID.class));
  }

  /**
   * Plans the reminder slots one household still needs, without locks. Slots that already have a
   * live or delivered row, or that would produce no notification (the recipient is not an active
   * member, has no enabled template, or is away that day), are left out so no event is written for
   * nothing. The plan is checked again under the household lock before anything is written.
   */
  private List<ReminderCandidate> planReminders(
      UUID householdId, Map<String, List<ReminderSchedulePlanner.ReminderRule>> rulesByMode) {
    Map<UUID, Assignment> assignments = activeAssignments(householdId);
    if (assignments.isEmpty()) {
      return List.of();
    }
    String mode = assignments.values().iterator().next().reminderMode();
    List<ReminderSchedulePlanner.ReminderRule> rules =
        rulesByMode.computeIfAbsent(mode, this::reminderRules);
    if (rules.isEmpty()) {
      return List.of();
    }
    Map<UUID, List<UUID>> recipients = recipientsByAssignment(householdId);
    Set<UUID> members = activeMembers(householdId);
    Map<UUID, Integer> completions = completionsThisWeek(householdId);
    Map<ReminderGroup, List<ExistingReminder>> existing = existingReminders(assignments.keySet());
    Map<String, Boolean> templates = new HashMap<>();
    OffsetDateTime planningTime = OffsetDateTime.now(ZoneOffset.UTC);
    List<ReminderCandidate> plan = new ArrayList<>();
    for (Assignment assignment : assignments.values()) {
      for (ReminderSchedulePlanner.PlannedReminder planned :
          ReminderSchedulePlanner.plan(assignment.dueAt(), rules, planningTime)) {
        String eventType = planned.rule().eventType();
        for (UUID recipient : recipients.getOrDefault(assignment.id(), List.of())) {
          if (!members.contains(recipient)
              || !templates.computeIfAbsent(
                  eventType + ":" + recipient,
                  key -> templateResolver.hasEnabledTemplate(eventType, householdId, recipient))
              || reminderRevision(existing, eventType, assignment.id(), recipient, planned) < 0
              || awayPeriods.suppresses(
                  eventType,
                  "CHORE_ASSIGNMENT",
                  assignment.id(),
                  recipient,
                  planned.scheduledAt())) {
            continue;
          }
          plan.add(
              new ReminderCandidate(
                  assignment.id(),
                  assignment.dueAt(),
                  mode,
                  planned,
                  recipient,
                  completions.getOrDefault(recipient, 0)));
        }
      }
    }
    return plan;
  }

  /**
   * Under the household and recipient locks: drops planned slots whose chore, deadline, assignee,
   * reminder mode or template changed since planning, or that gained a row meanwhile; publishes the
   * rest. Returns the ids of the notifications this created, so they are delivered in this run.
   */
  private List<UUID> publishReminders(
      UUID householdId, List<ReminderCandidate> plan, Set<UUID> lockedPeople) {
    if (plan.isEmpty()) {
      return List.of();
    }
    Map<UUID, Assignment> assignments = activeAssignments(householdId);
    Map<UUID, List<UUID>> recipients = recipientsByAssignment(householdId);
    Set<UUID> members = activeMembers(householdId);
    Map<ReminderGroup, List<ExistingReminder>> existing =
        existingReminders(
            plan.stream().map(ReminderCandidate::assignmentId).collect(Collectors.toSet()));
    Map<String, Boolean> templates = new HashMap<>();
    List<String> keys = new ArrayList<>();
    for (ReminderCandidate candidate : plan) {
      Assignment assignment = assignments.get(candidate.assignmentId());
      UUID recipient = candidate.recipientId();
      String eventType = candidate.planned().rule().eventType();
      if (assignment == null
          || !assignment.dueAt().toInstant().equals(candidate.dueAt().toInstant())
          || !assignment.reminderMode().equals(candidate.reminderMode())
          || !lockedPeople.contains(recipient)
          || !members.contains(recipient)
          || !recipients.getOrDefault(assignment.id(), List.of()).contains(recipient)
          || !templates.computeIfAbsent(
              eventType + ":" + recipient,
              key -> templateResolver.hasEnabledTemplate(eventType, householdId, recipient))) {
        continue;
      }
      int revision =
          reminderRevision(existing, eventType, assignment.id(), recipient, candidate.planned());
      if (revision < 0) {
        continue;
      }
      publishReminder(assignment, candidate, revision);
      String key = reminderKey(eventType, assignment.id(), recipient, candidate.planned());
      keys.add(revision > 1 ? key + ":r" + revision : key);
    }
    if (keys.isEmpty()) {
      return List.of();
    }
    return jdbc.queryForList(
        "SELECT id FROM notifications WHERE deduplication_key IN ("
            + placeholders(keys.size())
            + ")",
        UUID.class,
        keys.toArray());
  }

  private void publishReminder(Assignment assignment, ReminderCandidate candidate, int revision) {
    ReminderSchedulePlanner.PlannedReminder planned = candidate.planned();
    OffsetDateTime scheduledAt = planned.scheduledAt();
    Map<String, String> variables = new HashMap<>();
    variables.put("chore_name", assignment.title());
    variables.put(
        "due_time",
        assignment
            .dueAt()
            .atZoneSameInstant(ZoneId.of(assignment.timezone()))
            .format(DUE_TIME_FORMAT));
    variables.put(
        "hours_late",
        Long.toString(Math.max(0, Duration.between(assignment.dueAt(), scheduledAt).toHours())));
    variables.put("scheduled_at", scheduledAt.withOffsetSameInstant(ZoneOffset.UTC).toString());
    variables.put(
        "expires_at", planned.expiresAt().withOffsetSameInstant(ZoneOffset.UTC).toString());
    variables.put("completion_count", Integer.toString(candidate.completionCount()));
    if (revision > 1) {
      variables.put(DefaultNotificationGenerator.DEDUPLICATION_REVISION, "r" + revision);
    }
    eventService.publish(
        new NotificationEvent(
            planned.rule().eventType(),
            null,
            assignment.householdId(),
            "CHORE_ASSIGNMENT",
            assignment.id(),
            "CHORE_REMINDER",
            Map.copyOf(variables),
            List.of(candidate.recipientId())));
  }

  private Map<UUID, Assignment> activeAssignments(UUID householdId) {
    Map<UUID, Assignment> assignments = new LinkedHashMap<>();
    jdbc.query(
        """
            SELECT a.id, a.household_id, a.due_at, a.title_snapshot, h.timezone, h.reminder_mode
            FROM chore_assignments a
            JOIN households h ON h.id=a.household_id
            WHERE a.status IN ('PENDING', 'SUBMITTED') AND a.due_at IS NOT NULL
              AND a.household_id=?
            ORDER BY a.due_at, a.id
            """,
        (RowCallbackHandler)
            rs -> {
              Assignment assignment =
                  new Assignment(
                      rs.getObject("id", UUID.class),
                      rs.getObject("household_id", UUID.class),
                      rs.getObject("due_at", OffsetDateTime.class),
                      rs.getString("title_snapshot"),
                      rs.getString("timezone"),
                      rs.getString("reminder_mode"));
              assignments.put(assignment.id(), assignment);
            },
        householdId);
    return assignments;
  }

  private List<ReminderSchedulePlanner.ReminderRule> reminderRules(String mode) {
    return jdbc.query(
        """
            SELECT event_type, minutes_before_due
            FROM notification_reminder_rules
            WHERE mode=? AND enabled=TRUE
            ORDER BY minutes_before_due DESC
            """,
        (rs, row) ->
            new ReminderSchedulePlanner.ReminderRule(
                rs.getString("event_type"), rs.getInt("minutes_before_due")),
        mode);
  }

  /** Each live assignment's people: its assignees and its assigned member. */
  private Map<UUID, List<UUID>> recipientsByAssignment(UUID householdId) {
    Map<UUID, Set<UUID>> recipients = new HashMap<>();
    jdbc.query(
        """
            SELECT aa.assignment_id, aa.user_id
            FROM chore_assignment_assignees aa
            JOIN chore_assignments a ON a.id=aa.assignment_id
            WHERE a.household_id=? AND a.status IN ('PENDING', 'SUBMITTED')
            UNION
            SELECT id, assigned_to_user_id FROM chore_assignments
            WHERE household_id=? AND status IN ('PENDING', 'SUBMITTED')
              AND assigned_to_user_id IS NOT NULL
            """,
        (RowCallbackHandler)
            rs ->
                recipients
                    .computeIfAbsent(
                        rs.getObject(1, UUID.class),
                        key -> new TreeSet<>(Comparator.comparing(UUID::toString)))
                    .add(rs.getObject(2, UUID.class)),
        householdId,
        householdId);
    Map<UUID, List<UUID>> ordered = new HashMap<>();
    recipients.forEach((assignmentId, people) -> ordered.put(assignmentId, List.copyOf(people)));
    return ordered;
  }

  private Set<UUID> activeMembers(UUID householdId) {
    return Set.copyOf(
        jdbc.queryForList(
            "SELECT user_id FROM household_memberships WHERE household_id=? AND status='ACTIVE'",
            UUID.class,
            householdId));
  }

  private Map<UUID, Integer> completionsThisWeek(UUID householdId) {
    Map<UUID, Integer> completions = new HashMap<>();
    jdbc.query(
        """
            SELECT completed_by_user_id, COUNT(*) AS completions FROM chore_completions
            WHERE household_id=? AND completed_at >= date_trunc('week', NOW())
              AND completed_by_user_id IS NOT NULL
            GROUP BY completed_by_user_id
            """,
        (RowCallbackHandler)
            rs ->
                completions.put(
                    rs.getObject("completed_by_user_id", UUID.class), rs.getInt("completions")),
        householdId);
    return completions;
  }

  /** Every reminder row so far for these assignments, by assignment, recipient and type. */
  private Map<ReminderGroup, List<ExistingReminder>> existingReminders(Set<UUID> assignmentIds) {
    Map<ReminderGroup, List<ExistingReminder>> existing = new HashMap<>();
    if (assignmentIds.isEmpty()) {
      return existing;
    }
    jdbc.query(
        // The ids are unnested once (a per-row cast is slow in a generic plan), and the delivery
        // checks run only for the matching rows.
        """
            WITH matched AS MATERIALIZED (
                SELECT n.id, n.reference_id, n.recipient_user_id, n.type, n.deduplication_key,
                       n.status
                FROM notifications n
                WHERE n.reference_type='CHORE_ASSIGNMENT'
                  AND n.reference_id IN (SELECT unnest(CAST(? AS uuid[])))
            )
            SELECT n.reference_id, n.recipient_user_id, n.type, n.deduplication_key,
                   n.status='CANCELLED'
                   AND NOT EXISTS (
                       SELECT 1 FROM notification_deliveries d
                       WHERE d.notification_id=n.id
                         AND (d.attempts>0 OR d.sent_at IS NOT NULL
                              OR d.status IN ('SENT', 'FAILED'))
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM notification_push_delivery_targets t
                       WHERE t.notification_id=n.id
                         AND (t.attempts>0 OR t.sent_at IS NOT NULL
                              OR t.status IN ('SENT', 'FAILED'))
                   ) AS reusable
            FROM matched n
            """,
        (RowCallbackHandler)
            rs ->
                existing
                    .computeIfAbsent(
                        new ReminderGroup(
                            rs.getObject("reference_id", UUID.class),
                            rs.getObject("recipient_user_id", UUID.class),
                            rs.getString("type")),
                        key -> new ArrayList<>())
                    .add(
                        new ExistingReminder(
                            rs.getString("deduplication_key"), rs.getBoolean("reusable"))),
        uuidArray(assignmentIds));
    return existing;
  }

  private void cancelInactiveAssignmentReminders(QueryScope scope) {
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
            UPDATE notifications n SET status='CANCELLED'
            WHERE n.status='PENDING' AND n.reference_type='CHORE_ASSIGNMENT'
              AND n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
              AND n.id IN (
                  SELECT s.id FROM notification_scope s
                  JOIN notifications scoped ON scoped.id=s.id
                  LEFT JOIN chore_assignments a
                    ON scoped.reference_type='CHORE_ASSIGNMENT' AND a.id=scoped.reference_id
                  WHERE %s AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                      OR (a.assigned_to_user_id IS DISTINCT FROM s.recipient_user_id
                          AND NOT EXISTS (
                              SELECT 1 FROM chore_assignment_assignees aa
                              WHERE aa.assignment_id=a.id AND aa.user_id=s.recipient_user_id
                          )))
              )
            """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
            UPDATE notification_deliveries d SET status='CANCELLED'
            FROM notifications n
            LEFT JOIN chore_assignments a
              ON n.reference_type='CHORE_ASSIGNMENT' AND a.id=n.reference_id
            WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
              AND (n.status='CANCELLED'
                  OR (n.reference_type='CHORE_ASSIGNMENT'
                      AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                          OR (n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                              AND a.assigned_to_user_id IS DISTINCT FROM n.recipient_user_id
                              AND NOT EXISTS (
                                  SELECT 1 FROM chore_assignment_assignees aa
                                  WHERE aa.assignment_id=a.id
                                    AND aa.user_id=n.recipient_user_id
                              )))))
              AND n.id IN (
                  SELECT s.id FROM notification_scope s
                  WHERE %s
              )
            """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
            UPDATE notification_push_delivery_targets t
            SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
            WHERE t.status IN ('PENDING', 'FAILED')
              AND t.notification_id IN (
                  SELECT s.id FROM notification_scope s
                  JOIN notifications n ON n.id=s.id
                  LEFT JOIN chore_assignments a
                    ON n.reference_type='CHORE_ASSIGNMENT' AND a.id=n.reference_id
                  WHERE %s AND (n.status='CANCELLED'
                      OR (n.reference_type='CHORE_ASSIGNMENT'
                          AND (a.id IS NULL OR a.status NOT IN ('PENDING', 'SUBMITTED')
                              OR (n.type IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_OVERDUE')
                                  AND a.assigned_to_user_id IS DISTINCT FROM n.recipient_user_id
                                  AND NOT EXISTS (
                                      SELECT 1 FROM chore_assignment_assignees aa
                                      WHERE aa.assignment_id=a.id
                                        AND aa.user_id=n.recipient_user_id
                                  )))))
              )
            """
                .formatted(scope.predicate()),
        scope.args().toArray());
  }

  private void dispatchPending(QueryScope scope) {
    List<PendingNotification> pending =
        jdbc.query(
            NOTIFICATION_SCOPE_CTE
                + """
                SELECT n.id, n.event_id, n.recipient_user_id, n.type, n.category, n.priority,
                       n.title, n.message, n.reference_type, n.reference_id, n.scheduled_at,
                       n.expires_at, n.deduplication_key
                FROM notifications n
                JOIN notification_scope s ON s.id=n.id
                WHERE n.status='PENDING' AND n.scheduled_at<=NOW()
                  AND (n.expires_at IS NULL OR n.expires_at>NOW())
                  AND %s
                ORDER BY n.scheduled_at, n.created_at
                LIMIT 200
                FOR UPDATE OF n SKIP LOCKED
                """
                    .formatted(scope.predicate()),
            (rs, row) ->
                new PendingNotification(
                    rs.getObject("id", UUID.class),
                    rs.getObject("event_id", UUID.class),
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("category"),
                    rs.getString("priority"),
                    rs.getString("title"),
                    rs.getString("message"),
                    rs.getString("reference_type"),
                    rs.getObject("reference_id", UUID.class),
                    rs.getObject("scheduled_at", OffsetDateTime.class),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getString("deduplication_key")),
            scope.args().toArray());

    for (PendingNotification item : pending) {
      NotificationMessage message = item.toMessage();
      if (!isEnabled(item)
          || !isAssignmentActive(item)
          || !isBoardReminderLive(item)
          || !isBoardListPushLive(item)
          || !membershipExitCleanupService.isRecipientActiveForNotification(item.id())
          || isHeldForAway(item)) {
        cancelNotification(item.id());
        continue;
      }
      OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
      if (!cooldownService.isAvailable(message, now)) {
        continue;
      }
      int sent =
          jdbc.update(
              """
                    UPDATE notifications SET status='SENT', sent_at=?
                    WHERE id=? AND status='PENDING' AND scheduled_at<=?
                    """,
              now,
              item.id(),
              now);
      if (sent == 0) {
        continue;
      }
      jdbc.update(
          """
                    UPDATE notification_deliveries SET status='SENT', sent_at=?, attempts=attempts+1
                    WHERE notification_id=? AND channel='IN_APP' AND status='PENDING'
                    """,
          now,
          item.id());
      for (NotificationDeliveryProvider provider : providers) {
        provider.deliver(message, item.eventId());
      }
    }
  }

  private void cancelExpiredNotifications(QueryScope scope) {
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
                UPDATE notifications SET status='CANCELLED'
                WHERE status='PENDING' AND expires_at IS NOT NULL AND expires_at<=NOW()
                  AND id IN (
                      SELECT s.id FROM notification_scope s WHERE %s
                  )
                """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
                UPDATE notification_push_delivery_targets t
                SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
                WHERE t.status IN ('PENDING', 'FAILED')
                  AND t.notification_id IN (
                      SELECT s.id FROM notification_scope s
                      JOIN notifications n ON n.id=s.id
                      WHERE n.expires_at IS NOT NULL AND n.expires_at<=NOW()
                        AND %s
                  )
                """
                .formatted(scope.predicate()),
        scope.args().toArray());
    jdbc.update(
        NOTIFICATION_SCOPE_CTE
            + """
                UPDATE notification_deliveries d SET status='CANCELLED'
                FROM notifications n
                WHERE d.notification_id=n.id AND d.status IN ('PENDING', 'FAILED')
                  AND n.expires_at IS NOT NULL AND n.expires_at<=NOW()
                  AND n.id IN (
                      SELECT s.id FROM notification_scope s WHERE %s
                  )
                """
                .formatted(scope.predicate()),
        scope.args().toArray());
  }

  private void dispatchPushRetries(QueryScope scope) {
    List<PendingNotification> retries =
        jdbc.query(
            NOTIFICATION_SCOPE_CTE
                + """
                SELECT n.id, n.event_id, n.recipient_user_id, n.type, n.category, n.priority,
                       n.title, n.message, n.reference_type, n.reference_id, n.scheduled_at,
                       n.expires_at, n.deduplication_key
                FROM notifications n
                JOIN notification_scope s ON s.id=n.id
                JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='WEB_PUSH'
                WHERE d.status IN ('PENDING', 'FAILED') AND d.quiet_held_until IS NULL
                  AND (d.push_targets_snapshotted_at IS NULL OR EXISTS (
                      SELECT 1 FROM notification_push_delivery_targets t
                      WHERE t.notification_id=n.id
                        AND t.status IN ('PENDING', 'FAILED') AND t.attempts<3
                  ))
                  AND n.scheduled_at<=NOW()
                  AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=NOW())
                  AND (n.expires_at IS NULL OR n.expires_at>NOW())
                  AND %s
                ORDER BY d.next_attempt_at NULLS FIRST, n.created_at
                LIMIT 200
                FOR UPDATE OF n, d SKIP LOCKED
                """
                    .formatted(scope.predicate()),
            (rs, row) ->
                new PendingNotification(
                    rs.getObject("id", UUID.class),
                    rs.getObject("event_id", UUID.class),
                    rs.getObject("recipient_user_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("category"),
                    rs.getString("priority"),
                    rs.getString("title"),
                    rs.getString("message"),
                    rs.getString("reference_type"),
                    rs.getObject("reference_id", UUID.class),
                    rs.getObject("scheduled_at", OffsetDateTime.class),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getString("deduplication_key")),
            scope.args().toArray());
    for (PendingNotification item : retries) {
      NotificationMessage message = item.toMessage();
      if (!isEnabled(item)
          || !isAssignmentActive(item)
          || !isBoardReminderLive(item)
          || !isBoardListPushLive(item)
          || !membershipExitCleanupService.isRecipientActiveForNotification(item.id())
          || isHeldForAway(item)) {
        cancelNotification(item.id());
        continue;
      }
      providers.stream()
          .filter(provider -> "WEB_PUSH".equals(provider.channel()))
          .forEach(provider -> provider.deliver(message, item.eventId()));
    }
  }

  private boolean isEnabled(PendingNotification item) {
    Boolean enabled =
        jdbc.queryForObject(
            """
                SELECT CASE
                    WHEN ? IN ('CHORE_ASSIGNED', 'CHORE_OCCURRENCE_MOVED', 'CHORE_OCCURRENCE_SKIPPED',
                               'CHORE_TURN',
                               'REQUEST_HANDOFF_ASK', 'REQUEST_SWAP_ASK', 'REQUEST_ACCEPTED',
                               'REQUEST_DECLINED', 'REQUEST_UNCLAIMED', 'REQUEST_EXPIRED')
                        THEN COALESCE(p.chore_assigned_enabled, TRUE)
                    WHEN ? IN ('CHORE_DUE_SOON', 'CHORE_DUE_NOW', 'CHORE_NEEDS_DOING')
                        THEN COALESCE(p.chore_reminders_enabled, TRUE)
                    WHEN ?='CHORE_OVERDUE'
                        THEN COALESCE(p.chore_reminders_enabled, TRUE)
                             AND COALESCE(p.overdue_enabled, TRUE)
                    WHEN ?='CHORE_COMPLETED' THEN COALESCE(p.chore_completion_enabled, TRUE)
                    WHEN ?='COMPETITIVE' THEN COALESCE(p.competitive_notifications_enabled, TRUE)
                    ELSE COALESCE(p.household_updates_enabled, TRUE)
                END
                FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id
                WHERE u.id=?
                """,
            Boolean.class,
            item.type(),
            item.type(),
            item.type(),
            item.type(),
            item.category(),
            item.recipientUserId());
    return Boolean.TRUE.equals(enabled);
  }

  private boolean isAssignmentActive(PendingNotification item) {
    if (!"CHORE_ASSIGNMENT".equals(item.referenceType())) {
      return true;
    }
    Boolean active =
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM chore_assignments
                              WHERE id=? AND status IN ('PENDING', 'SUBMITTED')
                )
                """,
            Boolean.class,
            item.referenceId());
    if (!Boolean.TRUE.equals(active) || !isChoreReminder(item.type())) {
      return Boolean.TRUE.equals(active);
    }
    Boolean assigned =
        jdbc.queryForObject(
            """
                SELECT EXISTS(
                    SELECT 1 FROM chore_assignments a
                    WHERE a.id=? AND (
                        a.assigned_to_user_id=? OR EXISTS (
                            SELECT 1 FROM chore_assignment_assignees aa
                            WHERE aa.assignment_id=a.id AND aa.user_id=?
                        )
                    )
                )
                """,
            Boolean.class,
            item.referenceId(),
            item.recipientUserId(),
            item.recipientUserId());
    return Boolean.TRUE.equals(assigned);
  }

  /** A board event reminder goes only while its post exists and is still active. */
  private boolean isBoardReminderLive(PendingNotification item) {
    if (!"BOARD_POST".equals(item.referenceType()) || !"BOARD_EVENT_REMINDER".equals(item.type())) {
      return true;
    }
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM board_posts
                              WHERE id=? AND type='EVENT' AND past_at IS NULL)
                """,
            Boolean.class,
            item.referenceId()));
  }

  /**
   * A scheduled "Need it today" push (the bundle at the end of a list's 30-minute window) goes only
   * while a flag it carries is still open today; an immediate one always goes.
   */
  private boolean isBoardListPushLive(PendingNotification item) {
    if (!"BOARD_LIST".equals(item.referenceType())
        || !"BOARD_LIST_NEEDED_TODAY".equals(item.type())
        || item.referenceId() == null
        || item.deduplicationKey() == null
        || item.deduplicationKey().contains(":event")) {
      return true;
    }
    return boardListService.claimDeferredPush(item.referenceId(), item.scheduledAt());
  }

  /** An away member gets no chore notifications for their away days (E10). */
  private boolean isHeldForAway(PendingNotification item) {
    return awayPeriods.suppresses(
        item.type(),
        item.referenceType(),
        item.referenceId(),
        item.recipientUserId(),
        OffsetDateTime.now(ZoneOffset.UTC));
  }

  private boolean isChoreReminder(String type) {
    return "CHORE_DUE_SOON".equals(type)
        || "CHORE_DUE_NOW".equals(type)
        || "CHORE_OVERDUE".equals(type);
  }

  private void cancelNotification(UUID notificationId) {
    jdbc.update(
        "UPDATE notifications SET status='CANCELLED' WHERE id=? AND status='PENDING'",
        notificationId);
    jdbc.update(
        """
                UPDATE notification_deliveries SET status='CANCELLED'
                WHERE notification_id=? AND status IN ('PENDING', 'FAILED')
                """,
        notificationId);
    jdbc.update(
        """
                UPDATE notification_push_delivery_targets
                SET status='CANCELLED', next_attempt_at=NULL, updated_at=NOW()
                WHERE notification_id=? AND status IN ('PENDING', 'FAILED')
                """,
        notificationId);
  }

  /** Restricts a statement to these notifications (whose household and recipient are locked). */
  private static QueryScope idScope(Collection<UUID> notificationIds) {
    if (notificationIds.isEmpty()) {
      return new QueryScope("FALSE", List.of());
    }
    return new QueryScope("s.id = ANY(CAST(? AS uuid[]))", List.of(uuidArray(notificationIds)));
  }

  private static String uuidArray(Collection<UUID> ids) {
    return ids.stream().map(UUID::toString).distinct().collect(Collectors.joining(",", "{", "}"));
  }

  private static String placeholders(int count) {
    return String.join(",", java.util.Collections.nCopies(count, "?"));
  }

  private static String reminderKey(
      String eventType,
      UUID assignmentId,
      UUID recipient,
      ReminderSchedulePlanner.PlannedReminder planned) {
    // The same key DefaultNotificationGenerator gives the reminder's notification.
    return String.join(
        ":",
        eventType,
        assignmentId.toString(),
        recipient.toString(),
        planned.scheduledAt().toInstant().toString());
  }

  /**
   * Decides whether a reminder slot (type, assignment, recipient, scheduled time) needs a row.
   *
   * <p>Returns -1 when it must not be planned: a row for the slot is still live (pending, sent or
   * failed), or any earlier row for it was delivered or attempted on any channel or subscription.
   * Returns 1 for a first plan (the original key), and n &gt; 1 when every earlier row was
   * cancelled before any delivery attempt, for example because the deadline moved away and came
   * back. The new row then uses a versioned key so cancelled rows and their delivery history stay
   * untouched and the unique key still prevents duplicates.
   */
  private static int reminderRevision(
      Map<ReminderGroup, List<ExistingReminder>> existing,
      String eventType,
      UUID assignmentId,
      UUID recipient,
      ReminderSchedulePlanner.PlannedReminder planned) {
    String baseKey = reminderKey(eventType, assignmentId, recipient, planned);
    List<Boolean> reusable =
        existing
            .getOrDefault(new ReminderGroup(assignmentId, recipient, eventType), List.of())
            .stream()
            .filter(
                row ->
                    row.deduplicationKey().equals(baseKey)
                        || row.deduplicationKey().startsWith(baseKey + ":r"))
            .map(ExistingReminder::reusable)
            .toList();
    if (reusable.isEmpty()) {
      return 1;
    }
    if (reusable.contains(Boolean.FALSE)) {
      return -1;
    }
    return reusable.size() + 1;
  }

  @Scheduled(cron = "${app.notifications.retention-cron:0 10 3 * * *}")
  @Transactional
  public void cleanupReadNotifications() {
    // Board posts move to Past when their time is up and are deleted 30 days later.
    boardPostService.runRetention();
    // List items go a day after they're bought; Today flags clear when the day ends.
    boardListService.runRetention();
    jdbc.update(
        """
                DELETE FROM notifications
                WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL '90 days'
                """);
  }

  private record Assignment(
      UUID id,
      UUID householdId,
      OffsetDateTime dueAt,
      String title,
      String timezone,
      String reminderMode) {}

  private record QueryScope(String predicate, List<Object> args) {}

  private record LiveNotification(UUID id, UUID recipientId) {}

  private record LiveNotifications(
      Map<UUID, List<LiveNotification>> byHousehold, Map<UUID, List<UUID>> accountLevelByUser) {}

  /** A reminder slot planned without locks, checked again under the household lock. */
  private record ReminderCandidate(
      UUID assignmentId,
      OffsetDateTime dueAt,
      String reminderMode,
      ReminderSchedulePlanner.PlannedReminder planned,
      UUID recipientId,
      int completionCount) {}

  private record ReminderGroup(UUID assignmentId, UUID recipientId, String type) {}

  private record ExistingReminder(String deduplicationKey, boolean reusable) {}

  private record PendingNotification(
      UUID id,
      UUID eventId,
      UUID recipientUserId,
      String type,
      String category,
      String priority,
      String title,
      String message,
      String referenceType,
      UUID referenceId,
      OffsetDateTime scheduledAt,
      OffsetDateTime expiresAt,
      String deduplicationKey) {
    private NotificationMessage toMessage() {
      return new NotificationMessage(
          recipientUserId,
          type,
          category,
          priority,
          title,
          message,
          referenceType,
          referenceId,
          scheduledAt,
          expiresAt,
          deduplicationKey);
    }
  }
}
