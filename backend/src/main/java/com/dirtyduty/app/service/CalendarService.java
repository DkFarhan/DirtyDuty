package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.AssigneeResponse;
import com.dirtyduty.app.dto.chore.CalendarResponse;
import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.IntervalUnit;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The household calendar (6c): stored occurrences for a date range plus projected ones the chores'
 * rules will produce later. Read-only: projections are never stored and nothing is generated.
 *
 * <p>Projected people follow the same rules generation uses ({@link OccurrenceService}'s
 * selection), simulated forward in memory from the stored history: Just me and Specific people
 * (FIXED), Take turns (ROUND_ROBIN) and Week by week, including away periods (covering and pausing)
 * and the "level on return" credit. Balanced and Mix it up can't be predicted, so their projected
 * occurrences have nobody ("To be decided"). Everything is read with a fixed number of queries per
 * request, whatever the range.
 */
@Service
public class CalendarService {
  /** The longest range one request may ask for, in days (a month view plus slack). */
  public static final int MAX_RANGE_DAYS = 45;

  /** How far ahead the calendar goes, so a projection never simulates years of turns. */
  public static final int MAX_DAYS_AHEAD = 731;

  private final JdbcTemplate jdbc;
  private final ChoreScheduleRepository scheduleRepository;
  private final HouseholdMembershipRepository membershipRepository;
  private final UserRepository userRepository;
  private final AwayPeriods awayPeriods;
  private final OccurrenceService occurrenceService;

  public CalendarService(
      JdbcTemplate jdbc,
      ChoreScheduleRepository scheduleRepository,
      HouseholdMembershipRepository membershipRepository,
      UserRepository userRepository,
      AwayPeriods awayPeriods,
      OccurrenceService occurrenceService) {
    this.jdbc = jdbc;
    this.scheduleRepository = scheduleRepository;
    this.membershipRepository = membershipRepository;
    this.userRepository = userRepository;
    this.awayPeriods = awayPeriods;
    this.occurrenceService = occurrenceService;
  }

  /** Same clock as generation, so tests that pin one pin both. */
  private Clock clock() {
    return occurrenceService.clock();
  }

  @Transactional(readOnly = true)
  public CalendarResponse calendar(
      UUID householdId, LocalDate from, LocalDate to, Authentication authentication) {
    String viewerRole = viewerRole(householdId, authentication);
    if (from == null || to == null || to.isBefore(from)) {
      throw new InvalidHouseholdException("Choose a start date on or before the end date.");
    }
    if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
      throw new InvalidHouseholdException(
          "The calendar shows up to %d days at a time.".formatted(MAX_RANGE_DAYS));
    }
    String timezone =
        jdbc.queryForObject(
            "SELECT timezone FROM households WHERE id=?", String.class, householdId);
    ZoneId zone = ZoneId.of(timezone);
    LocalDate today = LocalDate.now(clock().withZone(zone));
    if (to.isAfter(today.plusDays(MAX_DAYS_AHEAD))) {
      throw new InvalidHouseholdException("The calendar shows up to two years ahead.");
    }

    List<CalendarResponse.Member> members = members(householdId);
    Map<UUID, String> names = new HashMap<>();
    members.forEach(member -> names.put(member.userId(), member.displayName()));

    Map<LocalDate, List<CalendarResponse.Item>> byDay = new LinkedHashMap<>();
    for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
      byDay.put(day, new ArrayList<>());
    }
    storedItems(householdId, from, to).forEach(item -> byDay.get(item.date()).add(item));
    projectedItems(householdId, from, to, names).forEach(item -> byDay.get(item.date()).add(item));

    Comparator<CalendarResponse.Item> order =
        Comparator.comparing(
                CalendarResponse.Item::dueAt, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(CalendarResponse.Item::title, String.CASE_INSENSITIVE_ORDER);
    List<CalendarResponse.Day> days = new ArrayList<>();
    Map<UUID, Integer> counts = new LinkedHashMap<>();
    members.forEach(member -> counts.put(member.userId(), 0));
    byDay.forEach(
        (day, items) -> {
          items.sort(order);
          days.add(new CalendarResponse.Day(day, List.copyOf(items)));
          for (CalendarResponse.Item item : items) {
            for (AssigneeResponse assignee : item.assignees()) {
              counts.computeIfPresent(assignee.userId(), (userId, count) -> count + 1);
            }
          }
        });

    return new CalendarResponse(
        from,
        to,
        today,
        timezone,
        viewerRole,
        members,
        days,
        undated(householdId),
        counts.entrySet().stream()
            .map(entry -> new CalendarResponse.MemberCount(entry.getKey(), entry.getValue()))
            .toList());
  }

  /** The viewer's role; anyone who isn't an active member gets a 404, as if it didn't exist. */
  private String viewerRole(UUID householdId, Authentication authentication) {
    ResourceNotFoundException notFound = new ResourceNotFoundException("Household not found.");
    if (authentication == null || authentication.getName() == null) {
      throw notFound;
    }
    User user =
        userRepository
            .findByEmailIgnoreCase(authentication.getName())
            .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
            .orElseThrow(() -> notFound);
    return membershipRepository
        .findByHousehold_IdAndUser_Id(householdId, user.getId())
        .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
        .orElseThrow(() -> notFound)
        .getRole()
        .name();
  }

  private List<CalendarResponse.Member> members(UUID householdId) {
    int[] index = {0};
    return jdbc.query(
        """
            SELECT m.user_id, u.display_name, m.role FROM household_memberships m
            JOIN users u ON u.id=m.user_id
            WHERE m.household_id=? AND m.status='ACTIVE'
            ORDER BY m.joined_at NULLS FIRST, m.created_at, m.user_id
            """,
        (rs, row) ->
            new CalendarResponse.Member(
                rs.getObject("user_id", UUID.class),
                rs.getString("display_name"),
                rs.getString("role"),
                index[0]++),
        householdId);
  }

  // ---- Stored occurrences ----------------------------------------------------------------------

  /**
   * Open copies with no set date: "When needed" with no backstop (flagging pulls its deadline to
   * now, but it still has no set date) and any other open copy without a deadline. Needs the
   * schedule joined as {@code s}.
   */
  private static final String UNDATED =
      """
      (COALESCE(a.kind_snapshot,'CALENDAR')<>'CALENDAR' AND a.status IN ('PENDING','SUBMITTED')
       AND (a.due_at IS NULL OR (a.kind_snapshot='AS_NEEDED' AND s.backstop_days IS NULL)))
      """;

  /** Shown on its day: to do or done, not skipped, paused, cancelled or undated. */
  private static final String STORED_FILTER =
      """
      a.household_id=? AND a.scheduled_for>=? AND a.scheduled_for<=?
        AND a.status IN ('PENDING','SUBMITTED','COMPLETED') AND NOT a.away_paused
        AND NOT %s
      """
          .formatted(UNDATED);

  private List<CalendarResponse.Item> storedItems(UUID householdId, LocalDate from, LocalDate to) {
    Map<UUID, List<AssigneeResponse>> assignees = new HashMap<>();
    jdbc.query(
        """
            SELECT aa.assignment_id, aa.user_id, u.display_name
            FROM chore_assignment_assignees aa
            JOIN chore_assignments a ON a.id=aa.assignment_id
            LEFT JOIN chore_schedules s ON s.id=a.schedule_id
            JOIN users u ON u.id=aa.user_id
            WHERE %s
            ORDER BY aa.created_at, aa.user_id
            """
            .formatted(STORED_FILTER),
        rs -> {
          assignees
              .computeIfAbsent(rs.getObject("assignment_id", UUID.class), id -> new ArrayList<>())
              .add(
                  new AssigneeResponse(
                      rs.getObject("user_id", UUID.class), rs.getString("display_name")));
        },
        householdId,
        from,
        to);
    return jdbc.query(
        """
            SELECT a.id, a.chore_id, a.title_snapshot, c.name category_name,
                   c.icon_key category_icon, COALESCE(a.kind_snapshot,'CALENDAR') kind, a.status,
                   a.scheduled_for, a.due_at
            FROM chore_assignments a
            JOIN chores ch ON ch.id=a.chore_id
            LEFT JOIN chore_categories c ON c.id=ch.category_id
            LEFT JOIN chore_schedules s ON s.id=a.schedule_id
            WHERE %s
            """
            .formatted(STORED_FILTER),
        (rs, row) -> {
          UUID id = rs.getObject("id", UUID.class);
          return new CalendarResponse.Item(
              id,
              rs.getObject("chore_id", UUID.class),
              rs.getString("title_snapshot"),
              rs.getString("category_name"),
              rs.getString("category_icon"),
              rs.getString("kind"),
              "COMPLETED".equals(rs.getString("status")) ? "COMPLETED" : "PENDING",
              rs.getObject("scheduled_for", LocalDate.class),
              rs.getObject("due_at", OffsetDateTime.class),
              List.copyOf(assignees.getOrDefault(id, List.of())),
              false,
              false);
        },
        householdId,
        from,
        to);
  }

  private List<CalendarResponse.Undated> undated(UUID householdId) {
    String filter = "a.household_id=? AND NOT a.away_paused AND " + UNDATED;
    Map<UUID, List<AssigneeResponse>> turns = new HashMap<>();
    jdbc.query(
        """
            SELECT aa.assignment_id, aa.user_id, u.display_name
            FROM chore_assignment_assignees aa
            JOIN chore_assignments a ON a.id=aa.assignment_id
            LEFT JOIN chore_schedules s ON s.id=a.schedule_id
            JOIN users u ON u.id=aa.user_id
            WHERE %s
            ORDER BY aa.created_at, aa.user_id
            """
            .formatted(filter),
        rs -> {
          turns
              .computeIfAbsent(rs.getObject("assignment_id", UUID.class), id -> new ArrayList<>())
              .add(
                  new AssigneeResponse(
                      rs.getObject("user_id", UUID.class), rs.getString("display_name")));
        },
        householdId);
    return jdbc.query(
        """
            SELECT a.id, a.chore_id, a.title_snapshot, a.kind_snapshot,
                   a.flagged_at IS NOT NULL flagged
            FROM chore_assignments a
            LEFT JOIN chore_schedules s ON s.id=a.schedule_id
            WHERE %s
            ORDER BY a.flagged_at IS NULL, a.title_snapshot, a.id
            """
            .formatted(filter),
        (rs, row) -> {
          UUID id = rs.getObject("id", UUID.class);
          return new CalendarResponse.Undated(
              id,
              rs.getObject("chore_id", UUID.class),
              rs.getString("title_snapshot"),
              rs.getString("kind_snapshot"),
              rs.getBoolean("flagged"),
              List.copyOf(turns.getOrDefault(id, List.of())));
        },
        householdId);
  }

  // ---- Projections -----------------------------------------------------------------------------

  /** A stored or simulated occurrence, as far as turn counting cares. */
  record Turn(
      LocalDate plannedFor,
      boolean calendar,
      UUID assignedTo,
      UUID awayFrom,
      boolean overridden,
      List<UUID> assignees) {}

  private List<CalendarResponse.Item> projectedItems(
      UUID householdId, LocalDate from, LocalDate to, Map<UUID, String> names) {
    List<ChoreSchedule> schedules =
        scheduleRepository.findActiveWithChores(householdId).stream()
            .filter(
                schedule ->
                    schedule.getChore().isActive() && schedule.getChore().getArchivedAt() == null)
            .toList();
    if (schedules.isEmpty()) {
      return List.of();
    }
    // Dates already generated (cancelled rows come back when generation reaches them, except
    // those cancelled by someone leaving, which wait for an edit).
    Map<UUID, Set<LocalDate>> generated = new HashMap<>();
    jdbc.query(
        """
            SELECT schedule_id, planned_for FROM chore_assignments
            WHERE household_id=? AND schedule_id IS NOT NULL AND kind_snapshot='CALENDAR'
              AND (status<>'CANCELLED' OR cancelled_by_membership_exit)
              AND planned_for>=? AND planned_for<=?
            """,
        rs -> {
          generated
              .computeIfAbsent(rs.getObject("schedule_id", UUID.class), id -> new HashSet<>())
              .add(rs.getObject("planned_for", LocalDate.class));
        },
        householdId,
        LocalDate.now(clock()).minusDays(1),
        to);
    // Open "After it's done" copies, the base their next dates are counted from.
    Map<UUID, LocalDate> openCopies = new HashMap<>();
    jdbc.query(
        """
            SELECT schedule_id, scheduled_for FROM chore_assignments
            WHERE household_id=? AND kind_snapshot='AFTER_COMPLETION'
              AND status IN ('PENDING','SUBMITTED')
            """,
        rs -> {
          openCopies.put(
              rs.getObject("schedule_id", UUID.class),
              rs.getObject("scheduled_for", LocalDate.class));
        },
        householdId);
    Map<UUID, List<Turn>> history = rotationHistory(householdId);
    List<AwayPeriods.Period> periods = awayPeriods.household(householdId);

    List<CalendarResponse.Item> items = new ArrayList<>();
    for (ChoreSchedule schedule : schedules) {
      if (schedule.getKind() == ScheduleKind.CALENDAR) {
        items.addAll(
            projectCalendar(
                schedule,
                from,
                to,
                generated.getOrDefault(schedule.getId(), Set.of()),
                history.getOrDefault(schedule.getId(), List.of()),
                periods,
                names));
      } else if (schedule.getKind() == ScheduleKind.AFTER_COMPLETION
          && openCopies.containsKey(schedule.getId())) {
        items.addAll(projectAfterDone(schedule, openCopies.get(schedule.getId()), from, to));
      }
    }
    return items;
  }

  /** Every non-cancelled occurrence of the household's Take turns chores, with its people. */
  private Map<UUID, List<Turn>> rotationHistory(UUID householdId) {
    String filter =
        """
        a.household_id=? AND a.status<>'CANCELLED' AND a.schedule_id IN (
            SELECT id FROM chore_schedules
            WHERE household_id=? AND is_active AND assignment_strategy='ROUND_ROBIN'
              AND kind='CALENDAR')
        """;
    Map<UUID, List<UUID>> people = new HashMap<>();
    jdbc.query(
        """
            SELECT aa.assignment_id, aa.user_id FROM chore_assignment_assignees aa
            JOIN chore_assignments a ON a.id=aa.assignment_id
            WHERE %s
            """
            .formatted(filter),
        rs -> {
          people
              .computeIfAbsent(rs.getObject("assignment_id", UUID.class), id -> new ArrayList<>())
              .add(rs.getObject("user_id", UUID.class));
        },
        householdId,
        householdId);
    Map<UUID, List<Turn>> turns = new HashMap<>();
    jdbc.query(
        """
            SELECT a.id, a.schedule_id, a.planned_for, a.kind_snapshot, a.assigned_to_user_id,
                   a.away_from_user_id, a.assignees_overridden
            FROM chore_assignments a
            WHERE %s
            """
            .formatted(filter),
        rs -> {
          UUID id = rs.getObject("id", UUID.class);
          turns
              .computeIfAbsent(rs.getObject("schedule_id", UUID.class), key -> new ArrayList<>())
              .add(
                  new Turn(
                      rs.getObject("planned_for", LocalDate.class),
                      "CALENDAR".equals(rs.getString("kind_snapshot")),
                      rs.getObject("assigned_to_user_id", UUID.class),
                      rs.getObject("away_from_user_id", UUID.class),
                      rs.getBoolean("assignees_overridden"),
                      people.getOrDefault(id, List.of())));
        },
        householdId,
        householdId);
    return turns;
  }

  private List<CalendarResponse.Item> projectCalendar(
      ChoreSchedule schedule,
      LocalDate from,
      LocalDate to,
      Set<LocalDate> generated,
      List<Turn> history,
      List<AwayPeriods.Period> periods,
      Map<UUID, String> names) {
    RecurrenceRule rule;
    try {
      rule = RecurrenceRule.parse(schedule.getRecurrenceRule());
    } catch (InvalidHouseholdException invalid) {
      return List.of();
    }
    if (rule.isOneTime()) {
      // Created in full when it is saved; there is nothing later to project.
      return List.of();
    }
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    LocalDate today = LocalDate.now(clock().withZone(zone));
    LocalDate until = to.plusDays(1);
    if (schedule.getEndsOn() != null && schedule.getEndsOn().plusDays(1).isBefore(until)) {
      until = schedule.getEndsOn().plusDays(1);
    }
    LocalDate start = schedule.getStartsOn().isAfter(today) ? schedule.getStartsOn() : today;
    if (!start.isBefore(until)) {
      return List.of();
    }
    // Dates are simulated from today, so turns in the gap before the range count; only those in
    // the range are shown.
    List<LocalDate> dates =
        OccurrenceService.scheduleDates(
                rule,
                schedule.getStartsOn(),
                schedule.getCountRebasedOn(),
                schedule.getCountProducedBefore(),
                start,
                until)
            .stream()
            .filter(day -> !generated.contains(day))
            .toList();
    if (dates.isEmpty()) {
      return List.of();
    }
    AssignmentStrategy strategy = schedule.getAssignmentStrategy();
    boolean predictable =
        strategy == AssignmentStrategy.FIXED || strategy == AssignmentStrategy.ROUND_ROBIN;
    Rotation rotation = predictable ? new Rotation(schedule, rule, history, periods) : null;
    List<CalendarResponse.Item> items = new ArrayList<>();
    for (LocalDate day : dates) {
      List<UUID> people = List.of();
      if (rotation != null) {
        OccurrenceService.Selection selection = rotation.select(day);
        if (selection.paused()) {
          // Everyone who would do it is away: generation skips it, so it isn't shown.
          continue;
        }
        people = selection.assignees();
      }
      if (day.isBefore(from)) {
        continue;
      }
      items.add(
          projectedItem(
              schedule,
              day,
              zone,
              schedule.getDueTime(),
              people.stream()
                  .map(
                      userId ->
                          new AssigneeResponse(userId, names.getOrDefault(userId, "Former member")))
                  .toList(),
              rotation == null));
    }
    return items;
  }

  /**
   * "After it's done": the next dates, assuming each is done on its day; who does them depends on
   * who does the earlier ones, so nobody is predicted.
   */
  private List<CalendarResponse.Item> projectAfterDone(
      ChoreSchedule schedule, LocalDate openOn, LocalDate from, LocalDate to) {
    ZoneId zone = ZoneId.of(schedule.getTimezone());
    LocalDate today = LocalDate.now(clock().withZone(zone));
    int count = schedule.getIntervalCount() == null ? 1 : schedule.getIntervalCount();
    long stepDays = schedule.getIntervalUnit() == IntervalUnit.WEEK ? 7L * count : count;
    if (stepDays < 1) {
      return List.of();
    }
    // Overdue: it can't be done before today, so the next one comes an interval after today.
    LocalDate base = openOn.isBefore(today) ? today : openOn;
    List<CalendarResponse.Item> items = new ArrayList<>();
    for (LocalDate day = base.plusDays(stepDays); !day.isAfter(to); day = day.plusDays(stepDays)) {
      if (schedule.getEndsOn() != null && day.isAfter(schedule.getEndsOn())) {
        break;
      }
      if (!day.isBefore(from)) {
        LocalTime time =
            schedule.getDueTime() == null ? OccurrenceService.END_OF_DAY : schedule.getDueTime();
        items.add(projectedItem(schedule, day, zone, time, List.of(), true));
      }
    }
    return items;
  }

  private static CalendarResponse.Item projectedItem(
      ChoreSchedule schedule,
      LocalDate day,
      ZoneId zone,
      LocalTime dueTime,
      List<AssigneeResponse> assignees,
      boolean toBeDecided) {
    var chore = schedule.getChore();
    return new CalendarResponse.Item(
        null,
        chore.getId(),
        chore.getTitle(),
        chore.getCategory() == null ? null : chore.getCategory().getName(),
        chore.getCategory() == null ? null : chore.getCategory().getIconKey(),
        schedule.getKind().name(),
        "PENDING",
        day,
        dueTime == null ? null : OccurrenceService.dueAt(day, dueTime, zone),
        assignees,
        true,
        toBeDecided);
  }

  /**
   * One FIXED or ROUND_ROBIN calendar schedule's picks, simulated date by date in order. Mirrors
   * {@code OccurrenceService.selection} and the methods it calls, reading the stored history held
   * here (plus earlier simulated picks) instead of querying chore_assignments.
   */
  static final class Rotation {
    private final ChoreSchedule schedule;
    private final RecurrenceRule uncapped;
    private final List<Turn> turns;
    private final List<AwayPeriods.Period> periods;
    private final List<UUID> participants;
    private final Map<UUID, Integer> offsets;
    private final int needed;
    private final Integer weeks;
    private final LocalDate anchor;

    Rotation(
        ChoreSchedule schedule,
        RecurrenceRule rule,
        List<Turn> history,
        List<AwayPeriods.Period> periods) {
      this.schedule = schedule;
      this.uncapped = rule.withoutCount();
      this.turns = new ArrayList<>(history);
      this.periods = periods;
      Map<String, Object> config = schedule.getStrategyConfig();
      this.participants = participants(schedule);
      this.offsets = OccurrenceService.turnOffsets(config);
      Object value = config == null ? null : config.get("peopleNeeded");
      this.needed = value instanceof Number number ? Math.max(1, number.intValue()) : 1;
      boolean weekByWeek =
          schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN
              && RotationConfig.weeks(config) != null
              && RotationConfig.startsOn(config) != null;
      this.weeks = weekByWeek ? RotationConfig.weeks(config) : null;
      this.anchor = weekByWeek ? RotationConfig.startsOn(config) : null;
    }

    private static List<UUID> participants(ChoreSchedule schedule) {
      Object value =
          schedule.getStrategyConfig() == null
              ? null
              : schedule.getStrategyConfig().get("participantUserIds");
      if (value instanceof List<?> ids) {
        return ids.stream().map(Object::toString).map(UUID::fromString).toList();
      }
      return schedule.getFixedAssignee() == null
          ? List.of()
          : List.of(schedule.getFixedAssignee().getId());
    }

    /** Who generation would pick on {@code day}, recorded so later days count it. */
    OccurrenceService.Selection select(LocalDate day) {
      Set<UUID> away = new HashSet<>();
      for (AwayPeriods.Period period : periods) {
        if (period.covers(day)) {
          away.add(period.userId());
        }
      }
      OccurrenceService.Selection selection;
      List<UUID> usual = pick(day, Set.of());
      UUID awayFrom = usual.stream().filter(away::contains).findFirst().orElse(null);
      if (away.isEmpty() || awayFrom == null) {
        selection = new OccurrenceService.Selection(usual, null, false);
      } else {
        List<UUID> covered = pick(day, away);
        selection =
            covered.isEmpty()
                ? new OccurrenceService.Selection(List.of(), null, true)
                : new OccurrenceService.Selection(covered, awayFrom, false);
      }
      if (!selection.paused()) {
        List<UUID> people = selection.assignees();
        turns.add(
            new Turn(
                day,
                true,
                people.isEmpty() ? null : people.getFirst(),
                selection.awayFrom(),
                false,
                people));
      }
      return selection;
    }

    private List<UUID> pick(LocalDate day, Set<UUID> away) {
      List<UUID> pool = new ArrayList<>(participants);
      if (weeks != null) {
        return weekByWeekPick(day, pool, away);
      }
      if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
        if (pool.isEmpty() && schedule.getFixedAssignee() != null) {
          pool = List.of(schedule.getFixedAssignee().getId());
        }
        return pool.subList(0, Math.min(needed, pool.size())).stream()
            .filter(userId -> !away.contains(userId))
            .toList();
      }
      pool.removeIf(away::contains);
      int available = Math.min(needed, pool.size());
      if (available == 0) {
        return List.of();
      }
      Map<UUID, Integer> standing = standing(day);
      List<Integer> counts = pool.stream().map(userId -> standing.getOrDefault(userId, 0)).toList();
      int index = uncapped.countBefore(schedule.getStartsOn(), day);
      return OccurrenceService.rotate(pool, available, index, counts, pairCounts(day));
    }

    private List<UUID> weekByWeekPick(LocalDate day, List<UUID> pool, Set<UUID> away) {
      if (pool.isEmpty()) {
        return List.of();
      }
      UUID owner = weekOwner(day, pool);
      if (!away.contains(owner)) {
        return List.of(owner);
      }
      int start = pool.indexOf(owner);
      for (int step = 1; step < pool.size(); step++) {
        UUID candidate = pool.get(Math.floorMod(start + step, pool.size()));
        if (!away.contains(candidate)) {
          return List.of(candidate);
        }
      }
      return List.of();
    }

    private UUID weekOwner(LocalDate day, List<UUID> pool) {
      LocalDate start = RotationConfig.periodStart(anchor, weeks, day);
      Turn latest = null;
      for (Turn turn : turns) {
        UUID holder = turn.awayFrom() != null ? turn.awayFrom() : turn.assignedTo();
        if (turn.calendar()
            && !turn.overridden()
            && holder != null
            && !turn.plannedFor().isBefore(start)
            && turn.plannedFor().isBefore(day)
            && (latest == null || turn.plannedFor().isAfter(latest.plannedFor()))) {
          latest = turn;
        }
      }
      if (latest != null) {
        UUID holder = latest.awayFrom() != null ? latest.awayFrom() : latest.assignedTo();
        if (pool.contains(holder)) {
          return holder;
        }
      }
      Map<UUID, Integer> standing = standing(start);
      List<Integer> counts = pool.stream().map(userId -> standing.getOrDefault(userId, 0)).toList();
      int index = (int) RotationConfig.periodIndex(anchor, weeks, day);
      return OccurrenceService.rotate(pool, 1, index, counts, Map.of()).getFirst();
    }

    /** Turns before {@code day}, plus offsets, plus level-on-return credits not stored yet. */
    private Map<UUID, Integer> standing(LocalDate day) {
      Map<UUID, Integer> credits = new HashMap<>();
      for (AwayPeriods.Period period : periods) {
        if (period.levelled()
            || !participants.contains(period.userId())
            || period.returnsOn().isAfter(day)) {
          continue;
        }
        Map<UUID, Integer> atReturn = plus(turnCounts(period.returnsOn()), offsets, credits);
        credits.merge(
            period.userId(),
            OccurrenceService.levelCredit(period, periods, participants, atReturn),
            Integer::sum);
      }
      return plus(turnCounts(day), offsets, credits);
    }

    private Map<UUID, Integer> turnCounts(LocalDate day) {
      Map<UUID, Integer> counts = new HashMap<>();
      if (weeks == null) {
        for (Turn turn : turns) {
          if (turn.plannedFor().isBefore(day)) {
            turn.assignees().forEach(userId -> counts.merge(userId, 1, Integer::sum));
          }
        }
        return counts;
      }
      long days = 7L * weeks;
      Map<UUID, Set<Long>> periodsHad = new HashMap<>();
      for (Turn turn : turns) {
        if (turn.calendar()
            && turn.plannedFor().isBefore(day)
            && turn.awayFrom() == null
            && !turn.overridden()
            && turn.assignedTo() != null) {
          periodsHad
              .computeIfAbsent(turn.assignedTo(), userId -> new HashSet<>())
              .add(Math.floorDiv(ChronoUnit.DAYS.between(anchor, turn.plannedFor()), days));
        }
      }
      periodsHad.forEach((userId, had) -> counts.put(userId, had.size()));
      return counts;
    }

    private Map<String, Integer> pairCounts(LocalDate day) {
      Map<String, Integer> pairs = new HashMap<>();
      if (needed < 2) {
        return pairs;
      }
      for (Turn turn : turns) {
        if (!turn.plannedFor().isBefore(day)) {
          continue;
        }
        List<UUID> people = turn.assignees();
        for (int i = 0; i < people.size(); i++) {
          for (int j = i + 1; j < people.size(); j++) {
            pairs.merge(OccurrenceService.pairKey(people.get(i), people.get(j)), 1, Integer::sum);
          }
        }
      }
      return pairs;
    }

    @SafeVarargs
    private static Map<UUID, Integer> plus(Map<UUID, Integer>... parts) {
      Map<UUID, Integer> sum = new HashMap<>();
      for (Map<UUID, Integer> part : parts) {
        part.forEach((userId, value) -> sum.merge(userId, value, Integer::sum));
      }
      return sum;
    }
  }
}
