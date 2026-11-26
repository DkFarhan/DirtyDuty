package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreResponse;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ScheduleKind;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.notification.WebPushClient;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Checklists (E12): a chore's optional steps, ticked per occurrence and shared by its people. */
@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
class ChecklistIntegrationTest {
  private static final Instant PINNED = Instant.parse("2030-03-14T14:14:00Z");

  @Autowired private JdbcTemplate jdbc;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @MockitoBean private WebPushClient webPushClient;

  private final List<UUID> householdIds = new ArrayList<>();
  private final List<UUID> userIds = new ArrayList<>();
  private UUID householdId;
  private UUID owner;
  private UUID ana;
  private UUID ben;
  private LocalDate today;

  @BeforeEach
  void setUp() {
    occurrenceService.useClock(Clock.fixed(PINNED, ZoneOffset.UTC));
    today = LocalDate.now(ZoneOffset.UTC);
    owner = createUser("owner");
    ana = createUser("ana");
    ben = createUser("ben");
    householdId = UUID.randomUUID();
    householdIds.add(householdId);
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id)"
            + " VALUES (?, 'Checklists', 'UTC', ?)",
        householdId,
        owner);
    addMember(owner, "OWNER");
    addMember(ana, "MEMBER");
    addMember(ben, "MEMBER");
  }

  @AfterEach
  void cleanFixtures() {
    occurrenceService.useClock(null);
    for (UUID id : householdIds) {
      jdbc.update(
          "DELETE FROM notifications WHERE event_id IN"
              + " (SELECT id FROM notification_events WHERE household_id=?)"
              + " OR (reference_type='CHORE_ASSIGNMENT' AND reference_id IN"
              + " (SELECT id FROM chore_assignments WHERE household_id=?))",
          id,
          id);
      jdbc.update("DELETE FROM notification_events WHERE household_id=?", id);
      jdbc.update("DELETE FROM activity_events WHERE household_id=?", id);
      jdbc.update("DELETE FROM chore_completions WHERE household_id=?", id);
      jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", id);
      jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", id);
      jdbc.update(
          "DELETE FROM recurring_chore_assignment_announcements WHERE schedule_id IN "
              + "(SELECT id FROM chore_schedules WHERE household_id=?)",
          id);
      jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", id);
      jdbc.update("DELETE FROM chores WHERE household_id=?", id);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", id);
      jdbc.update("DELETE FROM households WHERE id=?", id);
    }
    for (UUID id : userIds) {
      jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", id);
      jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", id);
      jdbc.update("DELETE FROM users WHERE id=?", id);
    }
  }

  @Test
  void stepsAreSavedInOrderEditedAndValidated() {
    ChoreResponse created = createGroupChore(List.of("Wipe the sink", "Scrub the toilet", "Mop"));
    assertThat(created.steps())
        .extracting(ChoreResponse.Step::text)
        .containsExactly("Wipe the sink", "Scrub the toilet", "Mop");

    // Reorder, rename one, drop one, add one.
    List<ChoreResponse.Step> steps = created.steps();
    ChoreResponse edited =
        update(
            created.id(),
            List.of(
                new ChoreRequest.StepInput(steps.get(2).id(), "Mop the floor"),
                new ChoreRequest.StepInput(steps.get(0).id(), "  Wipe the sink  "),
                new ChoreRequest.StepInput(null, "Empty the bin")));
    assertThat(edited.steps())
        .extracting(ChoreResponse.Step::text)
        .containsExactly("Mop the floor", "Wipe the sink", "Empty the bin");
    assertThat(edited.steps().get(0).id()).isEqualTo(steps.get(2).id());

    // A request without steps (older clients) leaves them as they are.
    ChoreResponse untouched = update(created.id(), null);
    assertThat(untouched.steps()).hasSize(3);
    assertThat(update(created.id(), List.of()).steps()).isEmpty();

    List<ChoreRequest.StepInput> sixteen =
        IntStream.range(0, 16)
            .mapToObj(i -> new ChoreRequest.StepInput(null, "Step " + i))
            .toList();
    assertThatThrownBy(() -> update(created.id(), sixteen))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("A chore can have at most 15 steps.");
    assertThatThrownBy(() -> update(created.id(), List.of(new ChoreRequest.StepInput(null, " "))))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Enter a step, or remove it.");
    assertThatThrownBy(
            () -> update(created.id(), List.of(new ChoreRequest.StepInput(null, "x".repeat(81)))))
        .isInstanceOf(InvalidHouseholdException.class)
        .hasMessage("Keep each step to 80 characters.");
    assertThat(update(created.id(), sixteen.subList(0, 15)).steps()).hasSize(15);
    assertThat(
            update(created.id(), List.of(new ChoreRequest.StepInput(null, "x".repeat(80)))).steps())
        .hasSize(1);
  }

  @Test
  void groupChoresShareTicksWithWhoAndTheNextOccurrenceStartsEmpty() {
    ChoreResponse chore = createGroupChore(List.of("Counters", "Sink", "Floor"));
    List<UUID> occurrences = occurrences(chore.id());
    assertThat(occurrences.size()).isGreaterThan(1);
    UUID first = occurrences.get(0);
    UUID step = chore.steps().get(1).id();

    AssignmentResponse afterTick = tick(first, step, ana, true);
    assertThat(afterTick.steps().ticked()).isEqualTo(1);
    // Ben, doing it with Ana, sees her tick and when.
    AssignmentResponse benView = view(first, ben);
    assertThat(benView.steps().total()).isEqualTo(3);
    assertThat(benView.steps().canTick()).isTrue();
    AssignmentResponse.StepItem sink = benView.steps().items().get(1);
    assertThat(sink.ticked()).isTrue();
    assertThat(sink.tickedBy().displayName()).isEqualTo("Checklist ana");
    assertThat(sink.tickedAt().toInstant()).isEqualTo(PINNED);
    // Ticking again keeps the first tick; unticking clears it for everyone.
    tick(first, step, ben, true);
    assertThat(view(first, ana).steps().items().get(1).tickedBy().userId()).isEqualTo(ana);
    assertThat(tick(first, step, ben, false).steps().ticked()).isZero();
    tick(first, step, ben, true);

    // The next occurrence starts with nothing ticked.
    AssignmentResponse next = view(occurrences.get(1), ana);
    assertThat(next.steps().ticked()).isZero();
    assertThat(next.steps().items()).noneMatch(AssignmentResponse.StepItem::ticked);
  }

  @Test
  void editingKeepsTicksOfRenamedStepsAndDropsThoseOfRemovedOnes() {
    ChoreResponse chore = createGroupChore(List.of("Counters", "Sink", "Floor"));
    UUID first = occurrences(chore.id()).get(0);
    List<ChoreResponse.Step> steps = chore.steps();
    tick(first, steps.get(0).id(), ana, true);
    tick(first, steps.get(1).id(), ana, true);

    update(
        chore.id(),
        List.of(
            new ChoreRequest.StepInput(steps.get(0).id(), "Wipe the counters"),
            new ChoreRequest.StepInput(steps.get(2).id(), "Floor"),
            new ChoreRequest.StepInput(null, "Bins")));

    AssignmentResponse.Steps after = view(first, ana).steps();
    assertThat(after.items())
        .extracting(AssignmentResponse.StepItem::text, AssignmentResponse.StepItem::ticked)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("Wipe the counters", true),
            org.assertj.core.groups.Tuple.tuple("Floor", false),
            org.assertj.core.groups.Tuple.tuple("Bins", false));
    assertThat(after.ticked()).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM chore_step_ticks WHERE step_id=?",
                Integer.class,
                steps.get(1).id()))
        .isZero();
  }

  @Test
  void onlyAssigneesTickAndAnyoneInTheRotationForWhenNeeded() {
    ChoreResponse chore = createGroupChore(List.of("Counters"));
    UUID first = occurrences(chore.id()).get(0);
    UUID step = chore.steps().get(0).id();
    // The owner manages the chore but isn't doing this one.
    assertThat(view(first, owner).steps().canTick()).isFalse();
    assertThatThrownBy(() -> tick(first, step, owner, true))
        .isInstanceOf(HouseholdAccessDeniedException.class)
        .hasMessage("Only the people doing this chore can tick its steps.");

    ChoreResponse job =
        choreService.createChore(
            householdId,
            request(
                "Take out garbage",
                new ChoreScheduleRequest(
                    null,
                    null,
                    null,
                    null,
                    LocalTime.of(20, 0),
                    AssignmentStrategy.ROUND_ROBIN,
                    null,
                    List.of(ana, ben),
                    1,
                    ScheduleKind.AS_NEEDED,
                    null,
                    null,
                    true,
                    2),
                List.of("Tie the bag", "Fresh bag")),
            auth(owner));
    UUID open = occurrences(job.id()).get(0);
    UUID tieTheBag = job.steps().get(0).id();
    // Whose turn it is doesn't matter: anyone in the rotation may tick, like completing.
    assertThat(tick(open, tieTheBag, ben, true).steps().ticked()).isEqualTo(1);
    assertThat(tick(open, tieTheBag, ana, false).steps().ticked()).isZero();
    assertThatThrownBy(() -> tick(open, tieTheBag, owner, true))
        .isInstanceOf(HouseholdAccessDeniedException.class);
    // A step of another chore isn't this one's.
    assertThatThrownBy(() -> tick(open, step, ana, true))
        .isInstanceOf(ResourceNotFoundException.class)
        .hasMessage("This step is no longer on the chore.");
  }

  @Test
  void completionKeepsASnapshotAndDoneOccurrencesCantBeTicked() {
    ChoreResponse chore = createGroupChore(List.of("Counters", "Sink", "Floor", "Bins", "Towels"));
    UUID first = occurrences(chore.id()).get(0);
    for (int i = 0; i < 4; i++) {
      tick(first, chore.steps().get(i).id(), ana, true);
    }
    occurrenceService.complete(householdId, first, auth(ben));

    AssignmentResponse.Steps done = view(first, ana).steps();
    assertThat(done.total()).isEqualTo(5);
    assertThat(done.ticked()).isEqualTo(4);
    assertThat(done.items()).isNull();
    assertThat(done.canTick()).isFalse();
    // Later edits don't rewrite history.
    update(chore.id(), List.of(new ChoreRequest.StepInput(null, "Only one now")));
    assertThat(view(first, ana).steps().total()).isEqualTo(5);
    assertThatThrownBy(() -> tick(first, chore.steps().get(4).id(), ana, true))
        .isInstanceOf(ResourceNotFoundException.class);

    // Effort points are unchanged by steps: the chore's difficulty, as always.
    assertThat(
            jdbc.queryForObject(
                "SELECT effort_points FROM chore_completions WHERE assignment_id=?",
                Integer.class,
                first))
        .isEqualTo(2);
    // A chore without steps has no checklist and no snapshot.
    ChoreResponse plain = createGroupChore(List.of());
    UUID plainFirst = occurrences(plain.id()).get(0);
    assertThat(view(plainFirst, ana).steps()).isNull();
    occurrenceService.complete(householdId, plainFirst, auth(ana));
    assertThat(view(plainFirst, ana).steps()).isNull();
  }

  @Test
  void outsidersGetNotFoundAndFormerMembersKeepTheirTicks() {
    ChoreResponse chore = createGroupChore(List.of("Counters", "Sink"));
    UUID first = occurrences(chore.id()).get(0);
    UUID step = chore.steps().get(0).id();
    UUID outsider = createUser("outsider");
    assertThatThrownBy(() -> tick(first, step, outsider, true))
        .isInstanceOf(ResourceNotFoundException.class)
        .hasMessage("Assignment was not found in this household.");

    tick(first, step, ana, true);
    jdbc.update(
        "UPDATE household_memberships SET status='LEFT' WHERE household_id=? AND user_id=?",
        householdId,
        ana);
    AssignmentResponse.StepItem kept = view(first, ben).steps().items().get(0);
    assertThat(kept.ticked()).isTrue();
    assertThat(kept.tickedBy().displayName()).isEqualTo("Former member");
    assertThat(kept.tickedBy().userId()).isNull();
  }

  // ---- Fixtures ----

  /** Every day at 8 PM; Ana and Ben do it together. */
  private ChoreResponse createGroupChore(List<String> steps) {
    return choreService.createChore(
        householdId,
        request(
            "Clean bathroom",
            new ChoreScheduleRequest(
                "FREQ=DAILY",
                "UTC",
                today,
                null,
                LocalTime.of(20, 0),
                AssignmentStrategy.ROUND_ROBIN,
                null,
                List.of(ana, ben),
                2,
                ScheduleKind.CALENDAR,
                null,
                null,
                null,
                null),
            steps),
        auth(owner));
  }

  private ChoreResponse update(UUID choreId, List<ChoreRequest.StepInput> steps) {
    ChoreResponse current = choreService.getChore(householdId, choreId, auth(owner));
    return choreService.updateChore(
        householdId,
        choreId,
        new ChoreRequest(current.title(), null, null, null, 2, null, false, null, steps),
        auth(owner));
  }

  private static ChoreRequest request(
      String title, ChoreScheduleRequest schedule, List<String> steps) {
    return new ChoreRequest(
        title,
        null,
        null,
        null,
        2,
        null,
        false,
        schedule,
        steps.stream().map(text -> new ChoreRequest.StepInput(null, text)).toList());
  }

  private AssignmentResponse tick(UUID occurrence, UUID step, UUID user, boolean ticked) {
    return occurrenceService.tickStep(householdId, occurrence, step, ticked, auth(user));
  }

  private AssignmentResponse view(UUID occurrence, UUID viewer) {
    return occurrenceService.occurrence(householdId, occurrence, auth(viewer));
  }

  private List<UUID> occurrences(UUID choreId) {
    return jdbc.queryForList(
        "SELECT id FROM chore_assignments WHERE chore_id=? ORDER BY scheduled_for, id",
        UUID.class,
        choreId);
  }

  private UUID createUser(String label) {
    UUID id = UUID.randomUUID();
    userIds.add(id);
    jdbc.update(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'h', ?)",
        id,
        "checklist-" + label + "-" + id + "@example.test",
        "Checklist " + label);
    return id;
  }

  private void addMember(UUID userId, String role) {
    jdbc.update(
        """
            INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
            VALUES (?, ?, ?, 'ACTIVE', NOW())
            """,
        householdId,
        userId,
        role);
  }

  private Authentication auth(UUID userId) {
    String email = jdbc.queryForObject("SELECT email FROM users WHERE id=?", String.class, userId);
    return new UsernamePasswordAuthenticationToken(email, null);
  }
}
