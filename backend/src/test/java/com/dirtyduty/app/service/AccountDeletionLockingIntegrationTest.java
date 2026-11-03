package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.exception.AccountDeletionConflictException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.UserRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class AccountDeletionLockingIntegrationTest {

  private static final String PASSWORD = "StrongPassword123!";

  @Autowired private AuthService authService;
  @Autowired private HouseholdService householdService;
  @Autowired private ChoreService choreService;
  @Autowired private OccurrenceService occurrenceService;
  @Autowired private UserRepository userRepository;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private PlatformTransactionManager transactionManager;

  private final List<UUID> userIds = new ArrayList<>();
  private final List<UUID> householdIds = new ArrayList<>();

  @AfterEach
  void cleanFixtures() {
    for (UUID householdId : householdIds) {
      jdbc.update(
          "DELETE FROM notifications WHERE event_id IN "
              + "(SELECT id FROM notification_events WHERE household_id=?)",
          householdId);
      jdbc.update("DELETE FROM notification_events WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM activity_events WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM chore_categories WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM household_invitations WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
      jdbc.update("DELETE FROM households WHERE id=?", householdId);
    }
    for (UUID userId : userIds) {
      userRepository.findById(userId).ifPresent(user -> deleteUser(userId, user.getEmail()));
    }
    userIds.clear();
    householdIds.clear();
  }

  @Test
  void accountDeletionAndMemberRemovalCompleteInEitherLockOrder() throws Exception {
    User owner = createUser("remove-owner");
    User member = createUser("remove-member");
    UUID householdId = createHousehold(owner);
    addMembership(householdId, member, "MEMBER");

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch householdHeld = new CountDownLatch(1);
    CountDownLatch releaseRemoval = new CountDownLatch(1);
    AtomicInteger removalPid = new AtomicInteger();
    try {
      Future<?> removal =
          executor.submit(
              () ->
                  inTransaction(
                      () -> {
                        removalPid.set(lockHousehold(householdId));
                        householdHeld.countDown();
                        await(releaseRemoval, "member-removal release");
                        householdService.removeMember(
                            householdId, member.getId(), authentication(owner));
                      }));
      assertThat(householdHeld.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> deletion = executor.submit(() -> deleteAccount(member));
      assertThat(awaitBlockedBy(removalPid.get())).isTrue();

      releaseRemoval.countDown();
      removal.get(10, TimeUnit.SECONDS);
      deletion.get(10, TimeUnit.SECONDS);
    } finally {
      releaseRemoval.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }
    assertThat(membershipStatus(householdId, member.getId())).isIn("LEFT", "REMOVED");
    assertThat(accountStatus(member.getId())).isEqualTo("DELETED");
  }

  @Test
  void accountDeletionAcquiresHouseholdBeforeConcurrentRemovalOrOwnershipTransfer()
      throws Exception {
    User owner = createUser("account-first-owner");
    User target = createUser("account-first-target");
    UUID householdId = createHousehold(owner);
    addMembership(householdId, target, "MEMBER");
    UUID existingChore = createChore(owner, "Account-first recurring chore");
    UUID existingSchedule = createSchedule(existingChore, target.getId());

    ExecutorService executor = Executors.newFixedThreadPool(5);
    AtomicInteger deletionPid = new AtomicInteger();
    CountDownLatch deletionApplied = new CountDownLatch(1);
    CountDownLatch releaseDeletion = new CountDownLatch(1);
    try {
      Future<?> deletion =
          executor.submit(
              () ->
                  inTransaction(
                      () -> {
                        deletionPid.set(lockHousehold(householdId));
                        deleteAccount(target);
                        deletionApplied.countDown();
                        await(releaseDeletion, "account deletion release");
                      }));
      assertThat(deletionApplied.await(10, TimeUnit.SECONDS)).isTrue();

      Future<Boolean> transfer =
          executor.submit(
              () -> {
                try {
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status ->
                              householdService.transferOwnership(
                                  householdId, target.getId(), authentication(owner)));
                  return true;
                } catch (ResourceNotFoundException expected) {
                  return false;
                }
              });
      Future<Boolean> removal =
          executor.submit(
              () -> {
                try {
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status ->
                              householdService.removeMember(
                                  householdId, target.getId(), authentication(owner)));
                  return true;
                } catch (ResourceNotFoundException expected) {
                  return false;
                }
              });
      Future<Boolean> scheduleCreation =
          executor.submit(
              () -> {
                try {
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status ->
                              choreService.createChore(
                                  householdId,
                                  choreRequest(
                                      "Rejected departed participant",
                                      scheduleRequest(owner.getId(), target.getId())),
                                  authentication(owner)));
                  return true;
                } catch (InvalidHouseholdException expected) {
                  return false;
                }
              });
      Future<Boolean> generation =
          executor.submit(
              () -> {
                new TransactionTemplate(transactionManager)
                    .executeWithoutResult(
                        status -> occurrenceService.generateHousehold(householdId));
                return true;
              });
      boolean allOperationsBlocked = awaitBlockedBy(deletionPid.get(), 4);
      assertThat(allOperationsBlocked)
          .withFailMessage(
              "Expected four operations blocked by account deletion but observed %s.",
              blockedSessionCount(deletionPid.get()))
          .isTrue();

      releaseDeletion.countDown();
      deletion.get(10, TimeUnit.SECONDS);
      assertThat(transfer.get(10, TimeUnit.SECONDS)).isFalse();
      assertThat(removal.get(10, TimeUnit.SECONDS)).isFalse();
      assertThat(scheduleCreation.get(10, TimeUnit.SECONDS)).isFalse();
      assertThat(generation.get(10, TimeUnit.SECONDS)).isTrue();
    } finally {
      releaseDeletion.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(membershipStatus(householdId, target.getId())).isEqualTo("LEFT");
    assertThat(membershipRole(householdId, owner.getId())).isEqualTo("OWNER");
    assertThat(accountStatus(target.getId())).isEqualTo("DELETED");
    assertThat(scheduleActive(existingSchedule)).isFalse();
    assertNoAssignmentForMember(householdId, target.getId());
  }

  @Test
  void accountDeletionAndOwnershipTransferSerializeWithoutDeadlock() throws Exception {
    User owner = createUser("transfer-owner");
    User target = createUser("transfer-target");
    UUID householdId = createHousehold(owner);
    addMembership(householdId, target, "MEMBER");

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch transferApplied = new CountDownLatch(1);
    CountDownLatch releaseTransfer = new CountDownLatch(1);
    AtomicInteger transferPid = new AtomicInteger();
    try {
      Future<?> transfer =
          executor.submit(
              () ->
                  inTransaction(
                      () -> {
                        transferPid.set(lockHousehold(householdId));
                        householdService.transferOwnership(
                            householdId, target.getId(), authentication(owner));
                        transferApplied.countDown();
                        await(releaseTransfer, "ownership-transfer release");
                      }));
      assertThat(transferApplied.await(5, TimeUnit.SECONDS)).isTrue();

      Future<Boolean> deletion =
          executor.submit(
              () -> {
                try {
                  deleteAccount(target);
                  return true;
                } catch (AccountDeletionConflictException expected) {
                  return false;
                }
              });
      assertThat(awaitBlockedBy(transferPid.get())).isTrue();

      releaseTransfer.countDown();
      transfer.get(10, TimeUnit.SECONDS);
      assertThat(deletion.get(10, TimeUnit.SECONDS)).isFalse();
    } finally {
      releaseTransfer.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(membershipRole(householdId, target.getId())).isEqualTo("OWNER");
    assertThat(accountStatus(target.getId())).isEqualTo("ACTIVE");
  }

  @Test
  void deletionSerializesWithScheduleCreationAndGeneration() throws Exception {
    User owner = createUser("schedule-owner");
    User member = createUser("schedule-member");
    UUID householdId = createHousehold(owner);
    addMembership(householdId, member, "MEMBER");

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch creationApplied = new CountDownLatch(1);
    CountDownLatch releaseCreation = new CountDownLatch(1);
    AtomicInteger creationPid = new AtomicInteger();
    try {
      Future<?> creation =
          executor.submit(
              () ->
                  inTransaction(
                      () -> {
                        creationPid.set(lockHousehold(householdId));
                        choreService.createChore(
                            householdId,
                            choreRequest(
                                "Concurrent schedule",
                                scheduleRequest(owner.getId(), member.getId())),
                            authentication(owner));
                        creationApplied.countDown();
                        await(releaseCreation, "schedule-creation release");
                      }));
      assertThat(creationApplied.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> deletion = executor.submit(() -> deleteAccount(member));
      assertThat(awaitBlockedBy(creationPid.get())).isTrue();

      releaseCreation.countDown();
      creation.get(10, TimeUnit.SECONDS);
      deletion.get(10, TimeUnit.SECONDS);
    } finally {
      releaseCreation.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertNoAssignmentForMember(householdId, member.getId());

    User generationMember = createUser("generation-member");
    addMembership(householdId, generationMember, "MEMBER");
    UUID choreId = createChore(owner, "Concurrent generation");
    UUID scheduleId = createSchedule(choreId, generationMember.getId());
    ExecutorService generationExecutor = Executors.newFixedThreadPool(2);
    CountDownLatch generationApplied = new CountDownLatch(1);
    CountDownLatch releaseGeneration = new CountDownLatch(1);
    AtomicInteger generationPid = new AtomicInteger();
    try {
      Future<?> generation =
          generationExecutor.submit(
              () ->
                  inTransaction(
                      () -> {
                        generationPid.set(lockHousehold(householdId));
                        occurrenceService.generateHousehold(householdId);
                        generationApplied.countDown();
                        await(releaseGeneration, "generation release");
                      }));
      assertThat(generationApplied.await(5, TimeUnit.SECONDS)).isTrue();

      Future<?> deletion = generationExecutor.submit(() -> deleteAccount(generationMember));
      assertThat(awaitBlockedBy(generationPid.get())).isTrue();

      releaseGeneration.countDown();
      generation.get(10, TimeUnit.SECONDS);
      deletion.get(10, TimeUnit.SECONDS);
    } finally {
      releaseGeneration.countDown();
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
      generationExecutor.shutdownNow();
      generationExecutor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(scheduleActive(scheduleId)).isFalse();
    assertNoAssignmentForMember(householdId, generationMember.getId());
  }

  @Test
  void concurrentAccountDeletionsLockSharedHouseholdsInDeterministicOrder() throws Exception {
    User ownerOne = createUser("shared-owner-one");
    User ownerTwo = createUser("shared-owner-two");
    User first = createUser("shared-first");
    User second = createUser("shared-second");
    UUID firstHousehold = createHousehold(ownerOne);
    UUID secondHousehold = createHousehold(ownerTwo);
    List<UUID> sortedHouseholds =
        List.of(firstHousehold, secondHousehold).stream()
            .sorted(Comparator.comparing(UUID::toString))
            .toList();
    for (UUID householdId : sortedHouseholds) {
      addMembership(householdId, first, "MEMBER");
    }
    for (UUID householdId : sortedHouseholds.reversed()) {
      addMembership(householdId, second, "MEMBER");
    }

    CyclicBarrier start = new CyclicBarrier(3);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> firstDeletion =
          executor.submit(
              () -> {
                awaitBarrier(start);
                deleteAccount(first);
              });
      Future<?> secondDeletion =
          executor.submit(
              () -> {
                awaitBarrier(start);
                deleteAccount(second);
              });
      awaitBarrier(start);
      firstDeletion.get(15, TimeUnit.SECONDS);
      secondDeletion.get(15, TimeUnit.SECONDS);
    } finally {
      executor.shutdownNow();
      executor.awaitTermination(5, TimeUnit.SECONDS);
    }

    assertThat(accountStatus(first.getId())).isEqualTo("DELETED");
    assertThat(accountStatus(second.getId())).isEqualTo("DELETED");
    for (UUID householdId : sortedHouseholds) {
      assertThat(membershipStatus(householdId, first.getId())).isEqualTo("LEFT");
      assertThat(membershipStatus(householdId, second.getId())).isEqualTo("LEFT");
    }
  }

  private User createUser(String localPart) {
    var response =
        authService.register(
            new RegisterRequest(
                localPart, localPart + "-" + UUID.randomUUID() + "@example.test", PASSWORD));
    userIds.add(response.userId());
    return userRepository.findById(response.userId()).orElseThrow();
  }

  private UUID createHousehold(User owner) {
    UUID householdId = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO households (id, name, timezone, created_by_user_id) VALUES (?, 'Shared', 'UTC', ?)",
        householdId,
        owner.getId());
    jdbc.update(
        """
        INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
        VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
        """,
        householdId,
        owner.getId());
    householdIds.add(householdId);
    return householdId;
  }

  private void addMembership(UUID householdId, User user, String role) {
    jdbc.update(
        """
        INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
        VALUES (?, ?, ?, 'ACTIVE', NOW())
        """,
        householdId,
        user.getId(),
        role);
  }

  private UUID createChore(User owner, String title) {
    UUID choreId = UUID.randomUUID();
    jdbc.update(
        """
        INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
        VALUES (?, ?, ?, 'NORMAL', 1, ?)
        """,
        choreId,
        householdIds.getLast(),
        title,
        owner.getId());
    return choreId;
  }

  private UUID createSchedule(UUID choreId, UUID participantId) {
    UUID scheduleId = UUID.randomUUID();
    jdbc.update(
        """
        INSERT INTO chore_schedules
            (id, household_id, chore_id, recurrence_rule, timezone, starts_on,
             assignment_strategy, fixed_assignee_user_id, strategy_config)
        VALUES (?, ?, ?, 'FREQ=DAILY', 'UTC', ?, 'FIXED', ?, CAST(? AS jsonb))
        """,
        scheduleId,
        householdIds.getLast(),
        choreId,
        LocalDate.now(ZoneOffset.UTC).plusDays(1),
        participantId,
        "{\"participantUserIds\":[\"" + participantId + "\"],\"peopleNeeded\":1}");
    return scheduleId;
  }

  private ChoreRequest choreRequest(String title, ChoreScheduleRequest schedule) {
    return new ChoreRequest(title, null, null, null, null, null, false, schedule);
  }

  private ChoreScheduleRequest scheduleRequest(UUID ownerId, UUID memberId) {
    return new ChoreScheduleRequest(
        "FREQ=DAILY",
        "UTC",
        LocalDate.now(ZoneOffset.UTC).plusDays(1),
        null,
        null,
        AssignmentStrategy.ROUND_ROBIN,
        null,
        List.of(ownerId, memberId),
        1);
  }

  private Authentication authentication(User user) {
    return new UsernamePasswordAuthenticationToken(user.getEmail(), null);
  }

  private void deleteAccount(User user) {
    authService.deleteAccount(user.getEmail(), PASSWORD, user.getEmail(), false);
  }

  private void deleteUser(UUID userId, String email) {
    jdbc.update(
        "DELETE FROM spring_session_attributes WHERE session_primary_id IN "
            + "(SELECT primary_id FROM spring_session WHERE principal_name=?)",
        email);
    jdbc.update("DELETE FROM spring_session WHERE principal_name=?", email);
    jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", userId);
    jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
    jdbc.update("DELETE FROM push_subscriptions WHERE user_id=?", userId);
    jdbc.update("DELETE FROM notification_events WHERE actor_user_id=?", userId);
    userRepository.deleteById(userId);
  }

  private void inTransaction(Runnable work) {
    new TransactionTemplate(transactionManager).executeWithoutResult(status -> work.run());
  }

  private int lockHousehold(UUID householdId) {
    int backendPid = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
    jdbc.query(
        "SELECT id FROM households WHERE id=? FOR UPDATE",
        (rs, row) -> rs.getObject("id", UUID.class),
        householdId);
    return backendPid;
  }

  private boolean awaitBlockedBy(int blockerPid) throws InterruptedException {
    return awaitBlockedBy(blockerPid, 1);
  }

  private boolean awaitBlockedBy(int blockerPid, int expectedBlockedSessions)
      throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
    do {
      Integer blockedSessions = blockedSessionCount(blockerPid);
      if (blockedSessions != null && blockedSessions >= expectedBlockedSessions) {
        return true;
      }
      Thread.sleep(20);
    } while (System.nanoTime() < deadline);
    return false;
  }

  private Integer blockedSessionCount(int blockerPid) {
    return jdbc.queryForObject(
        """
        WITH RECURSIVE blocked(pid) AS (
          SELECT activity.pid
          FROM pg_stat_activity activity
          WHERE ? = ANY(pg_blocking_pids(activity.pid))
          UNION
          SELECT activity.pid
          FROM pg_stat_activity activity
          JOIN blocked parent ON parent.pid = ANY(pg_blocking_pids(activity.pid))
        )
        SELECT COUNT(DISTINCT pid) FROM blocked
        """,
        Integer.class,
        blockerPid);
  }

  private void await(CountDownLatch latch, String operation) {
    try {
      if (!latch.await(10, TimeUnit.SECONDS)) {
        throw new IllegalStateException("Timed out waiting for " + operation + ".");
      }
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(operation + " was interrupted.", exception);
    }
  }

  private void awaitBarrier(CyclicBarrier barrier) {
    try {
      barrier.await(10, TimeUnit.SECONDS);
    } catch (Exception exception) {
      throw new IllegalStateException(
          "Concurrent account deletion did not synchronize.", exception);
    }
  }

  private void assertMemberDeleted(UUID householdId, User user) {
    assertThat(membershipStatus(householdId, user.getId())).isEqualTo("LEFT");
    assertThat(accountStatus(user.getId())).isEqualTo("DELETED");
  }

  private void assertNoAssignmentForMember(UUID householdId, UUID userId) {
    assertThat(
            jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM chore_assignments
                WHERE household_id=? AND assigned_to_user_id=?
                """,
                Integer.class,
                householdId,
                userId))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM chore_assignment_assignees
                WHERE household_id=? AND user_id=?
                """,
                Integer.class,
                householdId,
                userId))
        .isZero();
  }

  private boolean scheduleActive(UUID scheduleId) {
    return jdbc.queryForObject(
        "SELECT is_active FROM chore_schedules WHERE id=?", Boolean.class, scheduleId);
  }

  private String membershipStatus(UUID householdId, UUID userId) {
    return jdbc.queryForObject(
        "SELECT status FROM household_memberships WHERE household_id=? AND user_id=?",
        String.class,
        householdId,
        userId);
  }

  private String membershipRole(UUID householdId, UUID userId) {
    return jdbc.queryForObject(
        "SELECT role FROM household_memberships WHERE household_id=? AND user_id=?",
        String.class,
        householdId,
        userId);
  }

  private String accountStatus(UUID userId) {
    return jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, userId);
  }
}
