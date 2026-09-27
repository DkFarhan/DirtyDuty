package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class HouseholdControllerIntegrationTest {

    private static final String PASSWORD = "StrongPassword123!";
    private static final String INVALID_INVITE_MESSAGE = "Invite code is invalid or no longer available.";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AuthService authService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoSpyBean
    private HouseholdMembershipRepository householdMembershipRepository;

    private final AtomicBoolean failOwnerMembershipSave = new AtomicBoolean();

    @BeforeEach
    void cleanBefore() {
        failOwnerMembershipSave.set(false);
        clearHouseholdData();
    }

    @AfterEach
    void cleanAfter() {
        failOwnerMembershipSave.set(false);
        clearHouseholdData();
    }

    @Test
    void authenticatedUserCanCreateHouseholdAndReceivesOnlySafeData() throws Exception {
        WebSession owner = login("creator");
        WebSession spoofedUser = login("spoofed");
        String json = """
                {
                  "name": "  Our Apartment  ",
                  "timezone": " America/Halifax ",
                  "createdByUserId": "%s",
                  "ownerId": "%s",
                  "role": "ADMIN",
                  "status": "REMOVED"
                }
                """.formatted(spoofedUser.userId(), spoofedUser.userId());

        MvcResult result = mockMvc.perform(post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(json))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Our Apartment"))
                .andExpect(jsonPath("$.timezone").value("America/Halifax"))
                .andExpect(jsonPath("$.currentUserRole").value("OWNER"))
                .andExpect(jsonPath("$.createdByUserId").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andExpect(jsonPath("$.inviteCode").doesNotExist())
                .andReturn();

        UUID householdId = UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString())
                .get("id").asText());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT created_by_user_id FROM households WHERE id = ?",
                UUID.class,
                householdId)).isEqualTo(UUID.fromString(owner.userId()));
        assertThat(jdbcTemplate.queryForMap("""
                SELECT role, status, joined_at
                FROM household_memberships
                WHERE household_id = ? AND user_id = ?
                """, householdId, UUID.fromString(owner.userId())))
                .containsEntry("role", "OWNER")
                .containsEntry("status", "ACTIVE")
                .containsKey("joined_at");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(spoofedUser.userId()))).isZero();
    }

    @Test
    void createRequiresAuthenticationAndCsrfAndValidInput() throws Exception {
        MvcResult anonymousCsrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        CsrfResponse anonymousToken = readCsrf(anonymousCsrf);
        mockMvc.perform(post("/api/households")
                .cookie(anonymousCsrf.getResponse().getCookie("SESSION"))
                .header(anonymousToken.headerName(), anonymousToken.token())
                .contentType(APPLICATION_JSON)
                .content(validHouseholdJson()))
                .andExpect(status().isUnauthorized());

        WebSession owner = login("csrf-required");
        mockMvc.perform(post("/api/households")
                .cookie(owner.cookie())
                .contentType(APPLICATION_JSON)
                .content(validHouseholdJson()))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("""
                        {"name":"  ", "timezone":"America/Halifax"}
                        """))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("""
                        {"name":"A", "timezone":"America/Halifax"}
                        """))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("""
                        {"name":"Valid Name", "timezone":"Mars/Olympus"}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("A valid IANA timezone is required."));
        assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM households", Integer.class)).isZero();
    }

    @Test
    void householdCreationRollsBackIfOwnerMembershipPersistenceFails() throws Exception {
        WebSession owner = login("rollback-owner");
        doAnswer(invocation -> {
            HouseholdMembership membership = invocation.getArgument(0);
            if (failOwnerMembershipSave.get() && membership.getRole() == HouseholdRole.OWNER) {
                throw new DataIntegrityViolationException("internal database detail");
            }
            return invocation.callRealMethod();
        }).when(householdMembershipRepository).save(any(HouseholdMembership.class));
        failOwnerMembershipSave.set(true);

        mockMvc.perform(post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(validHouseholdJson()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("The request conflicts with existing data."));

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM households WHERE created_by_user_id = ?",
                Integer.class,
                UUID.fromString(owner.userId()))).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE user_id = ?",
                Integer.class,
                UUID.fromString(owner.userId()))).isZero();
    }

    @Test
    void householdListContainsOnlyCurrentUsersActiveMemberships() throws Exception {
        WebSession userA = login("list-a");
        WebSession userB = login("list-b");
        createHousehold(userA, "A household", "UTC");
        createHousehold(userB, "B household", "UTC");

        mockMvc.perform(get("/api/households").cookie(userA.cookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("A household"));

        UUID userAId = UUID.fromString(userA.userId());
        jdbcTemplate.update("UPDATE household_memberships SET status = 'LEFT' WHERE user_id = ?", userAId);
        mockMvc.perform(get("/api/households").cookie(userA.cookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        mockMvc.perform(get("/api/households"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void ownerAndAdminCanCreateHashedMemberInvitationsButMemberAndNonmemberCannot() throws Exception {
        WebSession owner = login("invite-owner");
        WebSession admin = login("invite-admin");
        WebSession member = login("invite-member");
        WebSession stranger = login("invite-stranger");
        UUID householdId = createHousehold(owner, "Invite Home", "UTC");
        String ownerInvite = createInvitation(owner, householdId);
        join(member, ownerInvite).andExpect(status().isOk());

        mockMvc.perform(post(invitationPath(householdId))
                .cookie(member.cookie())
                .header(member.csrfHeader(), member.csrfToken()))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(invitationPath(householdId))
                .cookie(stranger.cookie())
                .header(stranger.csrfHeader(), stranger.csrfToken()))
                .andExpect(status().isForbidden());

        jdbcTemplate.update("""
                INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
                VALUES (?, ?, 'ADMIN', 'ACTIVE', NOW())
                """, householdId, UUID.fromString(admin.userId()));
        String adminInvite = createInvitation(admin, householdId);
        assertInvitationStoredAsHash(adminInvite, householdId);
    }

    @Test
    void invitationUsesHighEntropyRandomTokenHashAndConfiguredExpiry() throws Exception {
        WebSession owner = login("invite-design");
        UUID householdId = createHousehold(owner, "Invite Design", "UTC");
        OffsetDateTime beforeCreate = OffsetDateTime.now();
        String rawCode = createInvitation(owner, householdId);
        OffsetDateTime afterCreate = OffsetDateTime.now();

        assertThat(rawCode).hasSize(43);
        assertThat(java.util.Base64.getUrlDecoder().decode(rawCode)).hasSize(32);
        assertInvitationStoredAsHash(rawCode, householdId);
        var row = jdbcTemplate.queryForMap(
                "SELECT role_to_assign, expires_at, used_at, revoked_at FROM household_invitations WHERE household_id = ?",
                householdId);
        assertThat(row.get("role_to_assign")).isEqualTo("MEMBER");
        OffsetDateTime expiresAt = ((java.sql.Timestamp) row.get("expires_at")).toInstant().atOffset(java.time.ZoneOffset.UTC);
        assertThat(expiresAt).isBetween(beforeCreate.plusDays(7), afterCreate.plusDays(7));
        assertThat(row.get("used_at")).isNull();
        assertThat(row.get("revoked_at")).isNull();
    }

    @Test
    void joinActivatesOneMemberAndConsumesInvitationWithoutAcceptingPrivilegeInput() throws Exception {
        WebSession owner = login("join-owner");
        WebSession member = login("join-member");
        UUID householdId = createHousehold(owner, "Join Home", "UTC");
        String code = createInvitation(owner, householdId);

        MvcResult result = join(member, code, """
                {"inviteCode":"  %s  ","role":"OWNER","roleToAssign":"ADMIN","userId":"%s","householdId":"%s"}
                """.formatted(code, owner.userId(), UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentUserRole").value("MEMBER"))
                .andReturn();
        assertThat(objectMapper.readTree(result.getResponse().getContentAsString()).get("name").asText())
                .isEqualTo("Join Home");
        assertMembership(member, householdId, "MEMBER", "ACTIVE");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT used_at FROM household_invitations WHERE household_id = ?",
                java.sql.Timestamp.class,
                householdId)).isNotNull();
    }

    @Test
    void joinRejectsUnknownExpiredRevokedAndUsedCodesWithSameSafeMessage() throws Exception {
        WebSession owner = login("invalid-code-owner");
        WebSession member = login("invalid-code-member");
        UUID householdId = createHousehold(owner, "Invalid Code Home", "UTC");
        String expiredCode = createInvitation(owner, householdId);
        String revokedCode = createInvitation(owner, householdId);
        String usedCode = createInvitation(owner, householdId);
        jdbcTemplate.update("UPDATE household_invitations SET expires_at = NOW() - INTERVAL '1 second' WHERE invite_code = ?",
                hash(expiredCode));
        jdbcTemplate.update("UPDATE household_invitations SET revoked_at = NOW() WHERE invite_code = ?", hash(revokedCode));
        join(member, usedCode).andExpect(status().isOk());

        for (String code : new String[] { "unknown-code", expiredCode, revokedCode, usedCode }) {
            mockMvc.perform(post("/api/households/join")
                    .cookie(member.cookie())
                    .header(member.csrfHeader(), member.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content("{\"inviteCode\":\"" + code + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value(INVALID_INVITE_MESSAGE));
        }
    }

    @Test
    void activeMembershipConflictDoesNotConsumeInviteAndLeftOrInvitedMembershipReactivates() throws Exception {
        WebSession owner = login("reactivate-owner");
        WebSession member = login("reactivate-member");
        WebSession invitedUser = login("reactivate-invited");
        UUID householdId = createHousehold(owner, "Reactivate Home", "UTC");
        String activeConflictInvite = createInvitation(owner, householdId);
        join(owner, activeConflictInvite).andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("You are already a member of this household."));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT used_at FROM household_invitations WHERE invite_code = ?",
                java.sql.Timestamp.class,
                hash(activeConflictInvite))).isNull();

        jdbcTemplate.update("""
                INSERT INTO household_memberships (household_id, user_id, role, status, joined_at, left_at)
                VALUES (?, ?, 'ADMIN', 'LEFT', NOW() - INTERVAL '1 day', NOW())
                """, householdId, UUID.fromString(member.userId()));
        String leftInvite = createInvitation(owner, householdId);
        join(member, leftInvite).andExpect(status().isOk())
                .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
        assertMembership(member, householdId, "MEMBER", "ACTIVE");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(member.userId()))).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT left_at FROM household_memberships WHERE household_id = ? AND user_id = ?",
                java.sql.Timestamp.class,
                householdId,
                UUID.fromString(member.userId()))).isNull();

        jdbcTemplate.update("""
                INSERT INTO household_memberships (household_id, user_id, role, status)
                VALUES (?, ?, 'ADMIN', 'INVITED')
                """, householdId, UUID.fromString(invitedUser.userId()));
        String invitedMembershipCode = createInvitation(owner, householdId);
        join(invitedUser, invitedMembershipCode).andExpect(status().isOk())
                .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
        assertMembership(invitedUser, householdId, "MEMBER", "ACTIVE");
    }

    @Test
    void removedMembershipCannotReactivateAndInvitationRemainsUnused() throws Exception {
        WebSession owner = login("removed-owner");
        WebSession removedUser = login("removed-user");
        UUID householdId = createHousehold(owner, "Removed Home", "UTC");
        jdbcTemplate.update("""
                INSERT INTO household_memberships (household_id, user_id, role, status)
                VALUES (?, ?, 'MEMBER', 'REMOVED')
                """, householdId, UUID.fromString(removedUser.userId()));
        String code = createInvitation(owner, householdId);

        join(removedUser, code).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Unable to join this household."));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT used_at FROM household_invitations WHERE invite_code = ?",
                java.sql.Timestamp.class,
                hash(code))).isNull();
    }

    @Test
    void simultaneousRedemptionAllowsOnlyOneUserToJoin() throws Exception {
        WebSession owner = login("race-owner");
        WebSession memberA = login("race-member-a");
        WebSession memberB = login("race-member-b");
        UUID householdId = createHousehold(owner, "Race Home", "UTC");
        String code = createInvitation(owner, householdId);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        CompletableFuture<Integer> resultA = redeemConcurrently(memberA, code, ready, start);
        CompletableFuture<Integer> resultB = redeemConcurrently(memberB, code, ready, start);
        assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
        start.countDown();
        int statusA = resultA.get(30, TimeUnit.SECONDS);
        int statusB = resultB.get(30, TimeUnit.SECONDS);

        assertThat(java.util.List.of(statusA, statusB)).containsExactlyInAnyOrder(200, 400);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND role = 'MEMBER' AND status = 'ACTIVE'",
                Integer.class,
                householdId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_invitations WHERE household_id = ? AND used_at IS NOT NULL",
                Integer.class,
                householdId)).isEqualTo(1);
    }

    private CompletableFuture<Integer> redeemConcurrently(
            WebSession session,
            String code,
            CountDownLatch ready,
            CountDownLatch start) {
        return CompletableFuture.supplyAsync(() -> {
            ready.countDown();
            try {
                if (!start.await(10, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Concurrent redemption test was not started.");
                }
                return mockMvc.perform(post("/api/households/join")
                        .cookie(session.cookie())
                        .header(session.csrfHeader(), session.csrfToken())
                        .contentType(APPLICATION_JSON)
                        .content("{\"inviteCode\":\"" + code + "\"}"))
                        .andReturn().getResponse().getStatus();
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        });
    }

    private UUID createHousehold(WebSession session, String name, String timezone) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/households")
                .cookie(session.cookie())
                .header(session.csrfHeader(), session.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("{\"name\":\"" + name + "\",\"timezone\":\"" + timezone + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText());
    }

    private String createInvitation(WebSession session, UUID householdId) throws Exception {
        MvcResult result = mockMvc.perform(post(invitationPath(householdId))
                .cookie(session.cookie())
                .header(session.csrfHeader(), session.csrfToken()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.expiresAt").isString())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("inviteCode").asText();
    }

    private org.springframework.test.web.servlet.ResultActions join(WebSession session, String code) throws Exception {
        return join(session, code, "{\"inviteCode\":\"" + code + "\"}");
    }

    private org.springframework.test.web.servlet.ResultActions join(
            WebSession session,
            String code,
            String requestBody) throws Exception {
        return mockMvc.perform(post("/api/households/join")
                .cookie(session.cookie())
                .header(session.csrfHeader(), session.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(requestBody));
    }

    private WebSession login(String prefix) throws Exception {
        String emailPrefix = prefix.substring(0, Math.min(prefix.length(), 8))
                .replaceAll("[^a-zA-Z0-9]", "")
                .toLowerCase(java.util.Locale.ROOT);
        String email = "hhtest-" + emailPrefix + "-" + UUID.randomUUID() + "@example.com";
        authService.register(new RegisterRequest("Test User", email, PASSWORD));
        User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();

        MvcResult initialCsrfResult = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        CsrfResponse initialCsrf = readCsrf(initialCsrfResult);
        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                .cookie(initialCsrfResult.getResponse().getCookie("SESSION"))
                .header(initialCsrf.headerName(), initialCsrf.token())
                .contentType(APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andReturn();
        assertThat(loginResult.getResponse().getStatus())
                .as("login response: %s", loginResult.getResponse().getContentAsString())
                .isEqualTo(200);
        Cookie cookie = loginResult.getResponse().getCookie("SESSION");
        MvcResult authenticatedCsrfResult = mockMvc.perform(get("/api/auth/csrf").cookie(cookie)).andReturn();
        CsrfResponse csrf = readCsrf(authenticatedCsrfResult);
        return new WebSession(cookie, csrf.headerName(), csrf.token(), user.getId().toString());
    }

    private CsrfResponse readCsrf(MvcResult result) throws Exception {
        return objectMapper.readValue(result.getResponse().getContentAsString(), CsrfResponse.class);
    }

    private void assertMembership(WebSession session, UUID householdId, String role, String membershipStatus) {
        assertThat(jdbcTemplate.queryForMap("""
                SELECT role, status, joined_at
                FROM household_memberships
                WHERE household_id = ? AND user_id = ?
                """, householdId, UUID.fromString(session.userId())))
                .containsEntry("role", role)
                .containsEntry("status", membershipStatus)
                .containsKey("joined_at");
    }

    private void assertInvitationStoredAsHash(String rawCode, UUID householdId) throws Exception {
        String storedHash = jdbcTemplate.queryForObject(
                "SELECT invite_code FROM household_invitations WHERE household_id = ? ORDER BY created_at DESC LIMIT 1",
                String.class,
                householdId);
        assertThat(storedHash).hasSize(64).isEqualTo(hash(rawCode)).isNotEqualTo(rawCode);
    }

    private String hash(String rawCode) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(rawCode.getBytes(StandardCharsets.UTF_8)));
    }

    private String invitationPath(UUID householdId) {
        return "/api/households/" + householdId + "/invitations";
    }

    private String validHouseholdJson() {
        return "{\"name\":\"Valid Home\",\"timezone\":\"UTC\"}";
    }

    private void clearHouseholdData() {
        String testUsers = "SELECT id FROM users WHERE email LIKE 'hhtest-%@example.com'";
        String testHouseholds = "SELECT id FROM households WHERE created_by_user_id IN (" + testUsers + ")";
        jdbcTemplate.update(
                "DELETE FROM household_invitations WHERE household_id IN (" + testHouseholds
                        + ") OR created_by_user_id IN (" + testUsers + ")");
        jdbcTemplate.update(
                "DELETE FROM household_memberships WHERE household_id IN (" + testHouseholds
                        + ") OR user_id IN (" + testUsers + ")");
        jdbcTemplate.update("DELETE FROM households WHERE id IN (" + testHouseholds + ")");
        jdbcTemplate.update("DELETE FROM users WHERE email LIKE 'hhtest-%@example.com'");
    }

    private record WebSession(Cookie cookie, String csrfHeader, String csrfToken, String userId) {
    }
}
