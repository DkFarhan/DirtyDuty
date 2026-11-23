package com.dirtyduty.app.service;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Fairness effort (E8): how much chore work each member has done, and how many days they were
 * around to do it. A completion's {@code effort_points} is the chore's effort (difficulty 1–5) when
 * it was done. This is fairness effort only; reward points (bonuses, streaks) are a separate,
 * future number and never feed into it.
 */
@Component
public class EffortLedger {
  /** How far back "lately" looks. */
  public static final int WINDOW_DAYS = 28;

  /** Fewer present days than this count as this many, so newcomers aren't treated as idle. */
  public static final int MIN_PRESENT_DAYS = 7;

  private final JdbcTemplate jdbc;
  private final AwayPeriods awayPeriods;

  public EffortLedger(JdbcTemplate jdbc, AwayPeriods awayPeriods) {
    this.jdbc = jdbc;
    this.awayPeriods = awayPeriods;
  }

  /**
   * Completed fairness effort per member from {@code from} up to and including {@code to}: the
   * points of each completed occurrence's latest completion, credited to whoever completed it.
   */
  public Map<UUID, Integer> completedEffort(
      UUID householdId, OffsetDateTime from, OffsetDateTime to) {
    Map<UUID, Integer> effort = new HashMap<>();
    jdbc.query(
        """
            SELECT last.completed_by_user_id, SUM(last.effort_points)
            FROM chore_assignments a
            JOIN LATERAL (SELECT completed_by_user_id, completed_at, effort_points
                          FROM chore_completions c WHERE c.assignment_id=a.id
                          ORDER BY c.completed_at DESC, c.attempt_number DESC LIMIT 1) last ON TRUE
            WHERE a.household_id=? AND a.status='COMPLETED'
              AND last.completed_at>=? AND last.completed_at<=?
            GROUP BY last.completed_by_user_id
            """,
        rs -> {
          effort.put(rs.getObject(1, UUID.class), rs.getInt(2));
        },
        householdId,
        from,
        to);
    return effort;
  }

  /**
   * Days in {@code [from, until)} each active member was a member and not away. Members who are no
   * longer active are left out.
   */
  public Map<UUID, Integer> presentDays(UUID householdId, LocalDate from, LocalDate until) {
    Snapshot presence = presence(householdId);
    Map<UUID, Integer> days = new LinkedHashMap<>();
    for (UUID userId : presence.joinedOn.keySet()) {
      days.put(userId, presence.presentDays(userId, from, until));
    }
    return days;
  }

  /**
   * What Balanced reads, loaded once for a household and kept up to date by the caller as it
   * assigns: completed effort from {@value #WINDOW_DAYS} days before {@code today} up to {@code
   * now}, the pending occurrences dated from today on, membership start days and away periods.
   */
  public Workloads workloads(UUID householdId, ZoneId zone, LocalDate today, OffsetDateTime now) {
    LocalDate windowStart = today.minusDays(WINDOW_DAYS);
    Map<UUID, Integer> completed =
        completedEffort(householdId, windowStart.atStartOfDay(zone).toOffsetDateTime(), now);
    Map<UUID, PendingWork> pending = new HashMap<>();
    jdbc.query(
        """
            SELECT a.id, a.scheduled_for, a.difficulty_snapshot,
                   ARRAY(SELECT aa.user_id FROM chore_assignment_assignees aa
                         WHERE aa.assignment_id=a.id ORDER BY aa.user_id) users
            FROM chore_assignments a
            WHERE a.household_id=? AND a.status='PENDING' AND a.scheduled_for>=?
            """,
        rs -> {
          pending.put(
              rs.getObject("id", UUID.class),
              new PendingWork(
                  rs.getObject("scheduled_for", LocalDate.class),
                  rs.getInt("difficulty_snapshot"),
                  uuids(rs.getArray("users"))));
        },
        householdId,
        today);
    return new Workloads(
        householdId, today, windowStart, completed, pending, presence(householdId));
  }

  private Snapshot presence(UUID householdId) {
    Map<UUID, LocalDate> joinedOn = new LinkedHashMap<>();
    jdbc.query(
        """
            SELECT m.user_id, (m.joined_at AT TIME ZONE h.timezone)::date joined_on
            FROM household_memberships m JOIN households h ON h.id=m.household_id
            WHERE m.household_id=? AND m.status='ACTIVE'
            ORDER BY m.user_id
            """,
        rs -> {
          joinedOn.put(
              rs.getObject("user_id", UUID.class), rs.getObject("joined_on", LocalDate.class));
        },
        householdId);
    return new Snapshot(joinedOn, awayPeriods.household(householdId));
  }

  private static List<UUID> uuids(java.sql.Array array) throws java.sql.SQLException {
    List<UUID> ids = new ArrayList<>();
    if (array != null) {
      for (Object value : (Object[]) array.getArray()) {
        ids.add(value instanceof UUID id ? id : UUID.fromString(String.valueOf(value)));
      }
    }
    return List.copyOf(ids);
  }

  /** A pending occurrence's date, fairness effort and people. */
  public record PendingWork(LocalDate day, int effort, List<UUID> users) {}

  /** Membership start days of active members and the household's away periods. */
  private record Snapshot(Map<UUID, LocalDate> joinedOn, List<AwayPeriods.Period> periods) {
    int presentDays(UUID userId, LocalDate from, LocalDate until) {
      if (!joinedOn.containsKey(userId)) {
        return 0;
      }
      LocalDate joined = joinedOn.get(userId);
      LocalDate start = joined != null && joined.isAfter(from) ? joined : from;
      if (!start.isBefore(until)) {
        return 0;
      }
      long days = start.until(until, java.time.temporal.ChronoUnit.DAYS);
      for (AwayPeriods.Period period : periods) {
        if (!period.userId().equals(userId)) {
          continue;
        }
        LocalDate awayFrom = period.startsOn().isAfter(start) ? period.startsOn() : start;
        LocalDate awayUntil = period.returnsOn().isBefore(until) ? period.returnsOn() : until;
        if (awayFrom.isBefore(awayUntil)) {
          days -= awayFrom.until(awayUntil, java.time.temporal.ChronoUnit.DAYS);
        }
      }
      return (int) Math.max(0, days);
    }
  }

  /** A member's workload for a pick: effort over present days (at least the minimum). */
  public record Workload(UUID userId, long effort, int presentDays) {
    /** Lower workload first, compared exactly (no floating point). */
    static final Comparator<Workload> LIGHTEST_FIRST =
        (left, right) ->
            Long.compare(left.effort * right.presentDays, right.effort * left.presentDays);
  }

  /**
   * Balanced's working view of one household during a generation run. Picks read it; every
   * assignment Balanced makes (or re-makes) is written back through {@link #assigned} so later
   * picks in the same run see it, without reloading.
   */
  public static final class Workloads {
    private final UUID householdId;
    private final LocalDate today;
    private final LocalDate windowStart;
    private final Map<UUID, Integer> completed;
    private final Map<UUID, PendingWork> pending;
    private final Snapshot presence;
    private final Map<UUID, Map<UUID, OffsetDateTime>> lastDoneBySchedule = new HashMap<>();

    Workloads(
        UUID householdId,
        LocalDate today,
        LocalDate windowStart,
        Map<UUID, Integer> completed,
        Map<UUID, PendingWork> pending,
        Snapshot presence) {
      this.householdId = householdId;
      this.today = today;
      this.windowStart = windowStart;
      this.completed = completed;
      this.pending = pending;
      this.presence = presence;
    }

    public UUID householdId() {
      return householdId;
    }

    public LocalDate today() {
      return today;
    }

    /** Each person's latest completion of a schedule, loaded once per schedule per run. */
    public Map<UUID, OffsetDateTime> lastDone(
        UUID scheduleId, java.util.function.Function<UUID, Map<UUID, OffsetDateTime>> loader) {
      return lastDoneBySchedule.computeIfAbsent(scheduleId, loader);
    }

    /**
     * Workload for an occurrence on {@code day}: completed effort in the window, plus the effort of
     * pending occurrences already theirs dated from today through {@code day} (leaving out {@code
     * exclude}, the occurrence being re-picked), over the days they were present from the window
     * start up to {@code day} (at least {@value #MIN_PRESENT_DAYS}).
     */
    public Workload workload(UUID userId, LocalDate day, UUID exclude) {
      LocalDate last = day.isBefore(today) ? today : day;
      long effort = completed.getOrDefault(userId, 0);
      for (Map.Entry<UUID, PendingWork> entry : pending.entrySet()) {
        PendingWork work = entry.getValue();
        if (!entry.getKey().equals(exclude)
            && work.users().contains(userId)
            && !work.day().isBefore(today)
            && !work.day().isAfter(last)) {
          effort += work.effort();
        }
      }
      int present = Math.max(MIN_PRESENT_DAYS, presence.presentDays(userId, windowStart, last));
      return new Workload(userId, effort, present);
    }

    /**
     * The {@code count} lightest of {@code eligible} (in participant order) for {@code day}. Ties
     * go to whoever completed this chore longest ago (never counts as longest), then to the earlier
     * participant.
     */
    public List<UUID> pick(
        List<UUID> eligible,
        LocalDate day,
        int count,
        Map<UUID, OffsetDateTime> lastDone,
        UUID exclude) {
      List<Workload> loads = new ArrayList<>();
      for (UUID userId : eligible) {
        loads.add(workload(userId, day, exclude));
      }
      Comparator<Workload> longestSinceDone =
          (left, right) -> {
            OffsetDateTime a = lastDone.get(left.userId());
            OffsetDateTime b = lastDone.get(right.userId());
            if (a == null || b == null) {
              return a == null ? (b == null ? 0 : -1) : 1;
            }
            return a.compareTo(b);
          };
      // List.sort is stable, so equal people keep participant order.
      loads.sort(Workload.LIGHTEST_FIRST.thenComparing(longestSinceDone));
      return loads.stream().limit(Math.max(0, count)).map(Workload::userId).toList();
    }

    /** Records who now has a pending occurrence ({@code users} empty: it no longer counts). */
    public void assigned(UUID occurrenceId, LocalDate day, int effort, List<UUID> users) {
      if (users == null || users.isEmpty() || day == null) {
        pending.remove(occurrenceId);
      } else {
        pending.put(occurrenceId, new PendingWork(day, effort, List.copyOf(users)));
      }
    }
  }
}
