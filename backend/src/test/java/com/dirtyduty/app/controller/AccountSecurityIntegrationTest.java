package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class AccountSecurityIntegrationTest {
    private static final String PASSWORD = "StrongPassword123!";
    private final List<UUID> testUserIds = new ArrayList<>();
    private final List<UUID> householdIds = new ArrayList<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AuthService authService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbc;

    @AfterEach
    void cleanAccountSecurityFixtures() {
        for (UUID householdId : householdIds) {
            jdbc.update("DELETE FROM notifications WHERE event_id IN (SELECT id FROM notification_events WHERE household_id=?)", householdId);
            jdbc.update("DELETE FROM notification_events WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM activity_events WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM chore_completions WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM chore_assignment_assignees WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM chore_assignments WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM chore_schedules WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM chores WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM chore_categories WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM household_invitations WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM household_memberships WHERE household_id=?", householdId);
            jdbc.update("DELETE FROM households WHERE id=?", householdId);
        }

        for (UUID userId : testUserIds) {
            userRepository.findById(userId).ifPresent(user -> {
                jdbc.update("DELETE FROM spring_session_attributes WHERE session_primary_id IN (SELECT primary_id FROM spring_session WHERE principal_name=?)", user.getEmail());
                jdbc.update("DELETE FROM spring_session WHERE principal_name=?", user.getEmail());
                jdbc.update("DELETE FROM notifications WHERE recipient_user_id=?", userId);
                jdbc.update("DELETE FROM notification_preferences WHERE user_id=?", userId);
                jdbc.update("DELETE FROM push_subscriptions WHERE user_id=?", userId);
                jdbc.update("DELETE FROM notification_events WHERE actor_user_id=?", userId);
                userRepository.delete(user);
            });
        }
        testUserIds.clear();
        householdIds.clear();
    }

    @Test
    void memberAndAdminCanDeleteAfterTheirMembershipsAreLeft() throws Exception {
        for (String role : List.of("MEMBER", "ADMIN")) {
            User owner = createUser("owner-" + role);
            User exitingUser = createUser("exiting-" + role);
            UUID householdId = createHousehold(owner, "Shared " + role);
            addMembership(householdId, exitingUser, role);
            WebSession session = login(exitingUser.getEmail(), PASSWORD);

            deleteAccount(session, PASSWORD, exitingUser.getEmail())
                    .andExpect(status().isNoContent());

            assertThat(jdbc.queryForObject("""
                    SELECT status FROM household_memberships WHERE household_id=? AND user_id=?
                    """, String.class, householdId, exitingUser.getId())).isEqualTo("LEFT");
            assertThat(jdbc.queryForObject("""
                    SELECT role FROM household_memberships WHERE household_id=? AND user_id=?
                    """, String.class, householdId, exitingUser.getId())).isEqualTo("MEMBER");
            assertThat(jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, exitingUser.getId()))
                    .isEqualTo("DELETED");
            mockMvc.perform(get("/api/auth/me").cookie(session.cookie()))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void activeOwnerCannotDeleteAndConflictListsOwnedHousehold() throws Exception {
        User owner = createUser("owner-blocked");
        UUID householdId = createHousehold(owner, "Owned home");
        WebSession session = login(owner.getEmail(), PASSWORD);

        deleteAccount(session, PASSWORD, owner.getEmail())
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("You still own households."))
                .andExpect(jsonPath("$.ownedHouseholds[0].id").value(householdId.toString()))
                .andExpect(jsonPath("$.ownedHouseholds[0].name").value("Owned home"));

        assertThat(jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, owner.getId()))
                .isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("""
                SELECT status FROM household_memberships WHERE household_id=? AND user_id=?
                """, String.class, householdId, owner.getId())).isEqualTo("ACTIVE");
    }

    @Test
    void transferredOwnerCanDeleteAndLeavesMembershipSafely() throws Exception {
        User owner = createUser("transferor");
        User successor = createUser("successor");
        UUID householdId = createHousehold(owner, "Transfer home");
        addMembership(householdId, successor, "MEMBER");
        WebSession ownerSession = login(owner.getEmail(), PASSWORD);

        performPost(ownerSession, "/api/households/" + householdId + "/members/" + successor.getId() + "/transfer-ownership", "")
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("""
                SELECT role FROM household_memberships WHERE household_id=? AND user_id=? AND status='ACTIVE'
                """, String.class, householdId, successor.getId())).isEqualTo("OWNER");

        deleteAccount(ownerSession, PASSWORD, owner.getEmail())
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("""
                SELECT status FROM household_memberships WHERE household_id=? AND user_id=?
                """, String.class, householdId, owner.getId())).isEqualTo("LEFT");
        assertThat(jdbc.queryForObject("""
                SELECT role FROM household_memberships WHERE household_id=? AND user_id=? AND status='ACTIVE'
                """, String.class, householdId, successor.getId())).isEqualTo("OWNER");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM households WHERE id=?", Integer.class, householdId)).isEqualTo(1);
    }

    @Test
    void deletionCleansSubscriptionsPreferencesFutureWorkAndSessionsButPreservesHistory() throws Exception {
        User owner = createUser("history-owner");
        User member = createUser("history-member");
        UUID householdId = createHousehold(owner, "History home");
        addMembership(householdId, member, "MEMBER");
        UUID choreId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
                VALUES (?, ?, 'Test chore', 'NORMAL', 1, ?)
                """, choreId, householdId, member.getId());

        UUID futureAssignmentId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, assigned_to_user_id, scheduled_for, status,
                     title_snapshot, priority_snapshot, difficulty_snapshot)
                VALUES (?, ?, ?, ?, ?, 'PENDING', 'Future chore', 'NORMAL', 1)
                """, futureAssignmentId, householdId, choreId, member.getId(), LocalDate.now().plusDays(2));

        UUID historicalAssignmentId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, assigned_to_user_id, scheduled_for, status,
                     title_snapshot, priority_snapshot, difficulty_snapshot)
                VALUES (?, ?, ?, ?, ?, 'COMPLETED', 'Past chore', 'NORMAL', 1)
                """, historicalAssignmentId, householdId, choreId, member.getId(), LocalDate.now().minusDays(2));
        jdbc.update("""
                INSERT INTO chore_completions (household_id, assignment_id, completed_by_user_id, completed_at)
                VALUES (?, ?, ?, ?)
                """, householdId, historicalAssignmentId, member.getId(), OffsetDateTime.now(ZoneOffset.UTC).minusDays(2));

        addCleanupSchedules(householdId, choreId, member.getId());
        addUserNotificationsAndPreferences(member.getId());
        String endpoint = "https://push.example.test/" + UUID.randomUUID();
        addPushSubscription(member.getId(), endpoint);

        WebSession firstSession = login(member.getEmail(), PASSWORD);
        login(member.getEmail(), PASSWORD);

        deleteAccount(firstSession, PASSWORD, member.getEmail())
                .andExpect(status().isNoContent());

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM spring_session WHERE principal_name=?", Integer.class, member.getEmail()))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?", Integer.class, member.getId()))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notification_preferences WHERE user_id=?", Integer.class, member.getId()))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE recipient_user_id=?", Integer.class, member.getId()))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM chore_assignments WHERE id=?", String.class, futureAssignmentId))
                .isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM chore_completions WHERE assignment_id=?", Integer.class, historicalAssignmentId))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM household_memberships WHERE household_id=? AND user_id=?", String.class, householdId, member.getId()))
                .isEqualTo("LEFT");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM chore_schedules WHERE household_id=? AND is_active=TRUE", Integer.class, householdId))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM households WHERE id=?", Integer.class, householdId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, owner.getId())).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint=?", Integer.class, endpoint))
                .isZero();
    }

    @Test
    void emailCanBeReusedByANewAccountWithoutInheritingOldMemberships() throws Exception {
        User owner = createUser("reuse-owner");
        User deletedUser = createUser("reuse-target");
        UUID householdId = createHousehold(owner, "Old household history");
        addMembership(householdId, deletedUser, "MEMBER");
        WebSession session = login(deletedUser.getEmail(), PASSWORD);

        deleteAccount(session, PASSWORD, deletedUser.getEmail()).andExpect(status().isNoContent());

        User replacement = createUserWithEmail(deletedUser.getEmail(), "Replacement User");
        assertThat(replacement.getId()).isNotEqualTo(deletedUser.getId());
        assertThat(jdbc.queryForObject("""
                SELECT status FROM household_memberships WHERE household_id=? AND user_id=?
                """, String.class, householdId, deletedUser.getId())).isEqualTo("LEFT");
        assertThat(jdbc.queryForObject("""
                SELECT COUNT(*) FROM household_memberships WHERE user_id=?
                """, Integer.class, replacement.getId())).isZero();

        WebSession replacementSession = login(replacement.getEmail(), PASSWORD);
        mockMvc.perform(get("/api/households").cookie(replacementSession.cookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void wrongPasswordAndWrongEmailCannotDeleteAccount() throws Exception {
        User user = createUser("wrong-confirmation");
        WebSession session = login(user.getEmail(), PASSWORD);

        deleteAccount(session, "WrongPassword123!", user.getEmail()).andExpect(status().isBadRequest());
        deleteAccount(session, PASSWORD, "someone-else@example.com").andExpect(status().isBadRequest());

        assertThat(jdbc.queryForObject("SELECT account_status FROM users WHERE id=?", String.class, user.getId()))
                .isEqualTo("ACTIVE");
    }

    private User createUser(String localPart) {
        return createUserWithEmail(localPart + "-" + UUID.randomUUID() + "@example.com", "Test User");
    }

    private User createUserWithEmail(String email, String displayName) {
        var response = authService.register(new RegisterRequest(displayName, email, PASSWORD));
        testUserIds.add(response.userId());
        return userRepository.findById(response.userId()).orElseThrow();
    }

    private UUID createHousehold(User owner, String name) {
        UUID householdId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO households (id, name, timezone, created_by_user_id)
                VALUES (?, ?, 'UTC', ?)
                """, householdId, name, owner.getId());
        jdbc.update("""
                INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
                VALUES (?, ?, 'OWNER', 'ACTIVE', NOW())
                """, householdId, owner.getId());
        householdIds.add(householdId);
        return householdId;
    }

    private void addMembership(UUID householdId, User user, String role) {
        jdbc.update("""
                INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
                VALUES (?, ?, ?, 'ACTIVE', NOW())
                """, householdId, user.getId(), role);
    }

    private void addCleanupSchedules(UUID householdId, UUID choreId, UUID userId) {
        jdbc.update("""
                INSERT INTO chore_schedules
                    (household_id, chore_id, recurrence_rule, timezone, starts_on,
                     assignment_strategy, fixed_assignee_user_id, strategy_config)
                VALUES (?, ?, 'FREQ=DAILY', 'UTC', CURRENT_DATE, 'FIXED', ?, '{}'::jsonb)
                """, householdId, choreId, userId);
        String participants = "{\"participantUserIds\":[\"" + userId + "\"],\"peopleNeeded\":1}";
        for (String strategy : List.of("ROUND_ROBIN", "RANDOM")) {
            jdbc.update("""
                    INSERT INTO chore_schedules
                        (household_id, chore_id, recurrence_rule, timezone, starts_on,
                         assignment_strategy, strategy_config)
                    VALUES (?, ?, 'FREQ=DAILY', 'UTC', CURRENT_DATE, ?, CAST(? AS jsonb))
                    """, householdId, choreId, strategy, participants);
        }
    }

    private void addUserNotificationsAndPreferences(UUID userId) {
        jdbc.update("INSERT INTO notification_preferences (user_id) VALUES (?)", userId);
        jdbc.update("""
                INSERT INTO notifications
                    (recipient_user_id, type, category, title, message, status, scheduled_at, deduplication_key)
                VALUES (?, 'CHORE_DUE_SOON', 'CHORE', 'Reminder', 'Upcoming chore', 'PENDING', NOW() + INTERVAL '1 day', ?)
                """, userId, "account-delete-" + UUID.randomUUID());
    }

    private void addPushSubscription(UUID userId, String endpoint) {
        jdbc.update("""
                INSERT INTO push_subscriptions (user_id, endpoint, public_key, auth_secret)
                VALUES (?, ?, ?, ?)
                """, userId, endpoint,
                Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[65]),
                Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]));
    }

    private WebSession login(String email, String password) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        CsrfResponse csrfResponse = objectMapper.readValue(csrf.getResponse().getContentAsString(), CsrfResponse.class);
        MvcResult login = mockMvc.perform(post("/api/auth/login")
                .cookie(csrf.getResponse().getCookie("SESSION"))
                .header(csrfResponse.headerName(), csrfResponse.token())
                .contentType(APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        return new WebSession(login.getResponse().getCookie("SESSION"));
    }

    private org.springframework.test.web.servlet.ResultActions deleteAccount(
            WebSession session, String password, String email) throws Exception {
        return performPost(session, "/api/auth/delete-account",
                "{\"password\":\"" + password + "\",\"email\":\"" + email + "\"}");
    }

    private org.springframework.test.web.servlet.ResultActions performPost(WebSession session, String path, String body)
            throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf").cookie(session.cookie())).andReturn();
        CsrfResponse csrfResponse = objectMapper.readValue(csrf.getResponse().getContentAsString(), CsrfResponse.class);
        return mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                .cookie(session.cookie())
                .header(csrfResponse.headerName(), csrfResponse.token())
                .contentType(APPLICATION_JSON)
                .content(body));
    }

    private record WebSession(Cookie cookie) {}
}
