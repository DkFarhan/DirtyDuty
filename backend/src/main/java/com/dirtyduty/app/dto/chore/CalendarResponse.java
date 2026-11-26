package com.dirtyduty.app.dto.chore;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The household calendar for {@code from}..{@code to} (inclusive, household dates).
 *
 * <p>{@code days} has one entry per day in the range, each with its occurrences: stored ones (to do
 * or done; skipped, paused and cancelled ones are left out) and projected ones ({@code projected}:
 * dates the chore's rule produces that are not generated yet; never stored). A projected item names
 * its people only when they can be predicted (Just me, Specific people, Take turns, Week by week);
 * otherwise {@code toBeDecided} is set and {@code assignees} is empty.
 *
 * <p>{@code undated} lists open "When needed" (and other open-copy) occurrences with no deadline.
 * {@code counts} is how many occurrences in the range each active member has. {@code members} are
 * the active members in join order ({@code colorIndex} is their place in that order).
 */
public record CalendarResponse(
    LocalDate from,
    LocalDate to,
    LocalDate today,
    String timezone,
    String viewerRole,
    List<Member> members,
    List<Day> days,
    List<Undated> undated,
    List<MemberCount> counts) {

  public record Member(UUID userId, String displayName, String role, int colorIndex) {}

  public record Day(LocalDate date, List<Item> items) {}

  /**
   * @param id the stored occurrence, or null for a projected one
   * @param status PENDING or COMPLETED (projected items are PENDING)
   */
  public record Item(
      UUID id,
      UUID choreId,
      String title,
      String categoryName,
      String categoryIcon,
      String kind,
      String status,
      LocalDate date,
      OffsetDateTime dueAt,
      List<AssigneeResponse> assignees,
      boolean projected,
      boolean toBeDecided) {}

  /**
   * @param flagged someone flagged it as needing doing
   * @param turn whose turn it is, empty when anyone can do it
   */
  public record Undated(
      UUID id,
      UUID choreId,
      String title,
      String kind,
      boolean flagged,
      List<AssigneeResponse> turn) {}

  public record MemberCount(UUID userId, int count) {}
}
