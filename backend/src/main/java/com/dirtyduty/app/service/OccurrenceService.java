package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.chore.AssigneeResponse;
import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.DashboardResponse;
import com.dirtyduty.app.dto.chore.HouseholdMemberStatsResponse;
import com.dirtyduty.app.entity.Chore;
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
import com.dirtyduty.app.repository.ChoreScheduleRepository;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OccurrenceService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate jdbc;
    private final ChoreScheduleRepository scheduleRepository;
    private final HouseholdMembershipRepository membershipRepository;
    private final UserRepository userRepository;
    private final NotificationEventService notificationEventService;
    private final int horizonDays;

    public OccurrenceService(
            JdbcTemplate jdbc,
            ChoreScheduleRepository scheduleRepository,
            HouseholdMembershipRepository membershipRepository,
            UserRepository userRepository,
            NotificationEventService notificationEventService,
            @Value("${app.chores.occurrence-horizon-days:30}") int horizonDays) {
        if (horizonDays < 1 || horizonDays > 90) {
            throw new IllegalArgumentException("Occurrence horizon must be between 1 and 90 days.");
        }
        this.jdbc = jdbc;
        this.scheduleRepository = scheduleRepository;
        this.membershipRepository = membershipRepository;
        this.userRepository = userRepository;
        this.notificationEventService = notificationEventService;
        this.horizonDays = horizonDays;
    }

    @Transactional
    public void synchronizeSchedule(ChoreSchedule schedule) {
        synchronizeSchedule(schedule, false);
    }

    @Transactional
    public void synchronizeSchedule(ChoreSchedule schedule, boolean updatePendingAssignees) {
        jdbc.queryForObject("SELECT id FROM chore_schedules WHERE id=? FOR UPDATE", UUID.class, schedule.getId());
        Household household = schedule.getHousehold();
        ZoneId zone = ZoneId.of(schedule.getTimezone());
        LocalDate today = LocalDate.now(zone);
        LocalDate limit = today.plusDays(horizonDays);
        if (schedule.getEndsOn() != null && schedule.getEndsOn().plusDays(1).isBefore(limit)) {
            limit = schedule.getEndsOn().plusDays(1);
        }

        boolean enabled = schedule.isActive() && schedule.getChore().isActive()
                && schedule.getChore().getArchivedAt() == null;
        List<LocalDate> dates = new ArrayList<>();
        if (enabled) {
            for (LocalDate date = schedule.getStartsOn().isAfter(today) ? schedule.getStartsOn() : today;
                    date.isBefore(limit); date = date.plusDays(1)) {
                if (occurs(schedule.getRecurrenceRule(), schedule.getStartsOn(), date)) {
                    dates.add(date);
                }
            }
        }

        List<FutureOccurrence> existingFuture = jdbc.query(
                "SELECT id, scheduled_for FROM chore_assignments "
                        + "WHERE schedule_id = ? AND household_id = ? AND scheduled_for >= ? "
                        + "AND status IN ('PENDING','SUBMITTED')",
                (rs, row) -> new FutureOccurrence(rs.getObject("id", UUID.class),
                        rs.getObject("scheduled_for", LocalDate.class)),
                schedule.getId(), household.getId(), today);
        for (FutureOccurrence occurrence : existingFuture) {
            if (!dates.contains(occurrence.scheduledFor())) {
                jdbc.update("UPDATE chore_assignments SET status='CANCELLED', updated_at=NOW() "
                                + "WHERE id=? AND status IN ('PENDING','SUBMITTED')",
                        occurrence.id());
            }
        }

        for (LocalDate date : dates) {
            List<UUID> assignees = selectedAssignees(schedule, date);
            OffsetDateTime dueAt = schedule.getDueTime() == null ? null
                    : dueAt(date, schedule.getDueTime(), zone);
            UUID occurrenceId = jdbc.query(
                    "SELECT id FROM chore_assignments WHERE schedule_id=? AND scheduled_for=?",
                    rs -> rs.next() ? rs.getObject(1, UUID.class) : null,
                    schedule.getId(), date);
            Chore chore = schedule.getChore();
            if (occurrenceId == null) {
                occurrenceId = UUID.randomUUID();
                int inserted = jdbc.update("""
                        INSERT INTO chore_assignments
                            (id, household_id, chore_id, schedule_id, assigned_to_user_id,
                             scheduled_for, due_at, status, title_snapshot, priority_snapshot,
                             difficulty_snapshot, estimated_minutes_snapshot)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
                        ON CONFLICT (schedule_id, scheduled_for) WHERE schedule_id IS NOT NULL DO NOTHING
                        """,
                        occurrenceId, household.getId(), chore.getId(), schedule.getId(),
                        assignees.isEmpty() ? null : assignees.getFirst(), date, dueAt,
                        chore.getTitle(), chore.getDefaultPriority().name(), chore.getDifficulty(),
                        chore.getEstimatedMinutes());
                if (inserted == 0) {
                    continue;
                }
                for (UUID userId : assignees) {
                    jdbc.update("""
                            INSERT INTO chore_assignment_assignees
                                (household_id, assignment_id, user_id)
                            VALUES (?, ?, ?) ON CONFLICT (assignment_id, user_id) DO NOTHING
                            """, household.getId(), occurrenceId, userId);
                }
                notificationEventService.publish(new NotificationEvent(
                        "CHORE_ASSIGNED",
                        null,
                        household.getId(),
                        "CHORE_ASSIGNMENT",
                        occurrenceId,
                        "CHORE_REMINDER",
                        java.util.Map.of("chore_name", chore.getTitle()),
                        assignees));
            } else {
                String occurrenceStatus = status(occurrenceId);
                if (!"PENDING".equals(occurrenceStatus) && !"SUBMITTED".equals(occurrenceStatus)
                        && !"CANCELLED".equals(occurrenceStatus)) {
                    continue;
                }
                jdbc.update("""
                        UPDATE chore_assignments
                        SET status='PENDING', due_at=?, title_snapshot=?, priority_snapshot=?,
                            difficulty_snapshot=?, estimated_minutes_snapshot=?, updated_at=NOW()
                        WHERE id=? AND status IN ('PENDING','SUBMITTED','CANCELLED')
                        """,
                        dueAt, chore.getTitle(), chore.getDefaultPriority().name(), chore.getDifficulty(),
                        chore.getEstimatedMinutes(), occurrenceId);
                if (updatePendingAssignees) {
                    jdbc.update("DELETE FROM chore_assignment_assignees WHERE assignment_id=?", occurrenceId);
                    jdbc.update("UPDATE chore_assignments SET assigned_to_user_id=? WHERE id=?",
                            assignees.isEmpty() ? null : assignees.getFirst(), occurrenceId);
                    for (UUID userId : assignees) {
                        jdbc.update("""
                                INSERT INTO chore_assignment_assignees
                                    (household_id, assignment_id, user_id)
                                VALUES (?, ?, ?) ON CONFLICT (assignment_id, user_id) DO NOTHING
                                """, household.getId(), occurrenceId, userId);
                    }
                }
                ensureLegacyAssigneeRelation(occurrenceId, household.getId());
            }
        }
    }

    @Transactional
    public List<AssignmentResponse> myChores(UUID householdId, String status, Authentication authentication) {
        HouseholdMembership actor = requireActiveMember(householdId, authentication);
        generateHousehold(householdId);
        String predicate = switch (status == null ? "UPCOMING" : status) {
            case "UPCOMING" -> "a.status IN ('PENDING','SUBMITTED')";
            case "COMPLETED" -> "a.status='COMPLETED'";
            default -> throw new InvalidHouseholdException("Status must be UPCOMING or COMPLETED.");
        };
        return jdbc.query("""
                SELECT a.id FROM chore_assignments a
                JOIN chore_assignment_assignees aa ON aa.assignment_id=a.id
                WHERE a.household_id=? AND aa.user_id=? AND a.status <> 'CANCELLED'
                  AND %s
                ORDER BY a.scheduled_for, a.due_at NULLS LAST, a.id
                """.formatted(predicate), (rs, row) ->
                assignmentResponse(rs.getObject("id", UUID.class), actor.getUser().getId()), householdId,
                actor.getUser().getId());
    }

    @Transactional
    public DashboardResponse dashboard(UUID householdId, Authentication authentication) {
        HouseholdMembership actor = requireActiveMember(householdId, authentication);
        generateHousehold(householdId);
        ZoneId zone = ZoneId.of(actor.getHousehold().getTimezone());
        LocalDate today = LocalDate.now(zone);
        LocalDate monday = today.with(DayOfWeek.MONDAY);
        LocalDate nextMonday = monday.plusDays(7);
        List<AssignmentResponse> todayAssignments = assignmentList(
                householdId, actor.getUser().getId(), today, today.plusDays(1));
        List<AssignmentResponse> weekAssignments = assignmentList(
                householdId, actor.getUser().getId(), monday, nextMonday);
        long total = jdbc.queryForObject("""
                SELECT COUNT(*) FROM chore_assignments
                WHERE household_id=? AND scheduled_for>=? AND scheduled_for<? AND status<>'CANCELLED'
                """, Long.class, householdId, monday, nextMonday);
        long completed = jdbc.queryForObject("""
                SELECT COUNT(*) FROM chore_assignments
                WHERE household_id=? AND scheduled_for>=? AND scheduled_for<? AND status='COMPLETED'
                """, Long.class, householdId, monday, nextMonday);
        double percentage = total == 0 ? 0 : Math.round(completed * 1000.0 / total) / 10.0;
        return new DashboardResponse(new DashboardResponse.WeekSummary(completed, total, percentage),
                todayAssignments, weekAssignments);
    }

    @Transactional(readOnly = true)
    public List<HouseholdMemberStatsResponse> members(UUID householdId, Authentication authentication) {
        HouseholdMembership actor = requireActiveMember(householdId, authentication);
        ZoneId zone = ZoneId.of(actor.getHousehold().getTimezone());
        LocalDate today = LocalDate.now(zone);
        LocalDate monday = today.with(DayOfWeek.MONDAY);
        LocalDate nextMonday = monday.plusDays(7);
        return jdbc.query("""
                SELECT m.user_id, u.display_name, m.role, m.joined_at,
                    (SELECT COUNT(*) FROM chore_assignment_assignees aa
                     JOIN chore_assignments a ON a.id=aa.assignment_id
                     WHERE aa.household_id=m.household_id AND aa.user_id=m.user_id
                       AND a.scheduled_for>=? AND a.scheduled_for<? AND a.status<>'CANCELLED') assigned_count,
                    (SELECT COUNT(DISTINCT a.id) FROM chore_assignment_assignees aa
                     JOIN chore_assignments a ON a.id=aa.assignment_id
                     JOIN chore_completions cc ON cc.assignment_id=a.id
                     WHERE aa.household_id=m.household_id AND aa.user_id=m.user_id
                        AND a.scheduled_for>=? AND a.scheduled_for<? AND a.status='COMPLETED') completed_count
                FROM household_memberships m JOIN users u ON u.id=m.user_id
                WHERE m.household_id=? AND m.status='ACTIVE'
                ORDER BY m.joined_at, u.display_name
                """, (rs, row) -> new HouseholdMemberStatsResponse(
                rs.getObject("user_id", UUID.class), rs.getString("display_name"),
                HouseholdRole.valueOf(rs.getString("role")),
                rs.getObject("joined_at", OffsetDateTime.class),
                rs.getLong("assigned_count"), rs.getLong("completed_count")),
                monday, nextMonday, monday, nextMonday,
                householdId);
    }

    @Transactional
    public AssignmentResponse complete(UUID householdId, UUID assignmentId, Authentication authentication) {
        HouseholdMembership actor = requireActiveMember(householdId, authentication);
        List<String> rows = jdbc.query(
                "SELECT status FROM chore_assignments WHERE id=? AND household_id=? FOR UPDATE",
                (rs, row) -> rs.getString("status"), assignmentId, householdId);
        if (rows.isEmpty()) {
            throw new ResourceNotFoundException("Assignment was not found in this household.");
        }
        String status = rows.getFirst();
        Boolean assigned = jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM chore_assignment_assignees
                              WHERE assignment_id=? AND household_id=? AND user_id=?)
                """, Boolean.class, assignmentId, householdId, actor.getUser().getId());
        if (!Boolean.TRUE.equals(assigned)) {
            throw new HouseholdAccessDeniedException("Only an assigned household member may complete this chore.");
        }
        if (!"COMPLETED".equals(status)) {
            if (!"PENDING".equals(status) && !"SUBMITTED".equals(status)) {
                throw new InvalidHouseholdException("This assignment cannot be completed.");
            }
            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            Integer attempt = jdbc.queryForObject(
                    "SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM chore_completions WHERE assignment_id=?",
                    Integer.class, assignmentId);
            jdbc.update("""
                    INSERT INTO chore_completions
                        (household_id, assignment_id, attempt_number, completed_by_user_id, completed_at)
                    VALUES (?, ?, ?, ?, ?) ON CONFLICT (assignment_id, attempt_number) DO NOTHING
                    """, householdId, assignmentId, attempt, actor.getUser().getId(), now);
            jdbc.update("UPDATE chore_assignments SET status='COMPLETED', updated_at=NOW() "
                    + "WHERE id=? AND household_id=? AND status IN ('PENDING','SUBMITTED')",
                    assignmentId, householdId);
            cancelPendingNotifications(assignmentId);
            String title = jdbc.queryForObject(
                    "SELECT title_snapshot FROM chore_assignments WHERE id=? AND household_id=?",
                    String.class, assignmentId, householdId);
            List<UUID> recipients = jdbc.query("""
                    SELECT user_id FROM household_memberships
                    WHERE household_id=? AND status='ACTIVE' AND user_id<>?
                    """, (rs, row) -> rs.getObject("user_id", UUID.class),
                    householdId, actor.getUser().getId());
            notificationEventService.publish(new NotificationEvent(
                    "CHORE_COMPLETED",
                    actor.getUser().getId(),
                    householdId,
                    "CHORE_ASSIGNMENT",
                    assignmentId,
                    "CHORE_COMPLETION",
                    java.util.Map.of("chore_name", title),
                    recipients));
        }
        return assignmentResponse(assignmentId, actor.getUser().getId());
    }

    @Transactional
    public void generateHousehold(UUID householdId) {
        for (ChoreSchedule schedule : scheduleRepository.findByHousehold_IdAndActiveTrue(householdId)) {
            synchronizeSchedule(schedule);
        }
    }

    private List<AssignmentResponse> assignmentList(
            UUID householdId, UUID userId, LocalDate from, LocalDate until) {
        List<UUID> ids = jdbc.query("""
                SELECT a.id FROM chore_assignments a
                WHERE a.household_id=? AND a.scheduled_for>=? AND a.scheduled_for<?
                  AND a.status<>'CANCELLED'
                ORDER BY a.scheduled_for, a.due_at NULLS LAST, a.id
                """, (rs, row) -> rs.getObject("id", UUID.class), householdId, from, until);
        return ids.stream().map(id -> assignmentResponse(id, userId)).toList();
    }

    private void cancelPendingNotifications(UUID assignmentId) {
        jdbc.update("""
                UPDATE notifications SET status='CANCELLED'
                WHERE reference_type='CHORE_ASSIGNMENT' AND reference_id=? AND status='PENDING'
                """, assignmentId);
        jdbc.update("""
                UPDATE notification_deliveries d SET status='CANCELLED'
                FROM notifications n
                WHERE d.notification_id=n.id AND n.reference_type='CHORE_ASSIGNMENT'
                  AND n.reference_id=? AND d.status='PENDING'
                """, assignmentId);
    }

    private AssignmentResponse assignmentResponse(UUID id, UUID viewerId) {
        return jdbc.queryForObject("""
                SELECT a.id, a.household_id, a.chore_id, a.scheduled_for, a.due_at, a.status,
                       a.title_snapshot, a.priority_snapshot, a.difficulty_snapshot,
                       a.estimated_minutes_snapshot, c.name category_name, c.icon_key category_icon,
                       cc.completed_at, cu.display_name completed_by
                FROM chore_assignments a
                JOIN chores ch ON ch.id=a.chore_id
                LEFT JOIN chore_categories c ON c.id=ch.category_id
                LEFT JOIN LATERAL (SELECT completed_at, completed_by_user_id
                                   FROM chore_completions WHERE assignment_id=a.id
                                   ORDER BY completed_at DESC LIMIT 1) cc ON TRUE
                LEFT JOIN users cu ON cu.id=cc.completed_by_user_id
                WHERE a.id=?
                """, (rs, row) -> mapAssignment(rs, viewerId), id);
    }

    private AssignmentResponse mapAssignment(ResultSet rs, UUID viewerId) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        UUID householdId = rs.getObject("household_id", UUID.class);
        List<AssigneeResponse> assignees = jdbc.query("""
                SELECT aa.user_id, u.display_name FROM chore_assignment_assignees aa
                JOIN users u ON u.id=aa.user_id
                WHERE aa.assignment_id=? AND aa.household_id=?
                ORDER BY aa.created_at, aa.user_id
                """, (assigneeRs, row) -> new AssigneeResponse(
                assigneeRs.getObject("user_id", UUID.class), assigneeRs.getString("display_name")), id, householdId);
        OffsetDateTime dueAt = rs.getObject("due_at", OffsetDateTime.class);
        String dbStatus = rs.getString("status");
        boolean pending = "PENDING".equals(dbStatus) || "SUBMITTED".equals(dbStatus);
        boolean canComplete = pending && assignees.stream().anyMatch(a -> a.userId().equals(viewerId));
        boolean overdue = pending && dueAt != null && dueAt.isBefore(OffsetDateTime.now());
        return new AssignmentResponse(id, householdId, rs.getObject("chore_id", UUID.class),
                rs.getString("category_name"), rs.getString("category_icon"), rs.getString("title_snapshot"),
                rs.getObject("scheduled_for", LocalDate.class), dueAt,
                "COMPLETED".equals(dbStatus) ? "COMPLETED"
                        : "CANCELLED".equals(dbStatus) ? "CANCELLED" : "PENDING",
                ChorePriority.valueOf(rs.getString("priority_snapshot")), rs.getShort("difficulty_snapshot"),
                (Integer) rs.getObject("estimated_minutes_snapshot"), assignees, canComplete, overdue,
                rs.getObject("completed_at", OffsetDateTime.class), rs.getString("completed_by"));
    }

    private void ensureLegacyAssigneeRelation(UUID assignmentId, UUID householdId) {
        jdbc.update("""
                INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
                SELECT household_id, id, assigned_to_user_id FROM chore_assignments
                WHERE id=? AND household_id=? AND assigned_to_user_id IS NOT NULL
                ON CONFLICT (assignment_id, user_id) DO NOTHING
                """, assignmentId, householdId);
    }

    private String status(UUID occurrenceId) {
        return jdbc.queryForObject("SELECT status FROM chore_assignments WHERE id=?", String.class, occurrenceId);
    }

    private List<UUID> selectedAssignees(ChoreSchedule schedule, LocalDate date) {
        int needed = peopleNeeded(schedule);
        List<UUID> pool = new ArrayList<>(participantIds(schedule));
        if (schedule.getAssignmentStrategy() == AssignmentStrategy.FIXED) {
            if (pool.isEmpty() && schedule.getFixedAssignee() != null) {
                pool = List.of(schedule.getFixedAssignee().getId());
            }
            return pool.subList(0, Math.min(needed, pool.size()));
        }
        if (schedule.getAssignmentStrategy() == AssignmentStrategy.RANDOM) {
            Collections.shuffle(pool, RANDOM);
            return List.copyOf(pool.subList(0, needed));
        }
        if (schedule.getAssignmentStrategy() == AssignmentStrategy.ROUND_ROBIN) {
            List<UUID> rotationPool = pool;
            List<Integer> counts = jdbc.query("""
                    SELECT aa.user_id, COUNT(*) AS n
                    FROM chore_assignment_assignees aa
                    JOIN chore_assignments a ON a.id=aa.assignment_id
                    WHERE a.schedule_id=? AND a.scheduled_for<? AND a.status<>'CANCELLED'
                    GROUP BY aa.user_id
                    """, rs -> {
                Map<UUID, Integer> values = new java.util.HashMap<>();
                while (rs.next()) {
                    values.put(rs.getObject("user_id", UUID.class), rs.getInt("n"));
                }
                return rotationPool.stream().map(userId -> values.getOrDefault(userId, 0)).toList();
            }, schedule.getId(), date);
            Map<String, Integer> pairCounts = jdbc.query("""
                    SELECT aa.user_id AS left_id, bb.user_id AS right_id, COUNT(*) AS n
                    FROM chore_assignment_assignees aa
                    JOIN chore_assignment_assignees bb
                      ON bb.assignment_id=aa.assignment_id AND aa.user_id<bb.user_id
                    JOIN chore_assignments a ON a.id=aa.assignment_id
                    WHERE a.schedule_id=? AND a.scheduled_for<? AND a.status<>'CANCELLED'
                    GROUP BY aa.user_id, bb.user_id
                    """, rs -> {
                Map<String, Integer> values = new java.util.HashMap<>();
                while (rs.next()) {
                    values.put(pairKey(rs.getObject("left_id", UUID.class),
                            rs.getObject("right_id", UUID.class)), rs.getInt("n"));
                }
                return values;
            }, schedule.getId(), date);
            return rotate(pool, needed, occurrenceIndex(schedule, date), counts, pairCounts);
        }
        return List.of();
    }

    static List<UUID> rotate(List<UUID> pool, int peopleNeeded, int occurrenceIndex) {
        return rotate(pool, peopleNeeded, occurrenceIndex,
                Collections.nCopies(pool.size(), 0), Map.of());
    }

    static List<UUID> rotate(
            List<UUID> pool, int peopleNeeded, int occurrenceIndex,
            List<Integer> priorCounts, Map<String, Integer> priorPairCounts) {
        List<UUID> selected = new ArrayList<>(peopleNeeded);
        for (int i = 0; i < peopleNeeded; i++) {
            UUID best = null;
            int bestCount = Integer.MAX_VALUE;
            int bestPairCount = Integer.MAX_VALUE;
            int bestRank = Integer.MAX_VALUE;
            for (int offset = 0; offset < pool.size(); offset++) {
                UUID candidate = pool.get(Math.floorMod(occurrenceIndex + offset, pool.size()));
                if (selected.contains(candidate)) {
                    continue;
                }
                int count = priorCounts.get(pool.indexOf(candidate));
                int pairCount = selected.stream()
                        .mapToInt(selectedUser -> priorPairCounts.getOrDefault(pairKey(candidate, selectedUser), 0))
                        .sum();
                if (count < bestCount || (count == bestCount && pairCount < bestPairCount)) {
                    best = candidate;
                    bestCount = count;
                    bestPairCount = pairCount;
                    bestRank = offset;
                } else if (count == bestCount && pairCount == bestPairCount && offset < bestRank) {
                    best = candidate;
                    bestRank = offset;
                }
            }
            selected.add(best);
        }
        return List.copyOf(selected);
    }

    static String pairKey(UUID first, UUID second) {
        return first.compareTo(second) < 0 ? first + ":" + second : second + ":" + first;
    }

    static OffsetDateTime dueAt(LocalDate date, java.time.LocalTime time, ZoneId zone) {
        return date.atTime(time).atZone(zone).toOffsetDateTime();
    }

    private int occurrenceIndex(ChoreSchedule schedule, LocalDate target) {
        int index = 0;
        for (LocalDate day = schedule.getStartsOn(); day.isBefore(target); day = day.plusDays(1)) {
            if (occurs(schedule.getRecurrenceRule(), schedule.getStartsOn(), day)) {
                index++;
            }
        }
        return index;
    }

    static boolean occurs(String rule, LocalDate startsOn, LocalDate date) {
        if (date.isBefore(startsOn)) {
            return false;
        }
        if ("FREQ=ONCE".equals(rule)) {
            return date.equals(startsOn);
        }
        if ("FREQ=DAILY".equals(rule)) {
            return true;
        }
        String[] fields = rule.split(";");
        int interval = 1;
        Set<DayOfWeek> days = new HashSet<>();
        for (String field : fields) {
            if (field.startsWith("INTERVAL=")) {
                interval = Integer.parseInt(field.substring("INTERVAL=".length()));
            } else if (field.startsWith("BYDAY=")) {
                for (String value : field.substring("BYDAY=".length()).split(",")) {
                    days.add(switch (value) {
                        case "MO" -> DayOfWeek.MONDAY;
                        case "TU" -> DayOfWeek.TUESDAY;
                        case "WE" -> DayOfWeek.WEDNESDAY;
                        case "TH" -> DayOfWeek.THURSDAY;
                        case "FR" -> DayOfWeek.FRIDAY;
                        case "SA" -> DayOfWeek.SATURDAY;
                        case "SU" -> DayOfWeek.SUNDAY;
                        default -> throw new IllegalArgumentException("Unsupported recurrence day.");
                    });
                }
            }
        }
        long weeks = ChronoUnit.WEEKS.between(startsOn.with(DayOfWeek.MONDAY), date.with(DayOfWeek.MONDAY));
        return weeks % interval == 0 && days.contains(date.getDayOfWeek());
    }

    private List<UUID> participantIds(ChoreSchedule schedule) {
        Object value = schedule.getStrategyConfig() == null
                ? null : schedule.getStrategyConfig().get("participantUserIds");
        if (value instanceof List<?> ids) {
            return ids.stream().map(Object::toString).map(UUID::fromString).toList();
        }
        return schedule.getFixedAssignee() == null ? new ArrayList<>()
                : new ArrayList<>(List.of(schedule.getFixedAssignee().getId()));
    }

    private int peopleNeeded(ChoreSchedule schedule) {
        Object value = schedule.getStrategyConfig() == null
                ? null : schedule.getStrategyConfig().get("peopleNeeded");
        if (value instanceof Number number) {
            return Math.max(1, number.intValue());
        }
        return 1;
    }

    private HouseholdMembership requireActiveMember(UUID householdId, Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new HouseholdAccessDeniedException("You are not authorized to view household chores.");
        }
        User user = userRepository.findByEmailIgnoreCase(authentication.getName())
                .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not authorized to view household chores."));
        return membershipRepository.findByHousehold_IdAndUser_Id(householdId, user.getId())
                .filter(membership -> membership.getStatus() == MembershipStatus.ACTIVE)
                .orElseThrow(() -> new HouseholdAccessDeniedException("You are not an ACTIVE household member."));
    }

    private record FutureOccurrence(UUID id, LocalDate scheduledFor) {}
}
