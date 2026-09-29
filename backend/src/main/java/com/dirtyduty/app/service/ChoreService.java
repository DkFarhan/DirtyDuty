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
import java.util.Set;
import java.util.UUID;
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

    public ChoreService(
            ChoreRepository choreRepository,
            ChoreCategoryRepository choreCategoryRepository,
            ChoreScheduleRepository choreScheduleRepository,
            HouseholdMembershipRepository membershipRepository,
            UserRepository userRepository,
            OccurrenceService occurrenceService) {
        this.choreRepository = choreRepository;
        this.choreCategoryRepository = choreCategoryRepository;
        this.choreScheduleRepository = choreScheduleRepository;
        this.membershipRepository = membershipRepository;
        this.userRepository = userRepository;
        this.occurrenceService = occurrenceService;
    }

    @Transactional
    public List<ChoreCategoryResponse> listCategories(UUID householdId, Authentication authentication) {
        Household household = authorize(householdId, authentication).getHousehold();
        ChoreCategoryDefaults.ensureFor(household, choreCategoryRepository);
        return categoriesFor(householdId);
    }

    @Transactional
    public ChoreManagementOptionsResponse managementOptions(
            UUID householdId, Authentication authentication) {
        Household household = authorize(householdId, authentication).getHousehold();
        ChoreCategoryDefaults.ensureFor(household, choreCategoryRepository);
        List<ChoreMemberOptionResponse> activeMembers = membershipRepository
                .findByHousehold_IdAndStatus(householdId, MembershipStatus.ACTIVE).stream()
                .map(membership -> new ChoreMemberOptionResponse(
                        membership.getUser().getId(), membership.getUser().getDisplayName()))
                .toList();
        return new ChoreManagementOptionsResponse(categoriesFor(householdId), activeMembers);
    }

    @Transactional(readOnly = true)
    public List<ChoreResponse> listChores(
            UUID householdId, boolean includeArchived, Authentication authentication) {
        authorize(householdId, authentication);
        List<Chore> chores = includeArchived
                ? choreRepository.findByHousehold_IdOrderByCreatedAtDesc(householdId)
                : choreRepository.findByHousehold_IdAndArchivedAtIsNullOrderByCreatedAtDesc(householdId);
        return chores.stream().map(this::toResponse).toList();
    }

    @Transactional
    public ChoreResponse createChore(UUID householdId, ChoreRequest request, Authentication authentication) {
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
        authorize(householdId, authentication);
        Chore chore = findMutableChore(householdId, choreId);
        chore.setActive(false);
        choreScheduleRepository.findByChore_IdAndHousehold_Id(choreId, householdId)
                .ifPresent(schedule -> {
                    schedule.setActive(false);
                    occurrenceService.synchronizeSchedule(schedule);
                });
        return toResponse(chore);
    }

    @Transactional
    public ChoreResponse activateChore(UUID householdId, UUID choreId, Authentication authentication) {
        authorize(householdId, authentication);
        Chore chore = findMutableChore(householdId, choreId);
        chore.setActive(true);
        choreScheduleRepository.findByChore_IdAndHousehold_Id(choreId, householdId)
                .ifPresent(schedule -> {
                    schedule.setActive(true);
                    occurrenceService.synchronizeSchedule(schedule);
                });
        return toResponse(chore);
    }

    @Transactional
    public ChoreResponse archiveChore(UUID householdId, UUID choreId, Authentication authentication) {
        authorize(householdId, authentication);
        Chore chore = findChore(householdId, choreId);
        if (chore.getArchivedAt() == null) {
            chore.setActive(false);
            chore.setArchivedAt(OffsetDateTime.now(ZoneOffset.UTC));
            choreScheduleRepository.findByChore_IdAndHousehold_Id(choreId, householdId)
                    .ifPresent(schedule -> {
                        schedule.setActive(false);
                        occurrenceService.synchronizeSchedule(schedule);
                    });
        }
        return toResponse(chore);
    }

    private void applyChoreFields(Chore chore, UUID householdId, ChoreRequest request) {
        chore.setTitle(request.title().strip());
        chore.setDescription(request.description() == null ? null : request.description().strip());
        chore.setDefaultPriority(request.defaultPriority() == null ? ChorePriority.NORMAL : request.defaultPriority());
        chore.setDifficulty((short) (request.difficulty() == null ? 1 : request.difficulty()));
        chore.setEstimatedMinutes(request.estimatedMinutes());
        chore.setRequiresVerification(Boolean.TRUE.equals(request.requiresVerification()));
        if (request.categoryId() == null) {
            chore.setCategory(null);
        } else {
            ChoreCategory category = choreCategoryRepository.findById(request.categoryId())
                    .filter(candidate -> candidate.getHousehold().getId().equals(householdId))
                    .orElseThrow(() -> new InvalidHouseholdException(
                            "Category must belong to the authorized household."));
            chore.setCategory(category);
        }

    }

    private void applySchedule(
            Chore chore, Household household, UUID householdId, ChoreScheduleRequest request) {
        if (request == null) {
            return;
        }
        String recurrenceRule = request.recurrenceRule() == null ? null : request.recurrenceRule().strip();
        if (recurrenceRule == null || recurrenceRule.isBlank()
                || !isSupportedRecurrenceRule(recurrenceRule)
                || household.getTimezone() == null
                || !ZoneId.getAvailableZoneIds().contains(household.getTimezone())
                || request.startsOn() == null) {
            throw new InvalidHouseholdException(
                    "A schedule requires a supported recurrence rule, household timezone, and start date.");
        }
        if (request.endsOn() != null && request.endsOn().isBefore(request.startsOn())) {
            throw new InvalidHouseholdException("Schedule end date cannot be before its start date.");
        }
        AssignmentStrategy strategy = request.assignmentStrategy() == null
                ? AssignmentStrategy.MANUAL : request.assignmentStrategy();
        List<UUID> participantIds = request.participantUserIds() == null
                ? List.of() : request.participantUserIds();
        int peopleNeeded = request.peopleNeeded() == null ? 1 : request.peopleNeeded();
        if (peopleNeeded < 1 || peopleNeeded > 50) {
            throw new InvalidHouseholdException("People Needed must be between 1 and 50.");
        }
        if (participantIds.stream().distinct().count() != participantIds.size()) {
            throw new InvalidHouseholdException("Schedule participants cannot contain duplicates.");
        }

        User fixedAssignee = null;
        if (strategy == AssignmentStrategy.FIXED) {
            if (participantIds.isEmpty() && request.fixedAssigneeUserId() != null && peopleNeeded == 1) {
                participantIds = List.of(request.fixedAssigneeUserId());
            }
            if (participantIds.size() != peopleNeeded) {
                throw new InvalidHouseholdException("FIXED assignment requires exactly People Needed distinct members.");
            }
            if (request.fixedAssigneeUserId() != null
                    && !participantIds.contains(request.fixedAssigneeUserId())) {
                throw new InvalidHouseholdException("The fixed assignee must be one of the selected participants.");
            }
            if (participantIds.isEmpty()) {
                throw new InvalidHouseholdException("FIXED assignment requires active household members.");
            }
            fixedAssignee = validateActiveMember(householdId,
                    request.fixedAssigneeUserId() == null ? participantIds.getFirst() : request.fixedAssigneeUserId());
        } else if (request.fixedAssigneeUserId() != null) {
            throw new InvalidHouseholdException("A fixed assignee is only valid for FIXED assignment.");
        }
        if (strategy == AssignmentStrategy.ROUND_ROBIN || strategy == AssignmentStrategy.RANDOM) {
            if (participantIds.size() < peopleNeeded) {
                throw new InvalidHouseholdException("Rotation and random pools must contain at least People Needed members.");
            }
        } else if (!participantIds.isEmpty()) {
            if (strategy != AssignmentStrategy.FIXED) {
                throw new InvalidHouseholdException(
                        "Participants are only valid for FIXED, ROUND_ROBIN or RANDOM assignment.");
            }
        }
        List<UUID> validatedParticipants = new ArrayList<>(participantIds.size());
        for (UUID participantId : participantIds) {
            validateActiveMember(householdId, participantId);
            validatedParticipants.add(participantId);
        }

        ChoreSchedule schedule = choreScheduleRepository.findByChore_IdAndHousehold_Id(chore.getId(), householdId)
                .orElseGet(() -> createSchedule(chore, household));
        boolean assignmentConfigChanged = schedule.getId() != null
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
        occurrenceService.synchronizeSchedule(schedule, assignmentConfigChanged);
    }

    private boolean isSupportedRecurrenceRule(String recurrenceRule) {
        if (recurrenceRule.equals("FREQ=ONCE") || recurrenceRule.equals("FREQ=DAILY")) {
            return true;
        }

        String[] fields = recurrenceRule.split(";", -1);
        if (fields.length < 2 || fields.length > 3 || !fields[0].equals("FREQ=WEEKLY")) {
            return false;
        }

        int byDayIndex = fields.length - 1;
        if (fields.length == 3) {
            if (!fields[1].startsWith("INTERVAL=")) {
                return false;
            }
            try {
                int interval = Integer.parseInt(fields[1].substring("INTERVAL=".length()));
                if (interval < 2 || interval > 52) {
                    return false;
                }
            } catch (NumberFormatException exception) {
                return false;
            }
        }

        String dayField = fields[byDayIndex];
        if (!dayField.startsWith("BYDAY=")) {
            return false;
        }
        String[] days = dayField.substring("BYDAY=".length()).split(",", -1);
        Set<String> validDays = Set.of("MO", "TU", "WE", "TH", "FR", "SA", "SU");
        Set<String> submittedDays = new java.util.HashSet<>(List.of(days));
        return days.length > 0
                && submittedDays.size() == days.length
                && submittedDays.stream().allMatch(validDays::contains);
    }

    private ChoreSchedule createSchedule(Chore chore, Household household) {
        ChoreSchedule schedule = new ChoreSchedule();
        schedule.setHousehold(household);
        schedule.setChore(chore);
        return schedule;
    }

    private User validateActiveMember(UUID householdId, UUID userId) {
        return membershipRepository.findByHousehold_IdAndUser_Id(householdId, userId)
                .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
                .map(HouseholdMembership::getUser)
                .orElseThrow(() -> new InvalidHouseholdException(
                        "Every selected participant must be an ACTIVE member of this household."));
    }

    private HouseholdMembership authorize(UUID householdId, Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new HouseholdAccessDeniedException("You are not authorized to manage chores.");
        }
        User user = userRepository.findByEmailIgnoreCase(authentication.getName())
                .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not authorized to manage chores."));
        HouseholdMembership membership = membershipRepository
                .findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(found -> found.getStatus() == MembershipStatus.ACTIVE)
                .filter(found -> found.getRole() == HouseholdRole.OWNER || found.getRole() == HouseholdRole.ADMIN)
                .orElseThrow(() -> new HouseholdAccessDeniedException(
                        "Only an ACTIVE household OWNER or ADMIN may manage chores."));
        return membership;
    }

    private Chore findChore(UUID householdId, UUID choreId) {
        return choreRepository.findByIdAndHousehold_Id(choreId, householdId)
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
        ChoreScheduleResponse scheduleResponse = choreScheduleRepository
                .findByChore_IdAndHousehold_Id(chore.getId(), chore.getHousehold().getId())
                .map(schedule -> new ChoreScheduleResponse(
                        schedule.getRecurrenceRule(),
                        schedule.getTimezone(),
                        schedule.getStartsOn(),
                        schedule.getEndsOn(),
                        schedule.getDueTime(),
                        schedule.getAssignmentStrategy(),
                        schedule.getFixedAssignee() == null ? null : schedule.getFixedAssignee().getId(),
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
        return choreCategoryRepository.findByHousehold_IdOrderBySortOrderAscNameAsc(householdId).stream()
                .map(category -> new ChoreCategoryResponse(
                        category.getId(), category.getName(), category.getIconKey(), category.getSortOrder(),
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
}
