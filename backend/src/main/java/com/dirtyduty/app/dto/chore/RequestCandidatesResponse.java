package com.dirtyduty.app.dto.chore;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Who the viewer could ask about one of their pending chores (E11). {@code members} are the other
 * members who could be listed, with {@code eligible} false (and {@code awayUntil} set) for someone
 * away that day; {@code choresThatDay} are their own chores on the chore's day, for the "Has
 * Laundry that day" hint. {@code swaps} are the chores each eligible member could trade, grouped by
 * person (empty when swapping isn't offered). {@code headsUpAt} is when the requester hears that
 * nobody has taken it, or null when the deadline is under two hours away.
 */
public record RequestCandidatesResponse(
    boolean canHandOff,
    boolean canSwap,
    boolean anyoneEligible,
    List<Member> members,
    List<SwapPerson> swaps,
    OffsetDateTime expiresAt,
    OffsetDateTime headsUpAt) {

  public record Member(
      UUID userId,
      String displayName,
      boolean eligible,
      LocalDate awayUntil,
      List<String> choresThatDay) {}

  public record SwapPerson(
      UUID userId, String displayName, List<ChoreRequestResponse.Occurrence> occurrences) {}
}
