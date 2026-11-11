package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.ChoreCategoryResponse;
import com.dirtyduty.app.dto.chore.ChoreManagementOptionsResponse;
import com.dirtyduty.app.dto.chore.ChoreMemberOptionResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreResponse;
import com.dirtyduty.app.dto.chore.ChoreScheduleRequest;
import com.dirtyduty.app.dto.chore.ChoreScheduleResponse;
import com.dirtyduty.app.entity.Chore;
import com.dirtyduty.app.entity.ChoreCategory;
import com.dirtyduty.app.entity.ChoreSchedule;
import com.dirtyduty.app.entity.Household;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import com.dirtyduty.app.entity.enums.ChorePriority;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.HouseholdAccessDeniedException;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.ChoreCategoryRepository;
import com.dirtyduty.app.repository.ChoreRepository;
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ChoreService {

  private final ChoreRepository choreRepository;
  private final ChoreCategoryRepository choreCategoryRepository;
  private final ChoreScheduleRepository choreScheduleRepository;
  private final HouseholdMembershipRepository membershipRepository;
  private final UserRepository userRepository;
  private final OccurrenceService occurrenceService;
  private final JdbcTemplate jdbc;

  public ChoreService(
      ChoreRepository choreRepository,
      ChoreCategoryRepository choreCategoryRepository,
      ChoreScheduleRepository choreScheduleRepository,
      HouseholdMembershipRepository membershipRepository,
      UserRepository userRepository,
      OccurrenceService occurrenceService,
      JdbcTemplate jdbc) {
    this.choreRepository = choreRepository;
    this.choreCategoryRepository = choreCategoryRepository;
    this.choreScheduleRepository = choreScheduleRepository;
    this.membershipRepository = membershipRepository;
    this.userRepository = userRepository;
    this.occurrenceService = occurrenceService;
    this.jdbc = jdbc;
  }

  @Transactional
  public List<ChoreCategoryResponse> listCategories(
      UUID householdId, Authentication authentication) {
    Household household = authorize(householdId, authentication).getHousehold();
    ChoreCategoryDefaults.ensureFor(household, choreCategoryRepository);
    return categoriesFor(householdId);
  }

  @Transactional
  public ChoreManagementOptionsResponse managementOptions(
      UUID householdId, Authentication authentication) {
    Household household = authorize(householdId, authentication).getHousehold();
    ChoreCategoryDefaults.ensureFor(household, choreCategoryRepository);
    List<ChoreMemberOptionResponse> activeMembers =
        membershipRepository
            .findByHousehold_IdAndStatus(householdId, MembershipStatus.ACTIVE)
            .stream()
            .map(
                membership ->
                    new ChoreMemberOptionResponse(
                        membership.getUser().getId(), membership.getUser().getDisplayName()))
            .toList();
    return new ChoreManagementOptionsResponse(categoriesFor(householdId), activeMembers);
  }

  @Transactional(readOnly = true)
  public List<ChoreResponse> listChores(
      UUID householdId, boolean includeArchived, Authentication authentication) {
    authorize(householdId, authentication);
    List<Chore> chores =
        includeArchived
            ? choreRepository.findByHousehold_IdOrderByCreatedAtDesc(householdId)
            : choreRepository.findByHousehold_IdAndArchivedAtIsNullOrderByCreatedAtDesc(
                householdId);
    return chores.stream().map(this::toResponse).toList();
  }

  @Transactional
  public ChoreResponse createChore(
      UUID householdId, ChoreRequest request, Authentication authentication) {
    lockHousehold(householdId);
    HouseholdMembership actorMembership = authorize(householdId, authentication);
    Household household = actorMembership.getHousehold();
    Chore chore = new Chore();
    chore.setHousehold(household);
    chore.setCreatedByUser(actorMembership.getUser());
    applyChoreFields(chore, householdId, request);
    choreRepository.save(chore);
    applySchedule(chore, household, householdId, request.schedule());
    return toResponse(chore);
  }

  @Transactional(readOnly = true)
  public ChoreResponse getChore(UUID householdId, UUID choreId, Authentication authentication) {
    authorize(householdId, authentication);
    return toResponse(findChore(householdId, choreId));
  }

  @Transactional
  public ChoreResponse updateChore(
      UUID householdId, UUID choreId, ChoreRequest request, Authentication authentication) {
    lockHousehold(householdId);
    authorize(householdId, authentication);
    Chore chore = findMutableChore(householdId, choreId);
    applyChoreFields(chore, householdId, request);
    if (request.schedule() != null) {
      applySchedule(chore, chore.getHousehold(), householdId, request.schedule());
    }
    return toResponse(chore);
  }

  @Transactional
  public ChoreResponse pauseChore(UUID householdId, UUID choreId, Authentication authentication) {
    lockHousehold(householdId);
    authorize(householdId, authentication);
    Chore chore = findMutableChore(householdId, choreId);
    chore.setActive(false);
    choreScheduleRepository
        .findByChore_IdAndHousehold_IdForUpdate(choreId, householdId)
        .ifPresent(
            schedule -> {
              schedule.setActive(false);
              occurrenceService.synchronizeSchedule(schedule);
            });
    return toResponse(chore);
  }

  @Transactional
  public ChoreResponse activateChore(
      UUID householdId, UUID choreId, Authentication authentication) {
    lockHousehold(householdId);
    authorize(householdId, authentication);
    Chore chore = findMutableChore(householdId, choreId);
    choreScheduleRepository
        .findByChore_IdAndHousehold_IdForUpdate(choreId, householdId)
        .ifPresent(
            schedule -> {
              validateScheduleConfiguration(
                  householdId,
                  schedule.getAssignmentStrategy(),
                  participantIds(schedule.getStrategyConfig()),
                  peopleNeeded(schedule.getStrategyConfig()),
                  schedule.getFixedAssignee() == null ? null : schedule.getFixedAssignee().getId());
              occurrenceService.validateOneTimeActivation(schedule);
              chore.setActive(true);
              schedule.setActive(true);
              occurrenceService.synchronizeSchedule(schedule, true, true);
            });
    chore.setActive(true);
    return toResponse(chore);
  }

  @Transactional
  public ChoreResponse archiveChore(UUID householdId, UUID choreId, Authentication authentication) {
    lockHousehold(householdId);
    authorize(householdId, authentication);
    Chore chore = findChore(householdId, choreId);
    if (chore.getArchivedAt() == null) {
      chore.setActive(false);
      chore.setArchivedAt(OffsetDateTime.now(ZoneOffset.UTC));
      choreScheduleRepository
          .findByChore_IdAndHousehold_IdForUpdate(choreId, householdId)
          .ifPresent(
              schedule -> {
                schedule.setActive(false);
                occurrenceService.synchronizeSchedule(schedule);
              });
    }
    return toResponse(chore);
  }

  private void applyChoreFields(Chore chore, UUID householdId, ChoreRequest request) {
    chore.setTitle(request.title().strip());
    chore.setDescription(request.description() == null ? null : request.description().strip());
    chore.setDefaultPriority(
        request.defaultPriority() == null ? ChorePriority.NORMAL : request.defaultPriority());
    chore.setDifficulty((short) (request.difficulty() == null ? 1 : request.difficulty()));
    chore.setEstimatedMinutes(request.estimatedMinutes());
    chore.setRequiresVerification(Boolean.TRUE.equals(request.requiresVerification()));
    if (request.categoryId() == null) {
      chore.setCategory(null);
    } else {
      ChoreCategory category =
          choreCategoryRepository
              .findById(request.categoryId())
              .filter(candidate -> candidate.getHousehold().getId().equals(householdId))
              .orElseThrow(
                  () ->
                      new InvalidHouseholdException(
                          "Category must belong to the authorized household."));
      chore.setCategory(category);
    }
  }

  private void applySchedule(
      Chore chore, Household household, UUID householdId, ChoreScheduleRequest request) {
    if (request == null) {
      return;
    }
    lockHousehold(householdId);
    ChoreSchedule schedule =
        choreScheduleRepository
            .findByChore_IdAndHousehold_IdForUpdate(chore.getId(), householdId)
            .orElseGet(() -> createSchedule(chore, household));
    if (request.recurrenceRule() == null
        || request.recurrenceRule().isBlank()
        || household.getTimezone() == null
        || !ZoneId.getAvailableZoneIds().contains(household.getTimezone())
        || request.startsOn() == null) {
      throw new InvalidHouseholdException(
          "A schedule requires a supported recurrence rule, household timezone, and start date.");
    }
    // Parsing validates the rule with a specific message; the canonical form is what we store.
    RecurrenceRule parsedRule = RecurrenceRule.parse(request.recurrenceRule());
    String recurrenceRule = parsedRule.toString();
    if (request.endsOn() != null && request.endsOn().isBefore(request.startsOn())) {
      throw new InvalidHouseholdException("Schedule end date cannot be before its start date.");
    }
    if (parsedRule.count().isPresent() && request.endsOn() != null) {
      throw new InvalidHouseholdException(
          "Choose either an end date or a number of times, not both.");
    }
    if (!parsedRule.isOneTime() && parsedRule.firstDate(request.startsOn()).isEmpty()) {
      throw new InvalidHouseholdException(
          "This schedule never produces a date. Check its start date and active months.");
    }
    AssignmentStrategy strategy =
        request.assignmentStrategy() == null
            ? AssignmentStrategy.MANUAL
            : request.assignmentStrategy();
    List<UUID> participantIds =
        request.participantUserIds() == null ? List.of() : request.participantUserIds();
    int peopleNeeded = request.peopleNeeded() == null ? 1 : request.peopleNeeded();
    if (peopleNeeded < 1 || peopleNeeded > 50) {
      throw new InvalidHouseholdException("People Needed must be between 1 and 50.");
    }
    if (participantIds.stream().distinct().count() != participantIds.size()) {
      throw new InvalidHouseholdException("Schedule participants cannot contain duplicates.");
    }

    User fixedAssignee;
    if (strategy == AssignmentStrategy.FIXED) {
      if (participantIds.isEmpty() && request.fixedAssigneeUserId() != null && peopleNeeded == 1) {
        participantIds = List.of(request.fixedAssigneeUserId());
      }
      if (request.fixedAssigneeUserId() != null
          && !participantIds.contains(request.fixedAssigneeUserId())) {
        throw new InvalidHouseholdException(
            "The fixed assignee must be one of the selected participants.");
      }
    } else if (request.fixedAssigneeUserId() != null) {
      throw new InvalidHouseholdException("A fixed assignee is only valid for FIXED assignment.");
    }
    ScheduleConfiguration configuration =
        validateScheduleConfiguration(
            householdId,
            strategy,
            participantIds,
            peopleNeeded,
            strategy == AssignmentStrategy.FIXED && request.fixedAssigneeUserId() == null
                ? (participantIds.isEmpty() ? null : participantIds.getFirst())
                : request.fixedAssigneeUserId());
    participantIds = configuration.participantIds();
    fixedAssignee = configuration.fixedAssignee();
    List<UUID> validatedParticipants = configuration.participantIds();
    String previousRecurrenceRule = schedule.getRecurrenceRule();
    occurrenceService.validateScheduleFrequencyChange(
        schedule, previousRecurrenceRule, recurrenceRule);
    boolean assignmentConfigChanged =
        schedule.getId() != null
            && (schedule.getAssignmentStrategy() != strategy
                || peopleNeeded(schedule.getStrategyConfig()) != peopleNeeded
                || !participantIds(schedule.getStrategyConfig()).equals(validatedParticipants));
    schedule.setRecurrenceRule(recurrenceRule);
    schedule.setTimezone(household.getTimezone());
    schedule.setStartsOn(request.startsOn());
    schedule.setEndsOn(request.endsOn());
    schedule.setDueTime(request.dueTime());
    schedule.setAssignmentStrategy(strategy);
    schedule.setFixedAssignee(fixedAssignee);
    Map<String, Object> config = new HashMap<>();
    config.put("participantUserIds", validatedParticipants.stream().map(UUID::toString).toList());
    config.put("peopleNeeded", peopleNeeded);
    schedule.setStrategyConfig(config);
    schedule.setActive(chore.isActive());
    choreScheduleRepository.saveAndFlush(schedule);
    occurrenceService.synchronizeSchedule(schedule, assignmentConfigChanged, true);
  }

  private ChoreSchedule createSchedule(Chore chore, Household household) {
    ChoreSchedule schedule = new ChoreSchedule();
    schedule.setHousehold(household);
    schedule.setChore(chore);
    return schedule;
  }

  private User validateActiveMember(UUID householdId, UUID userId) {
    if (!membershipRepository.existsByHousehold_IdAndUser_IdAndStatus(
        householdId, userId, MembershipStatus.ACTIVE)) {
      throw new InvalidHouseholdException(
          "Every selected participant must be an ACTIVE member of this household.");
    }
    return userRepository
        .findById(userId)
        .orElseThrow(
            () ->
                new InvalidHouseholdException(
                    "Every selected participant must be an ACTIVE member of this household."));
  }

  private ScheduleConfiguration validateScheduleConfiguration(
      UUID householdId,
      AssignmentStrategy strategy,
      List<UUID> selectedParticipantIds,
      int peopleNeeded,
      UUID fixedAssigneeId) {
    if (peopleNeeded < 1 || peopleNeeded > 50) {
      throw new InvalidHouseholdException("People Needed must be between 1 and 50.");
    }
    List<UUID> participantIds = new ArrayList<>(selectedParticipantIds);
    if (participantIds.stream().distinct().count() != participantIds.size()) {
      throw new InvalidHouseholdException("Schedule participants cannot contain duplicates.");
    }
    if (strategy == AssignmentStrategy.FIXED
        && participantIds.isEmpty()
        && fixedAssigneeId != null
        && peopleNeeded == 1) {
      participantIds.add(fixedAssigneeId);
    }
    if (strategy == AssignmentStrategy.FIXED) {
      if (participantIds.size() != peopleNeeded) {
        throw new InvalidHouseholdException(
            "FIXED assignment requires exactly People Needed distinct members.");
      }
      if (fixedAssigneeId == null || !participantIds.contains(fixedAssigneeId)) {
        throw new InvalidHouseholdException(
            "Choose a fixed assignee from the selected participants before activating this chore.");
      }
    } else if (strategy == AssignmentStrategy.ROUND_ROBIN
        || strategy == AssignmentStrategy.RANDOM) {
      if (participantIds.size() < peopleNeeded) {
        throw new InvalidHouseholdException(
            "Rotation and random pools must contain at least People Needed members.");
      }
      if (fixedAssigneeId != null) {
        throw new InvalidHouseholdException("A fixed assignee is only valid for FIXED assignment.");
      }
    } else if (!participantIds.isEmpty() || fixedAssigneeId != null) {
      throw new InvalidHouseholdException(
          "Participants are only valid for FIXED, ROUND_ROBIN or RANDOM assignment.");
    }
    for (UUID participantId : participantIds) {
      validateActiveMember(householdId, participantId);
    }
    return new ScheduleConfiguration(
        List.copyOf(participantIds),
        fixedAssigneeId == null ? null : validateActiveMember(householdId, fixedAssigneeId));
  }

  private void lockHousehold(UUID householdId) {
    if (jdbc.query(
            "SELECT id FROM households WHERE id=? FOR UPDATE",
            (rs, row) -> rs.getObject("id", UUID.class),
            householdId)
        .isEmpty()) {
      throw new HouseholdAccessDeniedException("You are not authorized to manage chores.");
    }
  }

  private HouseholdMembership authorize(UUID householdId, Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new HouseholdAccessDeniedException("You are not authorized to manage chores.");
    }
    User user =
        userRepository
            .findByEmailIgnoreCase(authentication.getName())
            .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
            .orElseThrow(
                () ->
                    new HouseholdAccessDeniedException("You are not authorized to manage chores."));
    HouseholdMembership membership =
        membershipRepository
            .findByHousehold_IdAndUser_Id(householdId, user.getId())
            .filter(found -> found.getStatus() == MembershipStatus.ACTIVE)
            .filter(
                found ->
                    found.getRole() == HouseholdRole.OWNER
                        || found.getRole() == HouseholdRole.ADMIN)
            .orElseThrow(
                () ->
                    new HouseholdAccessDeniedException("You are not authorized to manage chores."));
    return membership;
  }

  private Chore findChore(UUID householdId, UUID choreId) {
    return choreRepository
        .findByIdAndHousehold_Id(choreId, householdId)
        .orElseThrow(() -> new ResourceNotFoundException("Chore was not found in this household."));
  }

  private Chore findMutableChore(UUID householdId, UUID choreId) {
    Chore chore = findChore(householdId, choreId);
    if (chore.getArchivedAt() != null) {
      throw new ResourceNotFoundException("Chore was not found in this household.");
    }
    return chore;
  }

  private ChoreResponse toResponse(Chore chore) {
    ChoreScheduleResponse scheduleResponse =
        choreScheduleRepository
            .findByChore_IdAndHousehold_Id(chore.getId(), chore.getHousehold().getId())
            .map(
                schedule ->
                    new ChoreScheduleResponse(
                        schedule.getRecurrenceRule(),
                        schedule.getTimezone(),
                        schedule.getStartsOn(),
                        schedule.getEndsOn(),
                        schedule.getDueTime(),
                        schedule.getAssignmentStrategy(),
                        schedule.getFixedAssignee() == null
                            ? null
                            : schedule.getFixedAssignee().getId(),
                        participantIds(schedule.getStrategyConfig()),
                        schedule.isActive(),
                        peopleNeeded(schedule.getStrategyConfig())))
            .orElse(null);
    return new ChoreResponse(
        chore.getId(),
        chore.getHousehold().getId(),
        chore.getCategory() == null ? null : chore.getCategory().getId(),
        chore.getTitle(),
        chore.getDescription(),
        chore.getDefaultPriority(),
        chore.getDifficulty(),
        chore.getEstimatedMinutes(),
        chore.isRequiresVerification(),
        chore.isActive(),
        chore.getArchivedAt(),
        chore.getCreatedAt(),
        chore.getUpdatedAt(),
        scheduleResponse);
  }

  private List<ChoreCategoryResponse> categoriesFor(UUID householdId) {
    return choreCategoryRepository
        .findByHousehold_IdOrderBySortOrderAscNameAsc(householdId)
        .stream()
        .map(
            category ->
                new ChoreCategoryResponse(
                    category.getId(),
                    category.getName(),
                    category.getIconKey(),
                    category.getSortOrder(),
                    category.getCreatedAt()))
        .toList();
  }

  private List<UUID> participantIds(Map<String, Object> config) {
    Object value = config == null ? null : config.get("participantUserIds");
    if (!(value instanceof List<?> ids)) {
      return List.of();
    }
    return ids.stream().map(Object::toString).map(UUID::fromString).toList();
  }

  private int peopleNeeded(Map<String, Object> config) {
    Object value = config == null ? null : config.get("peopleNeeded");
    return value instanceof Number number ? number.intValue() : 1;
  }

  private record ScheduleConfiguration(List<UUID> participantIds, User fixedAssignee) {}
}
