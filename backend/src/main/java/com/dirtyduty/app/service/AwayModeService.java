package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.household.AwayPeriodRequest;
import com.dirtyduty.app.dto.household.AwayPreviewResponse;
import com.dirtyduty.app.dto.household.AwayStatusResponse;
import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.UserRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Away mode (E10): a member's away period in a household, and everything that follows from it.
 *
 * <p>Setting, changing or ending a period re-plans the household's chores through the normal
 * reconcile path ({@link OccurrenceService#replanForAway}); generation respects away periods on its
 * own (see {@link OccurrenceService#selection}). On the return day (or when ending early) the
 * member's rotation standing is brought level with the others ({@link #maintain}).
 *
 * <p>Who: the member for themselves, an owner or admin for any active member. Lock order: the
 * household row first, then schedules and occurrences (inside the re-plan), then notifications.
 */
@Service
public class AwayModeService {
  static final int MAX_DAYS = 90;
  static final LocalTime ENDING_REMINDER_TIME = LocalTime.of(9, 0);
  static final String ENDING_REMINDER = "AWAY_MODE_ENDING";
  private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US);

  private final JdbcTemplate jdbc;
  private final UserRepository userRepository;
  private final OccurrenceService occurrenceService;
  private final ChoreScheduleRepository scheduleRepository;
  private final EntityManager entityManager;
  private final BoardPostService boardPostService;
  private final NotificationEventService notificationEventService;
  private final AwayPeriods awayPeriods;
  private Clock clock = Clock.systemUTC();

  public AwayModeService(
      JdbcTemplate jdbc,
      UserRepository userRepository,
      OccurrenceService occurrenceService,
      ChoreScheduleRepository scheduleRepository,
      EntityManager entityManager,
      BoardPostService boardPostService,
      NotificationEventService notificationEventService,
      AwayPeriods awayPeriods) {
    this.jdbc = jdbc;
    this.userRepository = userRepository;
    this.occurrenceService = occurrenceService;
    this.scheduleRepository = scheduleRepository;
    this.entityManager = entityManager;
    this.boardPostService = boardPostService;
    this.notificationEventService = notificationEventService;
    this.awayPeriods = awayPeriods;
  }

  /** Tests pin the clock; {@code null} restores the system clock. */
  void useClock(Clock testClock) {
    this.clock = testClock == null ? Clock.systemUTC() : testClock;
  }

  // ---- Reads -----------------------------------------------------------------------------------

  @Transactional
  public AwayStatusResponse status(UUID householdId, UUID userId, Authentication authentication) {
    Access access = access(householdId, userId, authentication, false);
    return statusOf(access);
  }

  @Transactional
  public AwayPreviewResponse preview(
      UUID householdId, UUID userId, AwayPeriodRequest request, Authentication authentication) {
    Access access = access(householdId, userId, authentication, false);
    Row existing = currentOrUpcoming(householdId, userId);
    Dates dates = validate(request, access.today(), existing);
    return new AwayPreviewResponse(
        dates.startsOn(),
        dates.endsOn(),
        dates.endsOn().plusDays(1),
        (int) ChronoUnit.DAYS.between(dates.startsOn(), dates.endsOn()) + 1,
        occurrenceService.awayEffects(householdId, userId, dates.startsOn(), dates.endsOn()));
  }

  // ---- Writes ----------------------------------------------------------------------------------

  @Transactional
  public AwayStatusResponse set(
      UUID householdId, UUID userId, AwayPeriodRequest request, Authentication authentication) {
    Access access = access(householdId, userId, authentication, true);
    if (currentOrUpcoming(householdId, userId) != null) {
      throw new InvalidHouseholdException(
          "There are already away dates set. Change those instead.");
    }
    Dates dates = validate(request, access.today(), null);
    UUID periodId = UUID.randomUUID();
    jdbc.update(
        """
            INSERT INTO member_away_periods
                (id, household_id, user_id, starts_on, ends_on, until_back, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
        periodId,
        householdId,
        userId,
        dates.startsOn(),
        dates.endsOn(),
        dates.untilBack(),
        access.actorId());
    if (request == null || !Boolean.FALSE.equals(request.postToBoard())) {
      UUID postId =
          boardPostService.postAwayNotice(
              householdId,
              access.actorId(),
              noticeTitle(access.targetName(), dates),
              noticeDetails(dates, access.self()),
              dates.endsOn());
      jdbc.update("UPDATE member_away_periods SET board_post_id=? WHERE id=?", postId, periodId);
    }
    replan(access);
    return statusOf(access);
  }

  @Transactional
  public AwayStatusResponse update(
      UUID householdId, UUID userId, AwayPeriodRequest request, Authentication authentication) {
    Access access = access(householdId, userId, authentication, true);
    Row existing = currentOrUpcoming(householdId, userId);
    if (existing == null) {
      throw new InvalidHouseholdException("Away mode isn't on.");
    }
    Dates dates = validate(request, access.today(), existing);
    jdbc.update(
        """
            UPDATE member_away_periods
            SET starts_on=?, ends_on=?, until_back=?, updated_at=NOW(),
                ending_reminder_for=CASE WHEN ends_on=? THEN ending_reminder_for END
            WHERE id=?
            """,
        dates.startsOn(),
        dates.endsOn(),
        dates.untilBack(),
        dates.endsOn(),
        existing.id());
    if (existing.boardPostId() != null) {
      boardPostService.updateAwayNotice(
          existing.boardPostId(),
          noticeTitle(access.targetName(), dates),
          noticeDetails(dates, access.self()),
          dates.endsOn());
    }
    replan(access);
    return statusOf(access);
  }

  /**
   * "I'm back now": a period that has started ends yesterday (or goes, if it started today), and
   * the member is brought level at once; an upcoming one is removed.
   */
  @Transactional
  public AwayStatusResponse endNow(UUID householdId, UUID userId, Authentication authentication) {
    Access access = access(householdId, userId, authentication, true);
    Row existing = currentOrUpcoming(householdId, userId);
    if (existing == null) {
      throw new InvalidHouseholdException("Away mode isn't on.");
    }
    LocalDate yesterday = access.today().minusDays(1);
    if (existing.startsOn().isAfter(yesterday)) {
      remove(existing);
    } else {
      jdbc.update(
          "UPDATE member_away_periods SET ends_on=?, updated_at=NOW() WHERE id=?",
          yesterday,
          existing.id());
      if (existing.boardPostId() != null) {
        boardPostService.endAwayNotice(existing.boardPostId(), yesterday);
      }
      levelReturned(householdId, access.today());
    }
    replan(access);
    return statusOf(access);
  }

  /** Removes an upcoming period that hasn't started. */
  @Transactional
  public void deleteUpcoming(UUID householdId, UUID userId, Authentication authentication) {
    Access access = access(householdId, userId, authentication, true);
    Row existing = currentOrUpcoming(householdId, userId);
    if (existing == null) {
      throw new InvalidHouseholdException("Away mode isn't on.");
    }
    if (!existing.startsOn().isAfter(access.today())) {
      throw new InvalidHouseholdException(
          "Away mode has already started. Use I'm back now instead.");
    }
    remove(existing);
    replan(access);
  }

  // ---- Background ------------------------------------------------------------------------------

  /** Households with an away period that needs levelling or an ending reminder. */
  public List<UUID> householdsNeedingMaintenance() {
    return jdbc.queryForList(
        """
            SELECT DISTINCT household_id FROM member_away_periods
            WHERE levelled_at IS NULL OR (until_back AND ending_reminder_for IS DISTINCT FROM ends_on)
            ORDER BY household_id
            """,
        UUID.class);
  }

  /**
   * The hourly pass for one household: members back from an away period are brought level with the
   * others (once), and "Until I'm back" periods remind their member the day before they end.
   */
  @Transactional
  public void maintain(UUID householdId) {
    lockHousehold(householdId);
    ZoneId zone = householdZone(householdId);
    LocalDate today = LocalDate.now(clock.withZone(zone));
    if (levelReturned(householdId, today)) {
      occurrenceService.replanForAway(householdId);
    }
    sendEndingReminders(householdId, zone);
  }

  /**
   * Brings every member back from a period that has ended (before {@code today}) level in each
   * rotation they're in. Returns whether any period was levelled.
   */
  private boolean levelReturned(UUID householdId, LocalDate today) {
    List<AwayPeriods.Period> periods = awayPeriods.household(householdId);
    List<AwayPeriods.Period> returned =
        periods.stream()
            .filter(period -> !period.levelled() && period.endsOn().isBefore(today))
            .toList();
    if (returned.isEmpty()) {
      return false;
    }
    List<UUID> scheduleIds =
        jdbc.queryForList(
            "SELECT id FROM chore_schedules WHERE household_id=? AND is_active ORDER BY id",
            UUID.class,
            householdId);
    for (AwayPeriods.Period period : returned) {
      for (UUID scheduleId : scheduleIds) {
        ChoreSchedule schedule = scheduleRepository.findByIdForUpdate(scheduleId).orElse(null);
        if (schedule == null) {
          continue;
        }
        entityManager.refresh(schedule);
        if (occurrenceService.levelOnReturn(schedule, period, periods)) {
          scheduleRepository.saveAndFlush(schedule);
        }
      }
      jdbc.update(
          "UPDATE member_away_periods SET levelled_at=NOW() WHERE id=? AND levelled_at IS NULL",
          period.id());
    }
    return true;
  }

  private void sendEndingReminders(UUID householdId, ZoneId zone) {
    OffsetDateTime now = OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
    LocalDate today = now.atZoneSameInstant(zone).toLocalDate();
    List<Map<String, Object>> due =
        jdbc.queryForList(
            """
                SELECT id, user_id, ends_on FROM member_away_periods
                WHERE household_id=? AND until_back AND ends_on=?
                  AND ending_reminder_for IS DISTINCT FROM ends_on
                """,
            householdId,
            today.plusDays(1));
    OffsetDateTime sendAt =
        today
            .atTime(ENDING_REMINDER_TIME)
            .atZone(zone)
            .toOffsetDateTime()
            .withOffsetSameInstant(ZoneOffset.UTC);
    if (due.isEmpty() || now.isBefore(sendAt)) {
      return;
    }
    for (Map<String, Object> row : due) {
      LocalDate endsOn = ((java.sql.Date) row.get("ends_on")).toLocalDate();
      notificationEventService.publish(
          new NotificationEvent(
              ENDING_REMINDER,
              null,
              householdId,
              "HOUSEHOLD",
              householdId,
              "HOUSEHOLD",
              Map.of(
                  "return_day", DAY.format(endsOn.plusDays(1)), "scheduled_at", sendAt.toString()),
              List.of((UUID) row.get("user_id"))));
      jdbc.update(
          "UPDATE member_away_periods SET ending_reminder_for=ends_on WHERE id=?", row.get("id"));
    }
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private void replan(Access access) {
    occurrenceService.replanForAway(access.householdId());
    cancelAwayReminders(access.householdId(), access.targetId());
  }

  /**
   * The away member's pending chore notifications for their away days (or due to go out while they
   * are away) are cancelled now, not just held back when they come due.
   */
  private void cancelAwayReminders(UUID householdId, UUID userId) {
    String scope =
        """
        n.recipient_user_id=? AND n.reference_type='CHORE_ASSIGNMENT'
        AND n.type IN ('CHORE_ASSIGNED','CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE',
                       'CHORE_NEEDS_DOING','CHORE_TURN','CHORE_OCCURRENCE_MOVED',
                       'CHORE_OCCURRENCE_SKIPPED')
        AND EXISTS (
            SELECT 1 FROM chore_assignments a
            JOIN households h ON h.id=a.household_id
            JOIN member_away_periods p ON p.household_id=a.household_id AND p.user_id=?
            WHERE a.id=n.reference_id AND a.household_id=?
              AND ((a.scheduled_for BETWEEN p.starts_on AND p.ends_on)
                   OR ((n.scheduled_at AT TIME ZONE h.timezone)::date
                       BETWEEN p.starts_on AND p.ends_on)))
        """;
    jdbc.update(
        "UPDATE notification_deliveries d SET status='CANCELLED' FROM notifications n"
            + " WHERE d.notification_id=n.id AND d.status IN ('PENDING','FAILED')"
            + " AND n.status='PENDING' AND "
            + scope,
        userId,
        userId,
        householdId);
    jdbc.update(
        "UPDATE notification_push_delivery_targets t SET status='CANCELLED',"
            + " next_attempt_at=NULL, updated_at=NOW() FROM notifications n"
            + " WHERE t.notification_id=n.id AND t.status IN ('PENDING','FAILED')"
            + " AND n.status='PENDING' AND "
            + scope,
        userId,
        userId,
        householdId);
    jdbc.update(
        "UPDATE notifications n SET status='CANCELLED' WHERE n.status='PENDING' AND " + scope,
        userId,
        userId,
        householdId);
  }

  private void remove(Row period) {
    jdbc.update("DELETE FROM member_away_periods WHERE id=?", period.id());
    if (period.boardPostId() != null) {
      boardPostService.deleteAwayNotice(period.boardPostId());
    }
  }

  private AwayStatusResponse statusOf(Access access) {
    Row row = currentOrUpcoming(access.householdId(), access.targetId());
    if (row == null) {
      return new AwayStatusResponse(access.targetId(), access.targetName(), null, List.of());
    }
    LocalDate today = access.today();
    LocalDate from = row.startsOn().isBefore(today) ? today : row.startsOn();
    return new AwayStatusResponse(
        access.targetId(),
        access.targetName(),
        new AwayStatusResponse.Period(
            row.id(),
            row.startsOn(),
            row.endsOn(),
            row.endsOn().plusDays(1),
            row.untilBack(),
            row.startsOn().isAfter(today) ? "UPCOMING" : "ACTIVE"),
        occurrenceService.awayEffects(access.householdId(), access.targetId(), from, row.endsOn()));
  }

  /** The member's period that hasn't ended yet (at most one), or null. */
  private Row currentOrUpcoming(UUID householdId, UUID userId) {
    LocalDate today = LocalDate.now(clock.withZone(householdZone(householdId)));
    List<Row> rows =
        jdbc.query(
            """
                SELECT id, starts_on, ends_on, until_back, board_post_id
                FROM member_away_periods
                WHERE household_id=? AND user_id=? AND ends_on>=?
                ORDER BY starts_on LIMIT 1
                """,
            (rs, n) ->
                new Row(
                    rs.getObject("id", UUID.class),
                    rs.getObject("starts_on", LocalDate.class),
                    rs.getObject("ends_on", LocalDate.class),
                    rs.getBoolean("until_back"),
                    rs.getObject("board_post_id", UUID.class)),
            householdId,
            userId,
            today);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  /**
   * The dates as they'd be saved. New dates start today or later; a period that has started may
   * keep its start. At most 90 days from the start; "Until I'm back" ends 90 days from today (or
   * from the start, if that is sooner).
   */
  private Dates validate(AwayPeriodRequest request, LocalDate today, Row existing) {
    if (request == null || request.startsOn() == null) {
      throw new InvalidHouseholdException("Choose when you're away from.");
    }
    LocalDate startsOn = request.startsOn();
    boolean keepsStart = existing != null && existing.startsOn().equals(startsOn);
    if (startsOn.isBefore(today) && !keepsStart) {
      throw new InvalidHouseholdException("Away mode can't start in the past.");
    }
    boolean untilBack = Boolean.TRUE.equals(request.untilBack());
    LocalDate endsOn;
    if (untilBack) {
      LocalDate limit = startsOn.plusDays(MAX_DAYS);
      endsOn = today.plusDays(MAX_DAYS).isBefore(limit) ? today.plusDays(MAX_DAYS) : limit;
    } else {
      endsOn = request.endsOn();
      if (endsOn == null) {
        throw new InvalidHouseholdException("Choose when you're back.");
      }
    }
    if (endsOn.isBefore(startsOn)) {
      throw new InvalidHouseholdException("The end date can't be before the start date.");
    }
    if (endsOn.isBefore(today)) {
      throw new InvalidHouseholdException("Choose an end date from today on.");
    }
    if (ChronoUnit.DAYS.between(startsOn, endsOn) > MAX_DAYS) {
      throw new InvalidHouseholdException("Away mode can last up to 90 days.");
    }
    return new Dates(startsOn, endsOn, untilBack);
  }

  private String noticeTitle(String name, Dates dates) {
    String when =
        dates.untilBack()
            ? "from " + DAY.format(dates.startsOn())
            : dates.startsOn().equals(dates.endsOn())
                ? DAY.format(dates.startsOn())
                : DAY.format(dates.startsOn()) + " – " + DAY.format(dates.endsOn());
    String suffix = " is away " + when;
    String trimmed =
        name.length() + suffix.length() > 120 ? name.substring(0, 120 - suffix.length()) : name;
    return trimmed + suffix;
  }

  private String noticeDetails(Dates dates, boolean self) {
    String covered =
        self ? "My turns are covered by the app." : "Their turns are covered by the app.";
    return dates.untilBack()
        ? covered
        : "Back " + DAY.format(dates.endsOn().plusDays(1)) + ". " + covered;
  }

  /**
   * The actor and the member whose away mode it is. A non-member of the household gets 404, as does
   * a target who isn't an active member; a member acting for someone else gets 403.
   */
  private Access access(
      UUID householdId, UUID targetId, Authentication authentication, boolean write) {
    if (authentication == null || authentication.getName() == null) {
      throw new ResourceNotFoundException("Household not found.");
    }
    User actor =
        userRepository
            .findByEmailIgnoreCase(authentication.getName())
            .filter(user -> user.getAccountStatus() == AccountStatus.ACTIVE)
            .orElseThrow(() -> new ResourceNotFoundException("Household not found."));
    if (write) {
      lockHousehold(householdId);
    }
    String actorRole = role(householdId, actor.getId());
    if (actorRole == null) {
      throw new ResourceNotFoundException("Household not found.");
    }
    String targetRole = role(householdId, targetId);
    if (targetRole == null) {
      throw new ResourceNotFoundException("Member not found.");
    }
    boolean self = actor.getId().equals(targetId);
    if (!self && !"OWNER".equals(actorRole) && !"ADMIN".equals(actorRole)) {
      throw new HouseholdAccessDeniedException(
          "Only owners and admins can set away mode for someone else.");
    }
    String name =
        jdbc.queryForObject("SELECT display_name FROM users WHERE id=?", String.class, targetId);
    return new Access(
        householdId,
        actor.getId(),
        targetId,
        name,
        self,
        LocalDate.now(clock.withZone(householdZone(householdId))));
  }

  private String role(UUID householdId, UUID userId) {
    List<String> roles =
        jdbc.queryForList(
            """
                SELECT m.role FROM household_memberships m JOIN users u ON u.id=m.user_id
                WHERE m.household_id=? AND m.user_id=? AND m.status='ACTIVE'
                  AND u.account_status='ACTIVE'
                """,
            String.class,
            householdId,
            userId);
    return roles.isEmpty() ? null : roles.getFirst();
  }

  private void lockHousehold(UUID householdId) {
    if (jdbc.queryForList(
            "SELECT id FROM households WHERE id=? FOR UPDATE", UUID.class, householdId)
        .isEmpty()) {
      throw new ResourceNotFoundException("Household not found.");
    }
  }

  private ZoneId householdZone(UUID householdId) {
    List<String> zones =
        jdbc.queryForList("SELECT timezone FROM households WHERE id=?", String.class, householdId);
    if (zones.isEmpty()) {
      throw new ResourceNotFoundException("Household not found.");
    }
    return ZoneId.of(zones.getFirst());
  }

  private record Access(
      UUID householdId,
      UUID actorId,
      UUID targetId,
      String targetName,
      boolean self,
      LocalDate today) {}

  private record Row(
      UUID id, LocalDate startsOn, LocalDate endsOn, boolean untilBack, UUID boardPostId) {}

  private record Dates(LocalDate startsOn, LocalDate endsOn, boolean untilBack) {}
}
