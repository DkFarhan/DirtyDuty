package com.dirtyduty.app.service;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Read-only questions about members' away periods (E10), shared by chore generation and the
 * notification paths. Periods are inclusive dates in the household's time zone.
 */
@Component
public class AwayPeriods {
  /**
   * Chore notifications an away member doesn't get. Board and list notifications are unaffected.
   */
  static final Set<String> CHORE_TYPES =
      Set.of(
          "CHORE_ASSIGNED",
          "CHORE_DUE_SOON",
          "CHORE_DUE_NOW",
          "CHORE_OVERDUE",
          "CHORE_NEEDS_DOING",
          "CHORE_TURN",
          "CHORE_OCCURRENCE_MOVED",
          "CHORE_OCCURRENCE_SKIPPED");

  public record Period(
      UUID id, UUID userId, LocalDate startsOn, LocalDate endsOn, boolean levelled) {
    public LocalDate returnsOn() {
      return endsOn.plusDays(1);
    }

    public boolean covers(LocalDate day) {
      return !day.isBefore(startsOn) && !day.isAfter(endsOn);
    }
  }

  private final JdbcTemplate jdbc;

  public AwayPeriods(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /** Every period of the household's members, earliest first. */
  public List<Period> household(UUID householdId) {
    return jdbc.query(
        """
            SELECT id, user_id, starts_on, ends_on, levelled_at IS NOT NULL levelled
            FROM member_away_periods WHERE household_id=?
            ORDER BY starts_on, user_id
            """,
        (rs, row) ->
            new Period(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getObject("starts_on", LocalDate.class),
                rs.getObject("ends_on", LocalDate.class),
                rs.getBoolean("levelled")),
        householdId);
  }

  /** Who is away on {@code day} in this household. */
  public Set<UUID> awayOn(UUID householdId, LocalDate day) {
    return new HashSet<>(
        jdbc.queryForList(
            """
                SELECT user_id FROM member_away_periods
                WHERE household_id=? AND starts_on<=? AND ends_on>=?
                """,
            UUID.class,
            householdId,
            day,
            day));
  }

  /** The period covering {@code day} for this member, if any. */
  public Period covering(UUID householdId, UUID userId, LocalDate day) {
    return household(householdId).stream()
        .filter(period -> period.userId().equals(userId) && period.covers(day))
        .findFirst()
        .orElse(null);
  }

  /**
   * Whether a chore notification to {@code recipient} is held back because they are away: on the
   * occurrence's day, or on the day it would be delivered (so chore reminders stay off until they
   * are back). Only chore types about an occurrence or a schedule are affected.
   */
  public boolean suppresses(
      String type, String referenceType, UUID referenceId, UUID recipient, OffsetDateTime at) {
    if (type == null || !CHORE_TYPES.contains(type) || referenceId == null || recipient == null) {
      return false;
    }
    String householdSql;
    if ("CHORE_ASSIGNMENT".equals(referenceType)) {
      householdSql = "SELECT household_id, scheduled_for FROM chore_assignments WHERE id=?";
    } else if ("CHORE_SCHEDULE".equals(referenceType)) {
      householdSql =
          "SELECT household_id, NULL::date scheduled_for FROM chore_schedules WHERE id=?";
    } else {
      return false;
    }
    List<Object[]> rows =
        jdbc.query(
            householdSql,
            (rs, row) ->
                new Object[] {
                  rs.getObject("household_id", UUID.class),
                  rs.getObject("scheduled_for", LocalDate.class)
                },
            referenceId);
    if (rows.isEmpty()) {
      return false;
    }
    UUID householdId = (UUID) rows.getFirst()[0];
    LocalDate occurrenceDay = (LocalDate) rows.getFirst()[1];
    String zone =
        jdbc.queryForObject(
            "SELECT timezone FROM households WHERE id=?", String.class, householdId);
    LocalDate deliveryDay = at.atZoneSameInstant(ZoneId.of(zone)).toLocalDate();
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
                SELECT EXISTS (
                    SELECT 1 FROM member_away_periods
                    WHERE household_id=? AND user_id=?
                      AND ((starts_on<=? AND ends_on>=?)
                           OR (?::date IS NOT NULL AND starts_on<=?::date AND ends_on>=?::date))
                )
                """,
            Boolean.class,
            householdId,
            recipient,
            deliveryDay,
            deliveryDay,
            occurrenceDay,
            occurrenceDay,
            occurrenceDay));
  }
}
