package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequestCreate;
import com.dirtyduty.app.dto.chore.ChoreRequestListResponse;
import com.dirtyduty.app.dto.chore.ChoreRequestResponse;
import com.dirtyduty.app.dto.chore.RequestCandidatesResponse;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Hand-off and swap requests between members (E11).
 *
 * <p>A current assignee of a pending occurrence asks one member, or anyone who can take it, to take
 * it over (HANDOFF), or offers to trade it for one of a member's pending chores in the next 14 days
 * (SWAP). No admin approval is involved; admin Reassign is unchanged. An occurrence is in at most
 * one open request. Accepting replaces people on that occurrence only and marks it overridden, so
 * generation and away mode never move it back.
 *
 * <p>A request closes as EXPIRED at its deadline, or as soon as either occurrence changes in any
 * way the requester didn't ask for: done, skipped, moved, given to someone else, cancelled. Every
 * writer takes the household lock first (then schedules, then occurrences, then requests), so
 * accepting is race-safe: the first accept wins and later ones see it was taken.
 */
@Service
public class ChoreRequestService {
  private static final Logger log = LoggerFactory.getLogger(ChoreRequestService.class);

  public static final String REFERENCE_TYPE = "CHORE_REQUEST";
  static final String HANDOFF = "HANDOFF";
  static final String SWAP = "SWAP";
  static final int SWAP_WINDOW_DAYS = 14;
  static final Duration HEADS_UP = Duration.ofHours(2);
  static final Duration NO_DEADLINE_EXPIRY = Duration.ofHours(24);

  /** Notifications that are about an open request; they go when it closes. */
  static final List<String> LIVE_TYPES =
      List.of("REQUEST_HANDOFF_ASK", "REQUEST_SWAP_ASK", "REQUEST_UNCLAIMED");

  static final String ALREADY_OPEN = "This chore already has an open request.";
  static final String NOT_YOURS = "Only someone doing this chore can ask about it.";
  static final String NOT_PENDING = "This chore isn't waiting to be done.";
  static final String TOO_LATE = "This chore is already due, so it's too late to ask.";
  static final String NOBODY = "Nobody else can take it that day.";
  static final String NO_SWAP_AS_NEEDED = "A When needed chore can't be swapped. Pass your turn.";
  static final String CLOSED = "This request is no longer open.";
  static final String CHANGED = "This chore changed, so the request was closed.";
  static final String TAKEN_PREFIX = "Already taken by ";

  private static final DateTimeFormatter DAY =
      DateTimeFormatter.ofPattern("EEE, MMM d", Locale.ENGLISH);
  private static final DateTimeFormatter SHORT_DAY =
      DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH);
  private static final DateTimeFormatter TIME =
      DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH);

  private final JdbcTemplate jdbc;
  private final AwayPeriods awayPeriods;
  private final NotificationEventService notifications;
  private final TransactionTemplate separately;
  private Clock clock = Clock.systemUTC();

  public ChoreRequestService(
      JdbcTemplate jdbc,
      AwayPeriods awayPeriods,
      NotificationEventService notifications,
      PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.awayPeriods = awayPeriods;
    this.notifications = notifications;
    this.separately = new TransactionTemplate(transactionManager);
    this.separately.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** Tests pin the clock; {@code null} restores the system clock. */
  void useClock(Clock testClock) {
    this.clock = testClock == null ? Clock.systemUTC() : testClock;
  }

  // ---- Reading -------------------------------------------------------------------------------

  /** Open requests the viewer can answer, and the open requests they made. */
  @Transactional(readOnly = true)
  public ChoreRequestListResponse list(UUID householdId, Authentication authentication) {
    Actor actor = actor(householdId, authentication);
    List<ChoreRequestResponse> forMe = new ArrayList<>();
    List<ChoreRequestResponse> mine = new ArrayList<>();
    for (Request request : openRequests(householdId)) {
      if (request.requesterId().equals(actor.userId())) {
        mine.add(response(request));
      } else if (canAnswer(request, actor.userId())) {
        forMe.add(response(request));
      }
    }
    return new ChoreRequestListResponse(forMe, mine);
  }

  /** Who the viewer could ask about {@code occurrenceId}, and what they could swap it for. */
  @Transactional(readOnly = true)
  public RequestCandidatesResponse candidates(
      UUID householdId, UUID occurrenceId, Authentication authentication) {
    Actor actor = actor(householdId, authentication);
    Occurrence occurrence = occurrence(householdId, occurrenceId, false);
    requireAskable(occurrence, actor.userId());
    OffsetDateTime now = OffsetDateTime.now(clock);
    OffsetDateTime expiry = deadline(occurrence, now);
    boolean asNeeded = "AS_NEEDED".equals(occurrence.kind());
    List<UUID> pool = pool(occurrence, actor.userId());
    LocalDate day = askDay(occurrence);
    Map<UUID, String> names = names(householdId);
    List<RequestCandidatesResponse.Member> members = new ArrayList<>();
    List<UUID> eligible = new ArrayList<>();
    for (UUID userId : pool) {
      AwayPeriods.Period away = awayPeriods.covering(householdId, userId, day);
      if (away == null) {
        eligible.add(userId);
      }
      members.add(
          new RequestCandidatesResponse.Member(
              userId,
              names.getOrDefault(userId, "Someone"),
              away == null,
              away == null ? null : away.endsOn(),
              choresOn(householdId, userId, occurrence.scheduledFor())));
    }
    List<RequestCandidatesResponse.SwapPerson> swaps = new ArrayList<>();
    if (!asNeeded) {
      for (UUID userId : eligible) {
        List<ChoreRequestResponse.Occurrence> offers =
            swappable(occurrence, actor.userId(), userId).stream()
                .map(ChoreRequestService::summary)
                .toList();
        if (!offers.isEmpty()) {
          swaps.add(
              new RequestCandidatesResponse.SwapPerson(
                  userId, names.getOrDefault(userId, "Someone"), offers));
        }
      }
    }
    return new RequestCandidatesResponse(
        true, !asNeeded, !eligible.isEmpty(), members, swaps, expiry, headsUpAt(expiry, now));
  }

  /**
   * What an occurrence card says about requests for this viewer: whether they may ask or swap, the
   * open request it is in, and the note left by an accepted one.
   */
  public AssignmentResponse.Requests stateFor(
      UUID occurrenceId,
      UUID viewerId,
      String status,
      String kind,
      boolean viewerAssigned,
      String noteType,
      UUID noteUserId) {
    AssignmentResponse.Note note =
        noteType == null || noteUserId == null
            ? null
            : new AssignmentResponse.Note(noteType, person(noteUserId));
    boolean pending = "PENDING".equals(status);
    Request open =
        pending
            ? jdbc
                .query(
                    REQUEST_SELECT
                        + " WHERE r.status='OPEN' AND (r.occurrence_id=? OR r.swap_occurrence_id=?)",
                    this::mapRequest,
                    occurrenceId,
                    occurrenceId)
                .stream()
                .findFirst()
                .orElse(null)
            : null;
    AssignmentResponse.OpenRequest openView = null;
    if (open != null) {
      // The requester's own chore shows "Waiting for…"; the other chore in a swap shows nothing.
      boolean mine =
          open.requesterId().equals(viewerId) && open.occurrenceId().equals(occurrenceId);
      openView =
          new AssignmentResponse.OpenRequest(
              open.id(),
              open.type(),
              mine,
              open.targetId() == null ? null : person(open.targetId()),
              person(open.requesterId()));
    }
    boolean canAsk = pending && viewerAssigned && open == null;
    return new AssignmentResponse.Requests(
        canAsk, canAsk && !"AS_NEEDED".equals(kind), "AS_NEEDED".equals(kind), openView, note);
  }

  // ---- Creating ------------------------------------------------------------------------------

  @Transactional
  public ChoreRequestResponse create(
      UUID householdId, ChoreRequestCreate body, Authentication authentication) {
    lockHousehold(householdId);
    Actor actor = actor(householdId, authentication);
    if (body == null || body.occurrenceId() == null) {
      throw new InvalidHouseholdException("Choose the chore to ask about.");
    }
    String type = body.type() == null ? HANDOFF : body.type().toUpperCase(Locale.ROOT);
    if (!HANDOFF.equals(type) && !SWAP.equals(type)) {
      throw new InvalidHouseholdException("Choose a hand-off or a swap.");
    }
    Occurrence occurrence = occurrence(householdId, body.occurrenceId(), true);
    requireAskable(occurrence, actor.userId());
    OffsetDateTime now = OffsetDateTime.now(clock);
    OffsetDateTime expiry = deadline(occurrence, now);
    UUID target = body.targetUserId();
    Occurrence other = null;
    if (SWAP.equals(type)) {
      if ("AS_NEEDED".equals(occurrence.kind())) {
        throw new InvalidHouseholdException(NO_SWAP_AS_NEEDED);
      }
      if (target == null || body.swapOccurrenceId() == null) {
        throw new InvalidHouseholdException("Choose one of their chores to swap for.");
      }
      requireTarget(occurrence, actor.userId(), target);
      other = occurrence(householdId, body.swapOccurrenceId(), true);
      requireSwappable(occurrence, other, actor.userId(), target);
      expiry = earlier(expiry, deadline(other, now));
    } else if (body.swapOccurrenceId() != null) {
      throw new InvalidHouseholdException("A hand-off doesn't trade another chore.");
    } else if (target != null) {
      requireTarget(occurrence, actor.userId(), target);
    } else if (eligiblePeople(occurrence, actor.userId()).isEmpty()) {
      throw new InvalidHouseholdException(NOBODY);
    }
    if (!expiry.isAfter(now)) {
      throw new InvalidHouseholdException(TOO_LATE);
    }
    UUID id = UUID.randomUUID();
    Occurrence swapped = other;
    OffsetDateTime expiresAt = expiry;
    jdbc.update(
        """
            INSERT INTO chore_requests
                (id, household_id, type, requester_user_id, target_user_id, occurrence_id,
                 swap_occurrence_id, occurrence_day, occurrence_due_at, occurrence_people,
                 swap_day, swap_due_at, swap_people, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
        ps -> {
          ps.setObject(1, id);
          ps.setObject(2, householdId);
          ps.setString(3, type);
          ps.setObject(4, actor.userId());
          ps.setObject(5, target);
          ps.setObject(6, occurrence.id());
          ps.setObject(7, swapped == null ? null : swapped.id());
          ps.setObject(8, occurrence.scheduledFor());
          ps.setObject(9, occurrence.dueAt());
          ps.setArray(10, ps.getConnection().createArrayOf("uuid", occurrence.people().toArray()));
          ps.setObject(11, swapped == null ? null : swapped.scheduledFor());
          ps.setObject(12, swapped == null ? null : swapped.dueAt());
          ps.setArray(
              13,
              swapped == null
                  ? null
                  : ps.getConnection().createArrayOf("uuid", swapped.people().toArray()));
          ps.setObject(14, expiresAt);
          ps.setObject(15, now);
        });
    Request request = load(id);
    sendAsks(request, actor.userId());
    OffsetDateTime headsUp = headsUpAt(expiry, now);
    if (headsUp != null) {
      Map<String, String> variables = variables(request);
      variables.put("scheduled_at", headsUp.toString());
      variables.put("expires_at", expiry.toString());
      notifications.publish(
          new NotificationEvent(
              "REQUEST_UNCLAIMED",
              null,
              householdId,
              REFERENCE_TYPE,
              id,
              "CHORE_REMINDER",
              Map.copyOf(variables),
              List.of(actor.userId())));
    }
    return response(request);
  }

  // ---- Answering -----------------------------------------------------------------------------

  // A request found changed is closed before the 409, and that close must stick.
  @Transactional(noRollbackFor = DuplicateResourceException.class)
  public ChoreRequestResponse accept(
      UUID householdId, UUID requestId, Authentication authentication) {
    lockHousehold(householdId);
    Actor actor = actor(householdId, authentication);
    Request request = lockRequest(householdId, requestId);
    requireOpenFor(request, actor.userId());
    // Lock order: household (above), schedules, occurrences, then the request (already held under
    // the household lock, which every request writer takes first).
    Occurrence occurrence = occurrence(householdId, request.occurrenceId(), true);
    Occurrence other =
        request.swapOccurrenceId() == null
            ? null
            : occurrence(householdId, request.swapOccurrenceId(), true);
    if (changed(request, occurrence, other)) {
      close(request, "EXPIRED", null);
      throw new DuplicateResourceException(CHANGED);
    }
    if (request.targetId() == null) {
      if (!eligiblePeople(occurrence, request.requesterId()).contains(actor.userId())
          || declined(request.id()).contains(actor.userId())) {
        throw new HouseholdAccessDeniedException("You can't take this one.");
      }
    } else if (!request.targetId().equals(actor.userId())) {
      throw new HouseholdAccessDeniedException("This request is for someone else.");
    }
    if (SWAP.equals(request.type())) {
      exchange(occurrence, request.requesterId(), actor.userId(), "SWAPPED", actor.userId());
      exchange(other, actor.userId(), request.requesterId(), "SWAPPED", actor.userId());
    } else {
      exchange(occurrence, request.requesterId(), actor.userId(), "TAKEN_OVER", actor.userId());
    }
    close(request, "ACCEPTED", actor.userId());
    Map<String, String> variables = variables(request);
    variables.put("request_summary", acceptedSummary(request, actor.displayName()));
    publish("REQUEST_ACCEPTED", actor.userId(), request, variables, List.of(request.requesterId()));
    return response(load(request.id()));
  }

  /**
   * A targeted request closes as DECLINED. "Anyone" stays open for everyone else; it closes (and
   * the requester hears) only once every member who could take it has said no.
   */
  @Transactional
  public ChoreRequestResponse decline(
      UUID householdId, UUID requestId, Authentication authentication) {
    lockHousehold(householdId);
    Actor actor = actor(householdId, authentication);
    Request request = lockRequest(householdId, requestId);
    requireOpenFor(request, actor.userId());
    if (request.targetId() != null) {
      if (!request.targetId().equals(actor.userId())) {
        throw new HouseholdAccessDeniedException("This request is for someone else.");
      }
      close(request, "DECLINED", actor.userId());
      notifyDeclined(request, actor);
      return response(load(request.id()));
    }
    Occurrence occurrence = occurrence(householdId, request.occurrenceId(), false);
    List<UUID> eligible = eligiblePeople(occurrence, request.requesterId());
    if (!eligible.contains(actor.userId())) {
      throw new HouseholdAccessDeniedException("You can't take this one.");
    }
    jdbc.update(
        "INSERT INTO chore_request_declines (request_id, user_id) VALUES (?, ?)"
            + " ON CONFLICT DO NOTHING",
        request.id(),
        actor.userId());
    cancelLiveNotifications(request.id(), actor.userId());
    if (declined(request.id()).containsAll(eligible)) {
      close(request, "DECLINED", actor.userId());
      notifyDeclined(request, actor);
    }
    return response(load(request.id()));
  }

  @Transactional
  public ChoreRequestResponse cancel(
      UUID householdId, UUID requestId, Authentication authentication) {
    lockHousehold(householdId);
    Actor actor = actor(householdId, authentication);
    Request request = lockRequest(householdId, requestId);
    if (!request.requesterId().equals(actor.userId())) {
      throw new HouseholdAccessDeniedException("Only the person who asked can cancel it.");
    }
    if (!"OPEN".equals(request.status())) {
      throw new DuplicateResourceException(CLOSED);
    }
    close(request, "CANCELLED", actor.userId());
    return response(load(request.id()));
  }

  // ---- Closing -------------------------------------------------------------------------------

  /**
   * Closes this household's open requests whose occurrences changed since they were asked (done,
   * skipped, moved, given to someone else, cancelled, archived). The requester hears about it
   * unless they made the change themselves ({@code actorId}). The caller holds the household lock.
   */
  public void closeChanged(UUID householdId, UUID actorId) {
    for (Request request : openRequests(householdId)) {
      Occurrence occurrence = occurrence(householdId, request.occurrenceId(), false);
      Occurrence other =
          request.swapOccurrenceId() == null
              ? null
              : occurrence(householdId, request.swapOccurrenceId(), false);
      if (changed(request, occurrence, other)) {
        close(request, "EXPIRED", null);
        if (!request.requesterId().equals(actorId)) {
          publish(
              "REQUEST_EXPIRED", null, request, variables(request), List.of(request.requesterId()));
        }
      }
    }
  }

  /**
   * A member who leaves (or deletes their account) takes their requests with them: the ones they
   * made and the ones only they could answer. The caller holds the household lock.
   */
  public void closeForMember(UUID householdId, UUID userId) {
    for (Request request : openRequests(householdId)) {
      if (request.requesterId().equals(userId) || userId.equals(request.targetId())) {
        close(request, "CANCELLED", null);
      }
    }
    closeChanged(householdId, null);
  }

  /**
   * The notification scheduler's pass: requests past their deadline expire (no push; the requester
   * already had the "nobody took it" heads-up), and anything that changed without going through a
   * request-aware path closes. Each household runs in its own transaction, before the scheduler
   * takes any lock of its own.
   */
  public int maintain() {
    List<UUID> households =
        jdbc.queryForList(
            "SELECT DISTINCT household_id FROM chore_requests WHERE status='OPEN'"
                + " ORDER BY household_id",
            UUID.class);
    int closed = 0;
    for (UUID householdId : households) {
      try {
        Integer count = separately.execute(status -> maintainHousehold(householdId));
        closed += count == null ? 0 : count;
      } catch (RuntimeException exception) {
        log.warn("Request maintenance failed for household {}", householdId, exception);
      }
    }
    return closed;
  }

  private int maintainHousehold(UUID householdId) {
    if (jdbc.queryForList(
            "SELECT id FROM households WHERE id=? FOR UPDATE", UUID.class, householdId)
        .isEmpty()) {
      return 0;
    }
    OffsetDateTime now = OffsetDateTime.now(clock);
    int closed = 0;
    for (Request request : openRequests(householdId)) {
      if (!request.expiresAt().isAfter(now)) {
        close(request, "EXPIRED", null);
        closed++;
      }
    }
    int before = openRequests(householdId).size();
    closeChanged(householdId, null);
    return closed + before - openRequests(householdId).size();
  }

  // ---- Rules ---------------------------------------------------------------------------------

  private void requireAskable(Occurrence occurrence, UUID requesterId) {
    if (!"PENDING".equals(occurrence.status()) || occurrence.awayPaused() || !occurrence.live()) {
      throw new InvalidHouseholdException(NOT_PENDING);
    }
    if (!occurrence.people().contains(requesterId)) {
      throw new HouseholdAccessDeniedException(NOT_YOURS);
    }
    Boolean open =
        jdbc.queryForObject(
            """
                SELECT EXISTS(SELECT 1 FROM chore_requests WHERE status='OPEN'
                              AND (occurrence_id=? OR swap_occurrence_id=?))
                """,
            Boolean.class,
            occurrence.id(),
            occurrence.id());
    if (Boolean.TRUE.equals(open)) {
      throw new DuplicateResourceException(ALREADY_OPEN);
    }
  }

  /** Who may be listed for an occurrence: active members, not the requester or already on it. */
  private List<UUID> pool(Occurrence occurrence, UUID requesterId) {
    List<UUID> members =
        jdbc.queryForList(
            """
                SELECT m.user_id FROM household_memberships m JOIN users u ON u.id=m.user_id
                WHERE m.household_id=? AND m.status='ACTIVE'
                ORDER BY LOWER(u.display_name), m.user_id
                """,
            UUID.class,
            occurrence.householdId());
    List<UUID> rotation =
        "AS_NEEDED".equals(occurrence.kind()) ? participants(occurrence.scheduleId()) : null;
    return members.stream()
        .filter(userId -> !userId.equals(requesterId))
        .filter(userId -> !occurrence.people().contains(userId))
        // "Pass my turn" stays within the rotation, like a turn change.
        .filter(userId -> rotation == null || rotation.contains(userId))
        .toList();
  }

  /** The pool, less anyone away on the occurrence's day. */
  private List<UUID> eligiblePeople(Occurrence occurrence, UUID requesterId) {
    LocalDate day = askDay(occurrence);
    return pool(occurrence, requesterId).stream()
        .filter(userId -> awayPeriods.covering(occurrence.householdId(), userId, day) == null)
        .toList();
  }

  private void requireTarget(Occurrence occurrence, UUID requesterId, UUID target) {
    if (target.equals(requesterId)) {
      throw new InvalidHouseholdException("Choose someone else.");
    }
    if (occurrence.people().contains(target)) {
      throw new InvalidHouseholdException("They already do this chore.");
    }
    if (!pool(occurrence, requesterId).contains(target)) {
      throw new InvalidHouseholdException(
          "AS_NEEDED".equals(occurrence.kind())
              ? "Choose someone in this chore's rotation."
              : "Choose someone in this household.");
    }
    if (awayPeriods.covering(occurrence.householdId(), target, askDay(occurrence)) != null) {
      throw new InvalidHouseholdException("They're away that day, so they can't be asked.");
    }
  }

  private void requireSwappable(Occurrence mine, Occurrence theirs, UUID requesterId, UUID target) {
    boolean valid =
        swappable(mine, requesterId, target).stream()
            .anyMatch(offer -> offer.id().equals(theirs.id()));
    if (!valid) {
      throw new InvalidHouseholdException(
          "Choose one of their chores in the next " + SWAP_WINDOW_DAYS + " days.");
    }
  }

  /**
   * The target's pending chores the requester could take in exchange: in the next 14 days, not a
   * When needed turn, not one the requester already does, not in another open request, and not on a
   * day the requester is away.
   */
  private List<Occurrence> swappable(Occurrence mine, UUID requesterId, UUID target) {
    LocalDate today = LocalDate.now(clock.withZone(mine.zone()));
    List<UUID> ids =
        jdbc.queryForList(
            """
                SELECT a.id FROM chore_assignments a
                JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id AND aa.user_id=?
                JOIN chores c ON c.id=a.chore_id
                WHERE a.household_id=? AND a.status='PENDING' AND NOT a.away_paused
                  AND a.kind_snapshot<>'AS_NEEDED' AND a.id<>?
                  AND c.is_active AND c.archived_at IS NULL
                  AND a.scheduled_for BETWEEN ? AND ?
                  AND NOT EXISTS (SELECT 1 FROM chore_assignment_assignees me
                                  WHERE me.assignment_id=a.id AND me.user_id=?)
                  AND NOT EXISTS (SELECT 1 FROM chore_requests r WHERE r.status='OPEN'
                                  AND (r.occurrence_id=a.id OR r.swap_occurrence_id=a.id))
                ORDER BY a.scheduled_for, a.due_at NULLS LAST, LOWER(a.title_snapshot), a.id
                """,
            UUID.class,
            target,
            mine.householdId(),
            mine.id(),
            today,
            today.plusDays(SWAP_WINDOW_DAYS),
            requesterId);
    OffsetDateTime now = OffsetDateTime.now(clock);
    return ids.stream()
        .map(id -> occurrence(mine.householdId(), id, false))
        .filter(
            other ->
                awayPeriods.covering(mine.householdId(), requesterId, other.scheduledFor()) == null)
        .filter(other -> deadline(other, now).isAfter(now))
        .toList();
  }

  /**
   * Whether the viewer may answer this open request (target, or anyone eligible who hasn't said
   * no).
   */
  private boolean canAnswer(Request request, UUID userId) {
    if (request.targetId() != null) {
      return request.targetId().equals(userId);
    }
    if (declined(request.id()).contains(userId)) {
      return false;
    }
    Occurrence occurrence = occurrence(request.householdId(), request.occurrenceId(), false);
    return eligiblePeople(occurrence, request.requesterId()).contains(userId);
  }

  private void requireOpenFor(Request request, UUID userId) {
    if ("ACCEPTED".equals(request.status())) {
      String name =
          request.resolvedById() == null
              ? "someone else"
              : request.resolvedById().equals(userId)
                  ? "you"
                  : person(request.resolvedById()).displayName();
      throw new DuplicateResourceException(TAKEN_PREFIX + name + ".");
    }
    if (!"OPEN".equals(request.status())) {
      throw new DuplicateResourceException(CLOSED);
    }
    if (request.requesterId().equals(userId)) {
      throw new InvalidHouseholdException("You can't answer your own request.");
    }
  }

  /** Whether either occurrence differs from when it was asked about. */
  private static boolean changed(Request request, Occurrence occurrence, Occurrence other) {
    if (differs(
        occurrence,
        request.occurrenceDay(),
        request.occurrenceDueAt(),
        request.occurrencePeople())) {
      return true;
    }
    return request.swapOccurrenceId() != null
        && differs(other, request.swapDay(), request.swapDueAt(), request.swapPeople());
  }

  private static boolean differs(
      Occurrence occurrence, LocalDate day, OffsetDateTime dueAt, List<UUID> people) {
    if (occurrence == null
        || !"PENDING".equals(occurrence.status())
        || occurrence.awayPaused()
        || !occurrence.live()
        || !occurrence.people().equals(people)) {
      return true;
    }
    if ("AS_NEEDED".equals(occurrence.kind())) {
      // A "Needs doing" flag can pull a When needed deadline in; the turn is still the same.
      return false;
    }
    return !occurrence.scheduledFor().equals(day)
        || (occurrence.dueAt() == null
            ? dueAt != null
            : dueAt == null || !occurrence.dueAt().isEqual(dueAt));
  }

  /**
   * A request ends at the chore's deadline; a When needed turn with no deadline 24 hours after it
   * was asked; a chore with no due time at the end of its day (midnight).
   */
  private OffsetDateTime deadline(Occurrence occurrence, OffsetDateTime now) {
    if (occurrence.dueAt() != null) {
      return occurrence.dueAt();
    }
    if ("AS_NEEDED".equals(occurrence.kind())) {
      return now.plus(NO_DEADLINE_EXPIRY);
    }
    // The end of its day: midnight, so the heads-up reads "by 10 PM", not "by 9:59 PM".
    return occurrence.scheduledFor().plusDays(1).atStartOfDay(occurrence.zone()).toOffsetDateTime();
  }

  private static OffsetDateTime headsUpAt(OffsetDateTime expiry, OffsetDateTime now) {
    OffsetDateTime at = expiry.minus(HEADS_UP);
    return at.isAfter(now) ? at.withOffsetSameInstant(ZoneOffset.UTC) : null;
  }

  private static OffsetDateTime earlier(OffsetDateTime left, OffsetDateTime right) {
    return right.isBefore(left) ? right : left;
  }

  /** The day whose away status decides who can take it: today for a When needed turn. */
  private LocalDate askDay(Occurrence occurrence) {
    LocalDate today = LocalDate.now(clock.withZone(occurrence.zone()));
    if ("AS_NEEDED".equals(occurrence.kind()) || occurrence.scheduledFor().isBefore(today)) {
      return today;
    }
    return occurrence.scheduledFor();
  }

  // ---- Applying ------------------------------------------------------------------------------

  /**
   * Puts {@code to} in {@code from}'s place on this occurrence only, marked overridden so
   * generation and away mode leave it alone, and notes who it came from for the card.
   */
  private void exchange(Occurrence occurrence, UUID from, UUID to, String noteType, UUID actorId) {
    List<UUID> people = new ArrayList<>();
    for (UUID userId : currentPeopleInOrder(occurrence.id())) {
      people.add(userId.equals(from) ? to : userId);
    }
    jdbc.update(
        "DELETE FROM chore_assignment_assignees WHERE assignment_id=? AND user_id=?",
        occurrence.id(),
        from);
    jdbc.update(
        """
            INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
            VALUES (?, ?, ?) ON CONFLICT (assignment_id, user_id) DO NOTHING
            """,
        occurrence.householdId(),
        occurrence.id(),
        to);
    UUID withUser = "TAKEN_OVER".equals(noteType) ? from : (to.equals(actorId) ? from : actorId);
    jdbc.update(
        """
            UPDATE chore_assignments
            SET assigned_to_user_id=?, assignees_overridden=TRUE, away_from_user_id=NULL,
                metadata = metadata || jsonb_build_object(
                    'requestNote', jsonb_build_object('type', ?::text, 'userId', ?::text),
                    'lastAction', jsonb_build_object(
                        'type', ?::text, 'byUserId', ?::text, 'at', NOW())),
                updated_at=NOW()
            WHERE id=? AND status='PENDING'
            """,
        people.getFirst(),
        noteType,
        withUser.toString(),
        "TAKEN_OVER".equals(noteType) ? "HANDOFF" : "SWAP",
        actorId.toString(),
        occurrence.id());
    // The person who handed it on stops getting its reminders now; the scheduler plans the new
    // person's reminders on its next pass.
    for (String table :
        List.of("notifications", "notification_deliveries", "notification_push_delivery_targets")) {
      cancelRemindersIn(table, occurrence.id(), from);
    }
  }

  private void cancelRemindersIn(String table, UUID occurrenceId, UUID userId) {
    String reminders = "('CHORE_DUE_SOON','CHORE_DUE_NOW','CHORE_OVERDUE')";
    switch (table) {
      case "notifications" ->
          jdbc.update(
              "UPDATE notifications SET status='CANCELLED' WHERE reference_type='CHORE_ASSIGNMENT'"
                  + " AND reference_id=? AND recipient_user_id=? AND status='PENDING' AND type IN "
                  + reminders,
              occurrenceId,
              userId);
      case "notification_deliveries" ->
          jdbc.update(
              "UPDATE notification_deliveries d SET status='CANCELLED' FROM notifications n"
                  + " WHERE d.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'"
                  + " AND n.reference_id=? AND n.recipient_user_id=? AND n.type IN "
                  + reminders
                  + " AND d.status IN ('PENDING','FAILED')",
              occurrenceId,
              userId);
      default ->
          jdbc.update(
              "UPDATE notification_push_delivery_targets t SET status='CANCELLED',"
                  + " next_attempt_at=NULL, updated_at=NOW() FROM notifications n"
                  + " WHERE t.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'"
                  + " AND n.reference_id=? AND n.recipient_user_id=? AND n.type IN "
                  + reminders
                  + " AND t.status IN ('PENDING','FAILED')",
              occurrenceId,
              userId);
    }
  }

  private void close(Request request, String status, UUID resolvedBy) {
    jdbc.update(
        """
            UPDATE chore_requests SET status=?, resolved_at=?, resolved_by_user_id=?
            WHERE id=? AND status='OPEN'
            """,
        status,
        OffsetDateTime.now(clock),
        resolvedBy,
        request.id());
    cancelLiveNotifications(request.id(), null);
  }

  /**
   * Asks and the "nobody took it" heads-up about a request that closed (or that {@code userId}
   * declined) don't go: unsent pushes, including ones held for quiet hours, are cancelled.
   */
  private void cancelLiveNotifications(UUID requestId, UUID userId) {
    String types = "('REQUEST_HANDOFF_ASK','REQUEST_SWAP_ASK','REQUEST_UNCLAIMED')";
    String who = userId == null ? "" : " AND n.recipient_user_id=?";
    Object[] args = userId == null ? new Object[] {requestId} : new Object[] {requestId, userId};
    jdbc.update(
        "UPDATE notifications n SET status='CANCELLED' WHERE n.reference_type='CHORE_REQUEST'"
            + " AND n.reference_id=? AND n.status='PENDING' AND n.type IN "
            + types
            + who,
        args);
    jdbc.update(
        "UPDATE notification_deliveries d SET status='CANCELLED' FROM notifications n"
            + " WHERE d.notification_id=n.id AND n.reference_type='CHORE_REQUEST'"
            + " AND n.reference_id=? AND n.type IN "
            + types
            + " AND d.status IN ('PENDING','FAILED')"
            + who,
        args);
    jdbc.update(
        "UPDATE notification_push_delivery_targets t SET status='CANCELLED', next_attempt_at=NULL,"
            + " updated_at=NOW() FROM notifications n WHERE t.notification_id=n.id"
            + " AND n.reference_type='CHORE_REQUEST' AND n.reference_id=? AND n.type IN "
            + types
            + " AND t.status IN ('PENDING','FAILED')"
            + who,
        args);
  }

  // ---- Notifications -------------------------------------------------------------------------

  /** The ask: to the target, or for "anyone" to every member who could take it (one each). */
  private void sendAsks(Request request, UUID actorId) {
    Occurrence occurrence = occurrence(request.householdId(), request.occurrenceId(), false);
    List<UUID> recipients =
        request.targetId() != null
            ? List.of(request.targetId())
            : eligiblePeople(occurrence, request.requesterId());
    Map<String, String> variables = variables(request);
    variables.put(
        "expires_at", request.expiresAt().withOffsetSameInstant(ZoneOffset.UTC).toString());
    publish(
        SWAP.equals(request.type()) ? "REQUEST_SWAP_ASK" : "REQUEST_HANDOFF_ASK",
        actorId,
        request,
        variables,
        recipients);
  }

  private void notifyDeclined(Request request, Actor actor) {
    Map<String, String> variables = variables(request);
    Occurrence occurrence = occurrence(request.householdId(), request.occurrenceId(), false);
    variables.put(
        "request_summary", occurrence.title() + " (" + shortDay(occurrence) + ") is still yours.");
    publish("REQUEST_DECLINED", actor.userId(), request, variables, List.of(request.requesterId()));
  }

  private void publish(
      String type,
      UUID actorId,
      Request request,
      Map<String, String> variables,
      List<UUID> recipients) {
    if (recipients.isEmpty()) {
      return;
    }
    notifications.publish(
        new NotificationEvent(
            type,
            actorId,
            request.householdId(),
            REFERENCE_TYPE,
            request.id(),
            "CHORE_REMINDER",
            Map.copyOf(variables),
            recipients));
  }

  /** Template variables: the chore and when, and for a swap the other chore and when. */
  private Map<String, String> variables(Request request) {
    Occurrence occurrence = occurrence(request.householdId(), request.occurrenceId(), false);
    Map<String, String> variables = new HashMap<>();
    variables.put("chore_name", occurrence.title());
    variables.put("request_when", when(occurrence));
    if (request.swapOccurrenceId() != null) {
      Occurrence other = occurrence(request.householdId(), request.swapOccurrenceId(), false);
      variables.put("other_chore", other.title());
      variables.put("other_when", when(other));
    }
    ZoneId zone = occurrence.zone();
    OffsetDateTime expiry = request.expiresAt();
    LocalDate expiryDay = expiry.atZoneSameInstant(zone).toLocalDate();
    LocalDate today = LocalDate.now(clock.withZone(zone));
    String day =
        expiryDay.equals(today)
            ? "today"
            : expiryDay.equals(today.plusDays(1)) ? "tomorrow" : expiryDay.format(SHORT_DAY);
    variables.put("expires_when", "at " + expiry.atZoneSameInstant(zone).format(TIME) + " " + day);
    return variables;
  }

  private String acceptedSummary(Request request, String accepter) {
    Occurrence occurrence = occurrence(request.householdId(), request.occurrenceId(), false);
    if (request.swapOccurrenceId() == null) {
      return accepter + " is taking " + occurrence.title() + " (" + shortDay(occurrence) + ").";
    }
    Occurrence other = occurrence(request.householdId(), request.swapOccurrenceId(), false);
    return "You do "
        + other.title()
        + " ("
        + shortDay(other)
        + "), "
        + accepter
        + " does "
        + occurrence.title()
        + " ("
        + shortDay(occurrence)
        + ").";
  }

  private String when(Occurrence occurrence) {
    String day = occurrence.scheduledFor().format(DAY);
    if (occurrence.dueAt() == null) {
      return day;
    }
    return day + " by " + occurrence.dueAt().atZoneSameInstant(occurrence.zone()).format(TIME);
  }

  private static String shortDay(Occurrence occurrence) {
    return occurrence.scheduledFor().format(SHORT_DAY);
  }

  // ---- Data ----------------------------------------------------------------------------------

  private record Actor(UUID userId, String displayName) {}

  record Occurrence(
      UUID id,
      UUID householdId,
      UUID scheduleId,
      UUID choreId,
      String status,
      String kind,
      LocalDate scheduledFor,
      OffsetDateTime dueAt,
      String title,
      String categoryIcon,
      boolean awayPaused,
      boolean live,
      List<UUID> people,
      ZoneId zone) {}

  record Request(
      UUID id,
      UUID householdId,
      String type,
      String status,
      UUID requesterId,
      UUID targetId,
      UUID occurrenceId,
      UUID swapOccurrenceId,
      LocalDate occurrenceDay,
      OffsetDateTime occurrenceDueAt,
      List<UUID> occurrencePeople,
      LocalDate swapDay,
      OffsetDateTime swapDueAt,
      List<UUID> swapPeople,
      OffsetDateTime expiresAt,
      OffsetDateTime createdAt,
      OffsetDateTime resolvedAt,
      UUID resolvedById) {}

  private static final String REQUEST_SELECT =
      """
      SELECT r.id, r.household_id, r.type, r.status, r.requester_user_id, r.target_user_id,
             r.occurrence_id, r.swap_occurrence_id, r.occurrence_day, r.occurrence_due_at,
             r.occurrence_people, r.swap_day, r.swap_due_at, r.swap_people, r.expires_at,
             r.created_at, r.resolved_at, r.resolved_by_user_id
      FROM chore_requests r
      """;

  private Request mapRequest(ResultSet rs, int row) throws SQLException {
    return new Request(
        rs.getObject("id", UUID.class),
        rs.getObject("household_id", UUID.class),
        rs.getString("type"),
        rs.getString("status"),
        rs.getObject("requester_user_id", UUID.class),
        rs.getObject("target_user_id", UUID.class),
        rs.getObject("occurrence_id", UUID.class),
        rs.getObject("swap_occurrence_id", UUID.class),
        rs.getObject("occurrence_day", LocalDate.class),
        rs.getObject("occurrence_due_at", OffsetDateTime.class),
        uuids(rs.getArray("occurrence_people")),
        rs.getObject("swap_day", LocalDate.class),
        rs.getObject("swap_due_at", OffsetDateTime.class),
        uuids(rs.getArray("swap_people")),
        rs.getObject("expires_at", OffsetDateTime.class),
        rs.getObject("created_at", OffsetDateTime.class),
        rs.getObject("resolved_at", OffsetDateTime.class),
        rs.getObject("resolved_by_user_id", UUID.class));
  }

  private List<Request> openRequests(UUID householdId) {
    return jdbc.query(
        REQUEST_SELECT + " WHERE r.household_id=? AND r.status='OPEN' ORDER BY r.created_at, r.id",
        this::mapRequest,
        householdId);
  }

  private Request load(UUID id) {
    return jdbc.queryForObject(REQUEST_SELECT + " WHERE r.id=?", this::mapRequest, id);
  }

  private Request lockRequest(UUID householdId, UUID requestId) {
    List<Request> rows =
        jdbc.query(
            REQUEST_SELECT + " WHERE r.id=? AND r.household_id=? FOR UPDATE",
            this::mapRequest,
            requestId,
            householdId);
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException("Request was not found in this household.");
    }
    return rows.getFirst();
  }

  private List<UUID> declined(UUID requestId) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_request_declines WHERE request_id=?", UUID.class, requestId);
  }

  /**
   * One occurrence with its people (sorted by id). With {@code lock}, its schedule row and then the
   * occurrence row are locked, the order every occurrence action uses.
   */
  Occurrence occurrence(UUID householdId, UUID occurrenceId, boolean lock) {
    if (lock) {
      jdbc.query(
          "SELECT s.id FROM chore_schedules s JOIN chore_assignments a ON a.schedule_id=s.id"
              + " WHERE a.id=? AND a.household_id=? FOR UPDATE OF s",
          rs -> {},
          occurrenceId,
          householdId);
    }
    List<Occurrence> rows =
        jdbc.query(
            """
                SELECT a.id, a.household_id, a.schedule_id, a.chore_id, a.status, a.kind_snapshot,
                       a.scheduled_for, a.due_at, a.title_snapshot, cc.icon_key, a.away_paused,
                       (c.is_active AND c.archived_at IS NULL) live, h.timezone,
                       ARRAY(SELECT aa.user_id FROM chore_assignment_assignees aa
                             WHERE aa.assignment_id=a.id ORDER BY aa.user_id) people
                FROM chore_assignments a
                JOIN households h ON h.id=a.household_id
                LEFT JOIN chores c ON c.id=a.chore_id
                LEFT JOIN chore_categories cc ON cc.id=c.category_id
                WHERE a.id=? AND a.household_id=?
                """
                + (lock ? " FOR UPDATE OF a" : ""),
            (rs, row) ->
                new Occurrence(
                    rs.getObject("id", UUID.class),
                    rs.getObject("household_id", UUID.class),
                    rs.getObject("schedule_id", UUID.class),
                    rs.getObject("chore_id", UUID.class),
                    rs.getString("status"),
                    rs.getString("kind_snapshot"),
                    rs.getObject("scheduled_for", LocalDate.class),
                    rs.getObject("due_at", OffsetDateTime.class),
                    rs.getString("title_snapshot"),
                    rs.getString("icon_key"),
                    rs.getBoolean("away_paused"),
                    rs.getBoolean("live"),
                    uuids(rs.getArray("people")),
                    ZoneId.of(rs.getString("timezone"))),
            occurrenceId,
            householdId);
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException("Assignment was not found in this household.");
    }
    return rows.getFirst();
  }

  private List<UUID> currentPeopleInOrder(UUID occurrenceId) {
    return jdbc.queryForList(
        "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=?"
            + " ORDER BY created_at, user_id",
        UUID.class,
        occurrenceId);
  }

  private List<UUID> participants(UUID scheduleId) {
    if (scheduleId == null) {
      return List.of();
    }
    return jdbc.queryForList(
        """
            SELECT value::uuid FROM chore_schedules s,
                   jsonb_array_elements_text(COALESCE(s.strategy_config->'participantUserIds', '[]'))
            WHERE s.id=?
            """,
        UUID.class,
        scheduleId);
  }

  private List<String> choresOn(UUID householdId, UUID userId, LocalDate day) {
    return jdbc.queryForList(
        """
            SELECT a.title_snapshot FROM chore_assignments a
            JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id AND aa.user_id=?
            WHERE a.household_id=? AND a.status='PENDING' AND a.scheduled_for=?
            ORDER BY a.due_at NULLS LAST, LOWER(a.title_snapshot)
            """,
        String.class,
        userId,
        householdId,
        day);
  }

  private Map<UUID, String> names(UUID householdId) {
    Map<UUID, String> names = new LinkedHashMap<>();
    jdbc.query(
        """
            SELECT u.id, u.display_name FROM users u
            JOIN household_memberships m ON m.user_id=u.id AND m.household_id=?
            """,
        rs -> {
          names.put(rs.getObject("id", UUID.class), rs.getString("display_name"));
        },
        householdId);
    return names;
  }

  private AssignmentResponse.Person person(UUID userId) {
    if (userId == null) {
      return null;
    }
    String name =
        jdbc.query(
            "SELECT display_name FROM users WHERE id=?",
            rs -> rs.next() ? rs.getString(1) : "Someone",
            userId);
    return new AssignmentResponse.Person(userId, name);
  }

  private ChoreRequestResponse response(Request request) {
    Occurrence occurrence = occurrence(request.householdId(), request.occurrenceId(), false);
    Occurrence other =
        request.swapOccurrenceId() == null
            ? null
            : occurrence(request.householdId(), request.swapOccurrenceId(), false);
    return new ChoreRequestResponse(
        request.id(),
        request.type(),
        request.status(),
        person(request.requesterId()),
        person(request.targetId()),
        summary(occurrence),
        other == null ? null : summary(other),
        request.expiresAt(),
        request.createdAt(),
        request.resolvedAt(),
        person(request.resolvedById()));
  }

  private static ChoreRequestResponse.Occurrence summary(Occurrence occurrence) {
    return new ChoreRequestResponse.Occurrence(
        occurrence.id(),
        occurrence.choreId(),
        occurrence.title(),
        occurrence.categoryIcon(),
        occurrence.kind(),
        occurrence.scheduledFor(),
        occurrence.dueAt());
  }

  private Actor actor(UUID householdId, Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new HouseholdAccessDeniedException("You are not an active member of this household.");
    }
    List<Actor> actors =
        jdbc.query(
            """
                SELECT u.id, u.display_name FROM users u
                JOIN household_memberships m ON m.user_id=u.id AND m.household_id=?
                WHERE LOWER(u.email)=LOWER(?) AND u.account_status='ACTIVE' AND m.status='ACTIVE'
                """,
            (rs, row) -> new Actor(rs.getObject("id", UUID.class), rs.getString("display_name")),
            householdId,
            authentication.getName());
    if (actors.isEmpty()) {
      throw new HouseholdAccessDeniedException("You are not an active member of this household.");
    }
    return actors.getFirst();
  }

  private void lockHousehold(UUID householdId) {
    if (jdbc.queryForList(
            "SELECT id FROM households WHERE id=? FOR UPDATE", UUID.class, householdId)
        .isEmpty()) {
      throw new HouseholdAccessDeniedException("You are not an active member of this household.");
    }
  }

  private static List<UUID> uuids(Array array) throws SQLException {
    if (array == null) {
      return null;
    }
    List<UUID> ids = new ArrayList<>();
    for (Object value : (Object[]) array.getArray()) {
      ids.add(value instanceof UUID id ? id : UUID.fromString(String.valueOf(value)));
    }
    ids.sort(Comparator.naturalOrder());
    return List.copyOf(ids);
  }
}
