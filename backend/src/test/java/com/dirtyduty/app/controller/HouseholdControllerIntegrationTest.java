package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.notification.NotificationCooldownService;
import com.dirtyduty.app.notification.NotificationEvent;
import com.dirtyduty.app.notification.NotificationEventService;
import com.dirtyduty.app.notification.NotificationMessage;
import com.dirtyduty.app.notification.NotificationScheduler;
import com.dirtyduty.app.notification.NotificationTemplateResolver;
import com.dirtyduty.app.notification.WebPushClient;
import com.dirtyduty.app.notification.WebPushNotificationProvider;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class HouseholdControllerIntegrationTest {

  private static final String PASSWORD = "StrongPassword123!";
  private static final String INVALID_INVITE_MESSAGE =
      "Invite code is invalid or no longer available.";

  @Autowired private MockMvc mockMvc;

  @Autowired private AuthService authService;

  @Autowired private UserRepository userRepository;

  @Autowired private JdbcTemplate jdbcTemplate;

  @Autowired private NotificationCooldownService notificationCooldownService;

  @Autowired private NotificationScheduler notificationScheduler;

  @Autowired private NotificationEventService notificationEventService;

  @Autowired private NotificationTemplateResolver notificationTemplateResolver;

  private final ObjectMapper objectMapper = new ObjectMapper();

  @MockitoSpyBean private HouseholdMembershipRepository householdMembershipRepository;

  @MockitoBean private WebPushClient webPushClient;

  @MockitoSpyBean private WebPushNotificationProvider webPushProvider;

  private final AtomicBoolean failOwnerMembershipSave = new AtomicBoolean();

  @BeforeEach
  void cleanBefore() {
    failOwnerMembershipSave.set(false);
    clearHouseholdData();
  }

  private void addPushSubscription(UUID userId, String endpoint) {
    jdbcTemplate.update(
        """
                INSERT INTO push_subscriptions (user_id, endpoint, public_key, auth_secret)
                VALUES (?, ?, ?, ?)
                """,
        userId,
        endpoint,
        Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[65]),
        Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]));
  }

  private NotificationMessage insertPushNotification(UUID userId, String type) {
    UUID notificationId = UUID.randomUUID();
    String key = "push-test-" + UUID.randomUUID();
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    jdbcTemplate.update(
        """
                INSERT INTO notifications
                    (id, recipient_user_id, type, category, title, message, status,
                     scheduled_at, sent_at, expires_at, deduplication_key)
                VALUES (?, ?, ?, 'GENERAL', 'Title', 'Body', 'SENT', ?, ?, ?, ?)
                """,
        notificationId,
        userId,
        type,
        now.minusMinutes(1),
        now,
        now.plusHours(1),
        key);
    jdbcTemplate.update(
        """
                INSERT INTO notification_deliveries (notification_id, channel, status, sent_at)
                VALUES (?, 'IN_APP', 'SENT', ?), (?, 'WEB_PUSH', 'PENDING', NULL)
                """,
        notificationId,
        now,
        notificationId);
    return new NotificationMessage(
        userId,
        type,
        "GENERAL",
        "NORMAL",
        "Title",
        "Body",
        null,
        null,
        now.minusMinutes(1),
        now.plusHours(1),
        key);
  }

  private String deliveryStatus(String deduplicationKey, String channel) {
    return jdbcTemplate.queryForObject(
        """
                SELECT d.status FROM notification_deliveries d
                JOIN notifications n ON n.id=d.notification_id
                WHERE n.deduplication_key=? AND d.channel=?
                """,
        String.class,
        deduplicationKey,
        channel);
  }

  private int deliveryAttempts(String deduplicationKey, String channel) {
    return jdbcTemplate.queryForObject(
        """
                SELECT d.attempts FROM notification_deliveries d
                JOIN notifications n ON n.id=d.notification_id
                WHERE n.deduplication_key=? AND d.channel=?
                """,
        Integer.class,
        deduplicationKey,
        channel);
  }

  private boolean subscriptionActive(String endpoint) {
    return jdbcTemplate.queryForObject(
        "SELECT active FROM push_subscriptions WHERE endpoint=?", Boolean.class, endpoint);
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
    String json =
        """
                {
                  "name": "  Our Apartment  ",
                  "timezone": " America/Halifax ",
                  "createdByUserId": "%s",
                  "ownerId": "%s",
                  "role": "ADMIN",
                  "status": "REMOVED"
                }
                """
            .formatted(spoofedUser.userId(), spoofedUser.userId());

    MvcResult result =
        mockMvc
            .perform(
                post("/api/households")
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

    UUID householdId =
        UUID.fromString(
            objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText());
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT name FROM chore_categories WHERE household_id = ? ORDER BY sort_order",
                String.class,
                householdId))
        .containsExactly("Kitchen", "Bathroom", "Laundry", "Trash", "Cleaning", "General");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT created_by_user_id FROM households WHERE id = ?", UUID.class, householdId))
        .isEqualTo(UUID.fromString(owner.userId()));
    assertThat(
            jdbcTemplate.queryForMap(
                """
                SELECT role, status, joined_at
                FROM household_memberships
                WHERE household_id = ? AND user_id = ?
                """,
                householdId,
                UUID.fromString(owner.userId())))
        .containsEntry("role", "OWNER")
        .containsEntry("status", "ACTIVE")
        .containsKey("joined_at");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(spoofedUser.userId())))
        .isZero();
  }

  @Test
  void householdSettingsAreOwnerEditableAndMemberReadable() throws Exception {
    WebSession owner = login("settingsowner");
    WebSession member = login("settingsmember");
    UUID householdId = createHousehold(owner, "Settings Home", "UTC");
    join(member, createInvitation(owner, householdId)).andExpect(status().isOk());
    String settingsPath = "/api/households/" + householdId + "/settings";

    mockMvc
        .perform(
            put(settingsPath)
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"name":"Updated Home","description":"A cozy place","timezone":"America/Halifax"}
                        """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("Updated Home"))
        .andExpect(jsonPath("$.description").value("A cozy place"))
        .andExpect(jsonPath("$.timezone").value("America/Halifax"))
        .andExpect(jsonPath("$.currentUserRole").value("OWNER"))
        .andExpect(jsonPath("$.createdAt").isString());

    mockMvc
        .perform(get(settingsPath).cookie(member.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("Updated Home"))
        .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));

    mockMvc
        .perform(
            put(settingsPath)
                .cookie(member.cookie())
                .header(member.csrfHeader(), member.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"name":"Unauthorized Change","description":null,"timezone":"UTC"}
                        """))
        .andExpect(status().isForbidden());
  }

  @Test
  void notificationsAreIsolatedAndCanBeMarkedRead() throws Exception {
    WebSession owner = login("notifyowner");
    WebSession member = login("notifymember");
    UUID householdId = createHousehold(owner, "Notification Home", "UTC");
    join(member, createInvitation(owner, householdId)).andExpect(status().isOk());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notification_events WHERE household_id=?",
                Integer.class,
                householdId))
        .isEqualTo(2);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE recipient_user_id=?",
                Integer.class,
                UUID.fromString(owner.userId())))
        .isEqualTo(2);

    MvcResult ownerNotifications =
        mockMvc
            .perform(get("/api/notifications").cookie(owner.cookie()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andReturn();
    assertThat(
            mockMvc
                .perform(get("/api/notifications").cookie(member.cookie()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString())
        .isEqualTo("[]");
    mockMvc
        .perform(get("/api/notifications/unread-count").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(2));

    UUID notificationId =
        UUID.fromString(
            objectMapper
                .readTree(ownerNotifications.getResponse().getContentAsString())
                .get(0)
                .get("id")
                .asText());
    mockMvc
        .perform(
            patch("/api/notifications/" + notificationId + "/read")
                .cookie(member.cookie())
                .header(member.csrfHeader(), member.csrfToken()))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(
            patch("/api/notifications/" + notificationId + "/read")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isNoContent());
    mockMvc
        .perform(
            patch("/api/notifications/read-all")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isNoContent());
    mockMvc
        .perform(get("/api/notifications/unread-count").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(0));
  }

  @Test
  void pushSubscriptionsArePrivateToTheAuthenticatedUserAndSupportMultipleDevices()
      throws Exception {
    WebSession owner = login("pushowner");
    WebSession other = login("pushother");
    String firstEndpoint = "https://8.8.8.8/device-one";
    String secondEndpoint = "https://8.8.8.8/device-two";
    String key = Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[65]);
    String auth = Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]);

    mockMvc
        .perform(
            put("/api/notifications/push-subscriptions")
                .cookie(owner.cookie())
                .contentType(APPLICATION_JSON)
                .content(pushSubscriptionJson(firstEndpoint, key, auth)))
        .andExpect(status().isForbidden());

    mockMvc
        .perform(
            put("/api/notifications/push-subscriptions")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(pushSubscriptionJson(firstEndpoint, key, auth)))
        .andExpect(status().isNoContent());
    mockMvc
        .perform(
            put("/api/notifications/push-subscriptions")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(pushSubscriptionJson(secondEndpoint, key, auth)))
        .andExpect(status().isNoContent());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM push_subscriptions WHERE user_id=? AND active=TRUE",
                Integer.class,
                UUID.fromString(owner.userId())))
        .isEqualTo(2);

    mockMvc
        .perform(
            put("/api/notifications/push-subscriptions")
                .cookie(other.cookie())
                .header(other.csrfHeader(), other.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(pushSubscriptionJson(firstEndpoint, key, auth)))
        .andExpect(status().isConflict());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?",
                Integer.class,
                UUID.fromString(other.userId())))
        .isZero();

    mockMvc
        .perform(
            post("/api/notifications/push-subscriptions/unsubscribe")
                .cookie(other.cookie())
                .header(other.csrfHeader(), other.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("{\"endpoint\":\"" + firstEndpoint + "\"}"))
        .andExpect(status().isNoContent());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT active FROM push_subscriptions WHERE endpoint=?",
                Boolean.class,
                firstEndpoint))
        .isTrue();

    mockMvc
        .perform(
            post("/api/notifications/push-subscriptions/unsubscribe")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("{\"endpoint\":\"" + firstEndpoint + "\"}"))
        .andExpect(status().isNoContent());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT active FROM push_subscriptions WHERE endpoint=?",
                Boolean.class,
                firstEndpoint))
        .isFalse();

    mockMvc
        .perform(
            put("/api/notifications/push-subscriptions")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(pushSubscriptionJson("http://localhost/private", key, auth)))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            put("/api/notifications/push-subscriptions")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(pushSubscriptionJson("https://8.8.8.8/invalid-key", "short", auth)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void notificationPreferencesPreserveOverridesAndHouseholdDefaults() throws Exception {
    WebSession owner = login("preferenceowner");
    UUID householdId = createHousehold(owner, "Preference Home", "UTC");
    UUID userId = UUID.fromString(owner.userId());

    mockMvc
        .perform(get("/api/notifications/preferences").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.notificationStyleOverride").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.householdNotificationStyle").value("NORMAL"));

    mockMvc
        .perform(
            put("/api/notifications/households/" + householdId + "/style")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("{\"style\":\"MOTIVATIONAL\"}"))
        .andExpect(status().isNoContent());
    mockMvc
        .perform(
            put("/api/notifications/preferences")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "choreAssignedEnabled": true,
                          "choreRemindersEnabled": false,
                          "overdueEnabled": false,
                          "choreCompletionEnabled": true,
                          "householdUpdatesEnabled": false,
                          "quietHoursStart": null,
                          "quietHoursEnd": null,
                          "notificationStyleOverride": "FUNNY",
                          "funnyNotificationsEnabled": false,
                          "competitiveNotificationsEnabled": false,
                          "pushEnabled": false
                        }
                        """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.choreRemindersEnabled").value(false))
        .andExpect(jsonPath("$.overdueEnabled").value(false))
        .andExpect(jsonPath("$.householdUpdatesEnabled").value(false))
        .andExpect(jsonPath("$.competitiveNotificationsEnabled").value(false))
        .andExpect(jsonPath("$.pushEnabled").value(false))
        .andExpect(jsonPath("$.notificationStyleOverride").value("FUNNY"))
        .andExpect(jsonPath("$.householdNotificationStyle").value("MOTIVATIONAL"));

    String styleEventType = "STYLE_TEST_" + UUID.randomUUID().toString().replace("-", "");
    jdbcTemplate.update(
        """
                INSERT INTO notification_templates (event_type, style, title_template, message_template)
                VALUES (?, 'FUNNY', 'funny-style', '{chore_name}'),
                       (?, 'MOTIVATIONAL', 'motivational-style', '{chore_name}')
                """,
        styleEventType,
        styleEventType);
    NotificationEvent styleEvent =
        new NotificationEvent(
            styleEventType,
            null,
            householdId,
            "CHORE_ASSIGNMENT",
            UUID.randomUUID(),
            "CHORE_REMINDER",
            Map.of("chore_name", "Test chore"),
            List.of(userId));
    try {
      assertThat(notificationTemplateResolver.resolve(styleEvent, userId).title())
          .isEqualTo("funny-style");
      mockMvc
          .perform(
              put("/api/notifications/preferences")
                  .cookie(owner.cookie())
                  .header(owner.csrfHeader(), owner.csrfToken())
                  .contentType(APPLICATION_JSON)
                  .content(
                      """
                            {
                              "choreAssignedEnabled": true,
                              "choreRemindersEnabled": true,
                              "overdueEnabled": true,
                              "choreCompletionEnabled": true,
                              "householdUpdatesEnabled": true,
                              "quietHoursStart": null,
                              "quietHoursEnd": null,
                              "notificationStyleOverride": null,
                              "funnyNotificationsEnabled": false,
                              "competitiveNotificationsEnabled": true,
                              "pushEnabled": false
                            }
                            """))
          .andExpect(status().isOk())
          .andExpect(
              jsonPath("$.notificationStyleOverride").value(org.hamcrest.Matchers.nullValue()))
          .andExpect(jsonPath("$.householdNotificationStyle").value("MOTIVATIONAL"));
      assertThat(notificationTemplateResolver.resolve(styleEvent, userId).title())
          .isEqualTo("motivational-style");
    } finally {
      jdbcTemplate.update("DELETE FROM notification_templates WHERE event_type=?", styleEventType);
    }
  }

  @Test
  void notificationPreferencesSuppressTheirEventsWithoutCouplingPushAndInApp() throws Exception {
    WebSession owner = login("preferencefilter");
    UUID householdId = createHousehold(owner, "Preference Filter Home", "UTC");
    UUID userId = UUID.fromString(owner.userId());

    setNotificationPreferences(userId, false, true, true, false, false);
    UUID dueSoonId = UUID.randomUUID();
    notificationEventService.publish(
        new NotificationEvent(
            "CHORE_DUE_SOON",
            null,
            householdId,
            "CHORE_ASSIGNMENT",
            dueSoonId,
            "CHORE_REMINDER",
            Map.of("chore_name", "Kitchen", "due_time", "18:00"),
            List.of(userId)));
    assertThat(notificationCountByReference(dueSoonId)).isZero();

    setNotificationPreferences(userId, true, false, true, false, false);
    UUID overdueId = UUID.randomUUID();
    notificationEventService.publish(
        new NotificationEvent(
            "CHORE_OVERDUE",
            null,
            householdId,
            "CHORE_ASSIGNMENT",
            overdueId,
            "CHORE_REMINDER",
            Map.of("chore_name", "Kitchen", "hours_late", "1"),
            List.of(userId)));
    assertThat(notificationCountByReference(overdueId)).isZero();

    setNotificationPreferences(userId, true, true, true, false, false);
    UUID householdUpdateId = UUID.randomUUID();
    notificationEventService.publish(
        new NotificationEvent(
            "HOUSEHOLD_JOINED",
            null,
            householdId,
            "HOUSEHOLD",
            householdUpdateId,
            "HOUSEHOLD_UPDATE",
            Map.of(),
            List.of(userId)));
    assertThat(notificationCountByReference(householdUpdateId)).isZero();

    setNotificationPreferences(userId, true, true, false, true, false);
    UUID competitiveId = UUID.randomUUID();
    notificationEventService.publish(
        new NotificationEvent(
            "CHORE_OVERDUE",
            null,
            householdId,
            "CHORE_ASSIGNMENT",
            competitiveId,
            "COMPETITIVE",
            Map.of("chore_name", "Kitchen", "hours_late", "1"),
            List.of(userId)));
    assertThat(notificationCountByReference(competitiveId)).isZero();

    setNotificationPreferences(userId, true, true, true, true, false);
    doReturn(true).when(webPushProvider).isConfigured();
    UUID completionId = UUID.randomUUID();
    NotificationEvent completionEvent =
        new NotificationEvent(
            "CHORE_COMPLETED",
            null,
            householdId,
            "CHORE_ASSIGNMENT",
            completionId,
            "CHORE_COMPLETION",
            Map.of("chore_name", "Kitchen"),
            List.of(userId));
    notificationEventService.publish(completionEvent);
    notificationEventService.publish(completionEvent);
    assertThat(notificationCountByReference(completionId)).isEqualTo(1);
    assertThat(notificationStatus(completionId)).isEqualTo("SENT");
    assertThat(notificationDeliveryStatus(completionId, "IN_APP")).isEqualTo("SENT");
    assertThat(notificationDeliveryStatus(completionId, "WEB_PUSH")).isEqualTo("CANCELLED");
  }

  @Test
  void webPushFailureAndSuccessRemainIndependentFromInAppAndDoNotDuplicateDevices()
      throws Exception {
    WebSession owner = login("channelowner");
    UUID userId = UUID.fromString(owner.userId());
    doReturn(true).when(webPushProvider).isConfigured();
    jdbcTemplate.update(
        """
                INSERT INTO notification_preferences (user_id, push_enabled)
                VALUES (?, TRUE) ON CONFLICT (user_id) DO UPDATE SET push_enabled=TRUE
                """,
        userId);
    String staleEndpoint = "https://8.8.8.8/stale-" + UUID.randomUUID();
    String liveEndpoint = "https://8.8.8.8/live-" + UUID.randomUUID();
    addPushSubscription(userId, staleEndpoint);
    addPushSubscription(userId, liveEndpoint);
    NotificationMessage successfulMessage = insertPushNotification(userId, "CHORE_OVERDUE");
    when(webPushClient.send(
            anyString(),
            anyString(),
            anyString(),
            eq(staleEndpoint),
            anyString(),
            anyString(),
            any(byte[].class)))
        .thenReturn(410);
    when(webPushClient.send(
            anyString(),
            anyString(),
            anyString(),
            eq(liveEndpoint),
            anyString(),
            anyString(),
            any(byte[].class)))
        .thenReturn(201);

    webPushProvider.deliver(successfulMessage, null);

    assertThat(deliveryStatus(successfulMessage.deduplicationKey(), "IN_APP")).isEqualTo("SENT");
    assertThat(deliveryStatus(successfulMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo("SENT");
    assertThat(subscriptionActive(staleEndpoint)).isFalse();
    assertThat(subscriptionActive(liveEndpoint)).isTrue();
    webPushProvider.deliver(successfulMessage, null);
    verify(webPushClient, times(1))
        .send(
            anyString(),
            anyString(),
            anyString(),
            eq(staleEndpoint),
            anyString(),
            anyString(),
            any(byte[].class));
    verify(webPushClient, times(1))
        .send(
            anyString(),
            anyString(),
            anyString(),
            eq(liveEndpoint),
            anyString(),
            anyString(),
            any(byte[].class));

    jdbcTemplate.update("UPDATE push_subscriptions SET active=FALSE WHERE user_id=?", userId);
    String transientEndpoint = "https://8.8.8.8/transient-" + UUID.randomUUID();
    addPushSubscription(userId, transientEndpoint);
    NotificationMessage retryMessage = insertPushNotification(userId, "HOUSEHOLD_JOINED");
    when(webPushClient.send(
            anyString(),
            anyString(),
            anyString(),
            eq(transientEndpoint),
            anyString(),
            anyString(),
            any(byte[].class)))
        .thenThrow(new java.io.IOException("temporary push outage"))
        .thenReturn(201);

    webPushProvider.deliver(retryMessage, null);
    assertThat(deliveryStatus(retryMessage.deduplicationKey(), "IN_APP")).isEqualTo("SENT");
    assertThat(deliveryStatus(retryMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo("FAILED");
    assertThat(deliveryAttempts(retryMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo(1);
    jdbcTemplate.update(
        """
                UPDATE notification_deliveries SET next_attempt_at=NOW() - INTERVAL '1 second'
                WHERE notification_id=(SELECT id FROM notifications WHERE deduplication_key=?)
                  AND channel='WEB_PUSH'
                """,
        retryMessage.deduplicationKey());

    webPushProvider.deliver(retryMessage, null);

    assertThat(deliveryStatus(retryMessage.deduplicationKey(), "IN_APP")).isEqualTo("SENT");
    assertThat(deliveryStatus(retryMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo("SENT");
    assertThat(deliveryAttempts(retryMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo(2);
    jdbcTemplate.update(
        """
                UPDATE notification_deliveries SET status='FAILED', attempts=3, next_attempt_at=NOW()
                WHERE notification_id=(SELECT id FROM notifications WHERE deduplication_key=?)
                  AND channel='WEB_PUSH'
                """,
        retryMessage.deduplicationKey());
    webPushProvider.deliver(retryMessage, null);
    assertThat(deliveryStatus(retryMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo("FAILED");
    assertThat(deliveryAttempts(retryMessage.deduplicationKey(), "WEB_PUSH")).isEqualTo(3);
    verify(webPushClient, times(2))
        .send(
            anyString(),
            anyString(),
            anyString(),
            eq(transientEndpoint),
            anyString(),
            anyString(),
            any(byte[].class));
  }

  @Test
  void cooldownLimitsFiveOverdueRemindersAndCancelsThoseWhoseWindowsExpire() throws Exception {
    WebSession owner = login("cooldownowner");
    UUID userId = UUID.fromString(owner.userId());
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    List<NotificationMessage> messages = new java.util.ArrayList<>();

    for (int index = 0; index < 5; index++) {
      String key = "cooldown-test-" + UUID.randomUUID();
      UUID notificationId = UUID.randomUUID();
      jdbcTemplate.update(
          """
                    INSERT INTO notifications
                        (id, recipient_user_id, type, category, title, message, status,
                         scheduled_at, expires_at, deduplication_key)
                    VALUES (?, ?, 'CHORE_OVERDUE', 'CHORE_REMINDER', 'Overdue', 'Reminder',
                            'PENDING', ?, ?, ?)
                    """,
          notificationId,
          userId,
          now,
          now.plusMinutes(30),
          key);
      jdbcTemplate.update(
          """
                    INSERT INTO notification_deliveries (notification_id, channel, status)
                    VALUES (?, 'IN_APP', 'PENDING')
                    """,
          notificationId);
      messages.add(
          new NotificationMessage(
              userId,
              "CHORE_OVERDUE",
              "CHORE_REMINDER",
              "NORMAL",
              "Overdue",
              "Reminder",
              null,
              null,
              now,
              now.plusMinutes(30),
              key));
    }

    List<Boolean> eligibility = new java.util.ArrayList<>();
    for (NotificationMessage message : messages) {
      boolean available =
          notificationCooldownService.isAvailable(message, now, message.deduplicationKey());
      eligibility.add(available);
      if (available) {
        jdbcTemplate.update(
            """
                        UPDATE notifications SET status='SENT', sent_at=? WHERE deduplication_key=?
                        """,
            now,
            message.deduplicationKey());
        jdbcTemplate.update(
            """
                        UPDATE notification_deliveries SET status='SENT', sent_at=?
                        WHERE notification_id=(SELECT id FROM notifications WHERE deduplication_key=?)
                          AND channel='IN_APP'
                        """,
            now,
            message.deduplicationKey());
      }
    }
    assertThat(eligibility).containsExactly(true, false, false, false, false);
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notifications WHERE recipient_user_id=?
                  AND deduplication_key LIKE 'cooldown-test-%' AND status='PENDING'
                """,
                Integer.class, userId))
        .isEqualTo(4);

    jdbcTemplate.update(
        """
                UPDATE notifications SET expires_at=NOW() - INTERVAL '1 second'
                WHERE recipient_user_id=? AND deduplication_key LIKE 'cooldown-test-%' AND status='PENDING'
                """,
        userId);
    notificationScheduler.run();
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notifications WHERE recipient_user_id=?
                  AND deduplication_key LIKE 'cooldown-test-%' AND status='CANCELLED'
                """,
                Integer.class, userId))
        .isEqualTo(4);
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notification_deliveries d
                JOIN notifications n ON n.id=d.notification_id
                WHERE n.recipient_user_id=? AND n.deduplication_key LIKE 'cooldown-test-%'
                  AND d.status='CANCELLED'
                """,
                Integer.class, userId))
        .isEqualTo(4);
  }

  @Test
  void retentionDeletesOnlyReadNotificationsOlderThanNinetyDays() throws Exception {
    WebSession owner = login("retentionowner");
    UUID householdId = createHousehold(owner, "Retention Home", "UTC");
    UUID userId = UUID.fromString(owner.userId());
    int eventsBefore =
        jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM notification_events WHERE household_id=?",
            Integer.class,
            householdId);
    UUID categoryId =
        jdbcTemplate.queryForObject(
            "SELECT id FROM chore_categories WHERE household_id=? ORDER BY sort_order LIMIT 1",
            UUID.class,
            householdId);
    UUID choreId = UUID.randomUUID();
    UUID assignmentId = UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO chores (id, household_id, category_id, title, created_by_user_id)
                VALUES (?, ?, ?, 'Historical chore', ?)
                """,
        choreId,
        householdId,
        categoryId,
        userId);
    jdbcTemplate.update(
        """
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, scheduled_for, status, title_snapshot,
                     priority_snapshot, difficulty_snapshot)
                VALUES (?, ?, ?, CURRENT_DATE, 'COMPLETED', 'Historical chore', 'NORMAL', 1)
                """,
        assignmentId,
        householdId,
        choreId);
    jdbcTemplate.update(
        """
                INSERT INTO chore_completions (household_id, assignment_id, completed_by_user_id)
                VALUES (?, ?, ?)
                """,
        householdId,
        assignmentId,
        userId);
    String oldReadKey = "retention-old-read-" + UUID.randomUUID();
    String recentReadKey = "retention-recent-read-" + UUID.randomUUID();
    String oldUnreadKey = "retention-old-unread-" + UUID.randomUUID();

    insertRetentionNotification(userId, oldReadKey, "NOW() - INTERVAL '91 days'");
    insertRetentionNotification(userId, recentReadKey, "NOW() - INTERVAL '89 days'");
    insertRetentionNotification(userId, oldUnreadKey, null);

    notificationScheduler.cleanupReadNotifications();

    assertThat(notificationCount(oldReadKey)).isZero();
    assertThat(notificationCount(recentReadKey)).isEqualTo(1);
    assertThat(notificationCount(oldUnreadKey)).isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM households WHERE id=?", Integer.class, householdId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notification_events WHERE household_id=?",
                Integer.class,
                householdId))
        .isEqualTo(eventsBefore);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chores WHERE id=?", Integer.class, choreId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_assignments WHERE id=?", Integer.class, assignmentId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_completions WHERE assignment_id=?",
                Integer.class,
                assignmentId))
        .isEqualTo(1);
  }

  @Test
  void profileUpdatesOnlyAuthenticatedUsersDisplayName() throws Exception {
    WebSession user = login("profileuser");
    WebSession other = login("profileother");

    mockMvc
        .perform(get("/api/profile").cookie(user.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.displayName").value("Test User"))
        .andExpect(jsonPath("$.email").isString())
        .andExpect(jsonPath("$.assigned").value(0))
        .andExpect(jsonPath("$.completed").value(0));
    mockMvc
        .perform(
            put("/api/profile")
                .cookie(user.cookie())
                .header(user.csrfHeader(), user.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("{\"displayName\":\"Updated Name\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.displayName").value("Updated Name"));
    mockMvc
        .perform(get("/api/profile").cookie(other.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.displayName").value("Test User"));
  }

  @Test
  void choreManagementSupportsScopedLifecycleAndKeepsArchivedHistory() throws Exception {
    WebSession owner = login("choreowner");
    UUID householdId = createHousehold(owner, "Chore Home", "UTC");
    UUID categoryId =
        jdbcTemplate.queryForObject(
            "SELECT id FROM chore_categories WHERE household_id = ? AND name = ?",
            UUID.class,
            householdId,
            "Cleaning");
    String base = "/api/households/" + householdId;

    mockMvc
        .perform(get(base + "/chore-categories").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[4].id").value(categoryId.toString()))
        .andExpect(jsonPath("$[4].name").value("Cleaning"));

    WebSession activeMember = login("optionsmember");
    join(activeMember, createInvitation(owner, householdId)).andExpect(status().isOk());
    mockMvc
        .perform(get(base + "/chore-management-options").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.activeMembers.length()").value(2))
        .andExpect(
            jsonPath("$.activeMembers[?(@.userId == '%s')].displayName", activeMember.userId())
                .value("Test User"));
    jdbcTemplate.update(
        "UPDATE household_memberships SET status = 'LEFT', left_at = NOW() WHERE household_id = ? AND user_id = ?",
        householdId,
        UUID.fromString(activeMember.userId()));
    mockMvc
        .perform(get(base + "/chore-management-options").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.categories[4].id").value(categoryId.toString()))
        .andExpect(jsonPath("$.activeMembers.length()").value(1))
        .andExpect(jsonPath("$.activeMembers[0].userId").value(owner.userId()))
        .andExpect(jsonPath("$.activeMembers[0].displayName").value("Test User"));

    String request =
        """
                {
                  "title": "  Sweep kitchen  ",
                  "description": "After dinner",
                  "categoryId": "%s",
                  "defaultPriority": "HIGH",
                  "difficulty": 3,
                  "estimatedMinutes": 15,
                  "requiresVerification": true,
                  "schedule": {
                    "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO",
                    "timezone": "UTC",
                    "startsOn": "2026-09-28",
                    "assignmentStrategy": "FIXED",
                    "fixedAssigneeUserId": "%s"
                  }
                }
                """
            .formatted(categoryId, owner.userId());
    MvcResult created =
        mockMvc
            .perform(
                post(base + "/chores")
                    .cookie(owner.cookie())
                    .header(owner.csrfHeader(), owner.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content(request))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.title").value("Sweep kitchen"))
            .andExpect(jsonPath("$.categoryId").value(categoryId.toString()))
            .andExpect(jsonPath("$.schedule.assignmentStrategy").value("FIXED"))
            .andReturn();
    UUID choreId =
        UUID.fromString(
            objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asText());

    mockMvc
        .perform(get(base + "/chores").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(choreId.toString()));
    mockMvc
        .perform(get(base + "/chores/" + choreId).cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("Sweep kitchen"));
    mockMvc
        .perform(
            put(base + "/chores/" + choreId)
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "title": "Mop kitchen",
                          "categoryId": "%s",
                          "defaultPriority": "URGENT",
                          "difficulty": 4,
                          "estimatedMinutes": 20
                        }
                        """
                        .formatted(categoryId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("Mop kitchen"))
        .andExpect(jsonPath("$.defaultPriority").value("URGENT"))
        .andExpect(jsonPath("$.categoryId").value(categoryId.toString()));

    mockMvc
        .perform(
            post(base + "/chores/" + choreId + "/pause")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.active").value(false))
        .andExpect(jsonPath("$.schedule.active").value(false));
    mockMvc
        .perform(
            post(base + "/chores/" + choreId + "/activate")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.active").value(true))
        .andExpect(jsonPath("$.schedule.active").value(true));
    mockMvc
        .perform(
            post(base + "/chores/" + choreId + "/archive")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.active").value(false))
        .andExpect(jsonPath("$.archivedAt").isString());

    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chores WHERE id = ? AND household_id = ? AND archived_at IS NOT NULL",
                Integer.class,
                choreId,
                householdId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_schedules WHERE chore_id = ? AND is_active = FALSE",
                Integer.class,
                choreId))
        .isEqualTo(1);
    mockMvc
        .perform(get(base + "/chores").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$").isEmpty());
  }

  @Test
  void choreManagementRejectsCrossHouseholdCategoriesAndParticipantsAndNonAdmins()
      throws Exception {
    WebSession owner = login("choreguard");
    WebSession otherOwner = login("otherchore");
    UUID householdId = createHousehold(owner, "Managed Home", "UTC");
    UUID otherHouseholdId = createHousehold(otherOwner, "Other Home", "UTC");
    jdbcTemplate.update(
        "INSERT INTO chore_categories (household_id, name) VALUES (?, ?)",
        otherHouseholdId,
        "Private category");
    UUID otherCategoryId =
        jdbcTemplate.queryForObject(
            "SELECT id FROM chore_categories WHERE household_id = ? AND name = ?",
            UUID.class,
            otherHouseholdId,
            "Private category");
    String path = "/api/households/" + householdId + "/chores";

    mockMvc
        .perform(
            post(path)
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"title":"Wrong category","categoryId":"%s"}
                        """
                        .formatted(otherCategoryId)))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            post(path)
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "title":"Wrong participant",
                          "schedule":{
                            "recurrenceRule":"FREQ=DAILY",
                            "timezone":"UTC",
                            "startsOn":"2026-09-28",
                            "assignmentStrategy":"RANDOM",
                            "participantUserIds":["%s"]
                          }
                        }
                        """
                        .formatted(otherOwner.userId())))
        .andExpect(status().isBadRequest());

    String invitation = createInvitation(owner, householdId);
    WebSession member = login("choremember");
    join(member, invitation).andExpect(status().isOk());
    mockMvc.perform(get(path).cookie(member.cookie())).andExpect(status().isForbidden());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chores WHERE household_id = ?", Integer.class, householdId))
        .isZero();
  }

  @Test
  void choreManagementAllowsAdminsAndPersistsRotateAndRandomParticipants() throws Exception {
    WebSession owner = login("strategyowner");
    UUID householdId = createHousehold(owner, "Strategy Home", "UTC");
    WebSession admin = login("strategyadmin");
    join(admin, createInvitation(owner, householdId)).andExpect(status().isOk());
    jdbcTemplate.update(
        "UPDATE household_memberships SET role = 'ADMIN' WHERE household_id = ? AND user_id = ?",
        householdId,
        UUID.fromString(admin.userId()));
    WebSession member = login("strategymember");
    join(member, createInvitation(owner, householdId)).andExpect(status().isOk());
    String path = "/api/households/" + householdId + "/chores";

    mockMvc.perform(get(path)).andExpect(status().isUnauthorized());

    String rotateRequest =
        """
                {
                  "title":"Rotate dishes",
                  "schedule":{
                    "recurrenceRule":"FREQ=WEEKLY;BYDAY=MO,FR",
                    "timezone":"Pacific/Kiritimati",
                    "startsOn":"2026-09-28",
                    "assignmentStrategy":"ROUND_ROBIN",
                    "participantUserIds":["%s","%s"]
                  }
                }
                """
            .formatted(owner.userId(), admin.userId());
    MvcResult rotateCreated =
        mockMvc
            .perform(
                post(path)
                    .cookie(admin.cookie())
                    .header(admin.csrfHeader(), admin.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content(rotateRequest))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.schedule.assignmentStrategy").value("ROUND_ROBIN"))
            .andExpect(jsonPath("$.schedule.timezone").value("UTC"))
            .andExpect(jsonPath("$.schedule.participantUserIds.length()").value(2))
            .andReturn();
    UUID rotateId =
        UUID.fromString(
            objectMapper
                .readTree(rotateCreated.getResponse().getContentAsString())
                .get("id")
                .asText());

    mockMvc
        .perform(
            put(path + "/" + rotateId)
                .cookie(member.cookie())
                .header(member.csrfHeader(), member.csrfToken())
                .contentType(APPLICATION_JSON)
                .content("{\"title\":\"Member mutation\"}"))
        .andExpect(status().isForbidden());

    mockMvc
        .perform(
            post(path)
                .cookie(admin.cookie())
                .header(admin.csrfHeader(), admin.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "title":"Random towels",
                          "schedule":{
                            "recurrenceRule":"FREQ=DAILY",
                            "timezone":"UTC",
                            "startsOn":"2026-09-28",
                            "assignmentStrategy":"RANDOM",
                            "participantUserIds":["%s"]
                          }
                        }
                        """
                        .formatted(admin.userId())))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.schedule.assignmentStrategy").value("RANDOM"))
        .andExpect(jsonPath("$.schedule.participantUserIds[0]").value(admin.userId()));

    mockMvc
        .perform(
            post(path)
                .cookie(admin.cookie())
                .header(admin.csrfHeader(), admin.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"title":"Invalid effort","difficulty":6}
                        """))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            post(path)
                .cookie(admin.cookie())
                .header(admin.csrfHeader(), admin.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"title":"Invalid duration","estimatedMinutes":1441}
                        """))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            post(path)
                .cookie(admin.cookie())
                .header(admin.csrfHeader(), admin.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "title":"Invalid weekday",
                          "schedule":{
                            "recurrenceRule":"FREQ=WEEKLY;BYDAY=XX",
                            "startsOn":"2026-09-28",
                            "assignmentStrategy":"FIXED",
                            "fixedAssigneeUserId":"%s"
                          }
                        }
                        """
                        .formatted(admin.userId())))
        .andExpect(status().isBadRequest());
  }

  @Test
  void multiPersonOccurrencesAreGeneratedSharedAndCompletableOnlyByAssignees() throws Exception {
    WebSession owner = login("multichoreowner");
    WebSession member = login("multichoremember");
    WebSession nonAssignee = login("multichoreother");
    UUID householdId = createHousehold(owner, "Shared Chore Home", "UTC");
    join(member, createInvitation(owner, householdId)).andExpect(status().isOk());
    join(nonAssignee, createInvitation(owner, householdId)).andExpect(status().isOk());
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    LocalDate startsOn = today.plusDays(1);
    String base = "/api/households/" + householdId;
    String request =
        """
                {
                  "title":"Clean together",
                  "defaultPriority":"HIGH",
                  "difficulty":3,
                  "schedule":{
                    "recurrenceRule":"FREQ=DAILY",
                    "timezone":"UTC",
                    "startsOn":"%s",
                    "endsOn":"%s",
                    "dueTime":"20:00",
                    "assignmentStrategy":"FIXED",
                    "participantUserIds":["%s","%s"],
                    "peopleNeeded":2
                  }
                }
                """
            .formatted(startsOn, startsOn.plusDays(1), owner.userId(), member.userId());
    MvcResult created =
        mockMvc
            .perform(
                post(base + "/chores")
                    .cookie(owner.cookie())
                    .header(owner.csrfHeader(), owner.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content(request))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.schedule.peopleNeeded").value(2))
            .andExpect(jsonPath("$.schedule.participantUserIds.length()").value(2))
            .andReturn();
    UUID choreId =
        UUID.fromString(
            objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asText());
    List<UUID> assignmentIds =
        jdbcTemplate.query(
            "SELECT id FROM chore_assignments WHERE chore_id=? ORDER BY scheduled_for",
            (rs, row) -> rs.getObject("id", UUID.class),
            choreId);
    assertThat(assignmentIds).hasSize(2);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_assignment_assignees WHERE assignment_id=?",
                Integer.class,
                assignmentIds.getFirst()))
        .isEqualTo(2);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(DISTINCT user_id) FROM chore_assignment_assignees WHERE assignment_id=?",
                Integer.class,
                assignmentIds.getFirst()))
        .isEqualTo(2);
    List<UUID> sharedRecipients =
        jdbcTemplate.query(
            "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=?",
            (rs, row) -> rs.getObject("user_id", UUID.class),
            assignmentIds.getFirst());
    for (UUID recipientId : sharedRecipients) {
      String key = "shared-reminder-" + UUID.randomUUID();
      UUID reminderId = UUID.randomUUID();
      jdbcTemplate.update(
          """
                    INSERT INTO notifications
                        (id, recipient_user_id, type, category, title, message, reference_type,
                         reference_id, status, scheduled_at, expires_at, deduplication_key)
                    VALUES (?, ?, 'CHORE_OVERDUE', 'CHORE_REMINDER', 'Overdue', 'Reminder',
                            'CHORE_ASSIGNMENT', ?, 'PENDING', NOW() + INTERVAL '2 hours',
                            NOW() + INTERVAL '3 hours', ?)
                    """,
          reminderId,
          recipientId,
          assignmentIds.getFirst(),
          key);
      jdbcTemplate.update(
          """
                    INSERT INTO notification_deliveries (notification_id, channel, status)
                    VALUES (?, 'IN_APP', 'PENDING'), (?, 'WEB_PUSH', 'PENDING')
                    """,
          reminderId,
          reminderId);
    }

    mockMvc
        .perform(get(base + "/my-chores").param("status", "UPCOMING").cookie(member.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[0].assignees.length()").value(2))
        .andExpect(jsonPath("$[0].canComplete").value(true))
        .andExpect(jsonPath("$[0].overdue").value(false));

    mockMvc
        .perform(
            post(base + "/assignments/" + assignmentIds.getFirst() + "/complete")
                .cookie(nonAssignee.cookie())
                .header(nonAssignee.csrfHeader(), nonAssignee.csrfToken()))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            post(base + "/assignments/" + assignmentIds.getFirst() + "/complete")
                .cookie(member.cookie())
                .header(member.csrfHeader(), member.csrfToken()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("COMPLETED"))
        .andExpect(jsonPath("$.assignees.length()").value(2));
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notifications WHERE reference_id=? AND type='CHORE_OVERDUE'
                  AND status='CANCELLED'
                """,
                Integer.class,
                assignmentIds.getFirst()))
        .isEqualTo(2);
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notification_deliveries d
                JOIN notifications n ON n.id=d.notification_id
                WHERE n.reference_id=? AND n.type='CHORE_OVERDUE' AND d.status='CANCELLED'
                """,
                Integer.class,
                assignmentIds.getFirst()))
        .isEqualTo(4);
    notificationScheduler.run();
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notifications WHERE reference_id=? AND type='CHORE_OVERDUE'
                  AND status='PENDING'
                """,
                Integer.class,
                assignmentIds.getFirst()))
        .isZero();
    mockMvc
        .perform(get(base + "/my-chores").param("status", "COMPLETED").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1))
        .andExpect(jsonPath("$[0].completedByDisplayName").value("Test User"));
    mockMvc
        .perform(
            post(base + "/assignments/" + assignmentIds.getFirst() + "/complete")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isOk());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_completions WHERE assignment_id=?",
                Integer.class,
                assignmentIds.getFirst()))
        .isEqualTo(1);
    LocalDate priorWeekDate = today.with(java.time.DayOfWeek.MONDAY).minusWeeks(1);
    UUID priorWeekAssignmentId = UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, scheduled_for, status, title_snapshot,
                     priority_snapshot, difficulty_snapshot)
                VALUES (?, ?, ?, ?, 'COMPLETED', 'Prior week chore', 'NORMAL', 1)
                """,
        priorWeekAssignmentId,
        householdId,
        choreId,
        priorWeekDate);
    jdbcTemplate.update(
        """
                INSERT INTO chore_assignment_assignees (household_id, assignment_id, user_id)
                VALUES (?, ?, ?)
                """,
        householdId,
        priorWeekAssignmentId,
        UUID.fromString(owner.userId()));
    jdbcTemplate.update(
        """
                INSERT INTO chore_completions (household_id, assignment_id, completed_by_user_id, completed_at)
                VALUES (?, ?, ?, NOW())
                """,
        householdId,
        priorWeekAssignmentId,
        UUID.fromString(owner.userId()));
    mockMvc
        .perform(
            put(base + "/chores/" + choreId)
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "title":"Clean together",
                          "schedule":{
                            "recurrenceRule":"FREQ=DAILY",
                            "timezone":"UTC",
                            "startsOn":"%s",
                            "endsOn":"%s",
                            "dueTime":"20:00",
                            "assignmentStrategy":"FIXED",
                            "participantUserIds":["%s","%s"],
                            "peopleNeeded":2
                          }
                        }
                        """
                        .formatted(
                            startsOn, startsOn.plusDays(1), owner.userId(), nonAssignee.userId())))
        .andExpect(status().isOk());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                assignmentIds.getFirst()))
        .isEqualTo("COMPLETED");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                assignmentIds.getLast()))
        .isEqualTo("PENDING");
    assertThat(
            jdbcTemplate.query(
                "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
                (rs, row) -> rs.getObject("user_id", UUID.class),
                assignmentIds.getFirst()))
        .containsExactlyInAnyOrder(
            UUID.fromString(owner.userId()), UUID.fromString(member.userId()));
    assertThat(
            jdbcTemplate.query(
                "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
                (rs, row) -> rs.getObject("user_id", UUID.class),
                assignmentIds.getLast()))
        .containsExactlyInAnyOrder(
            UUID.fromString(owner.userId()), UUID.fromString(nonAssignee.userId()));
    mockMvc
        .perform(
            put(base + "/chores/" + choreId)
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {
                          "title":"Clean together",
                          "schedule":{
                            "recurrenceRule":"FREQ=ONCE",
                            "startsOn":"%s",
                            "assignmentStrategy":"FIXED",
                            "participantUserIds":["%s","%s"],
                            "peopleNeeded":2
                          }
                        }
                        """
                        .formatted(today, owner.userId(), nonAssignee.userId())))
        .andExpect(status().isOk());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM chore_assignments WHERE id=?",
                String.class,
                assignmentIds.getLast()))
        .isEqualTo("CANCELLED");
    String cancelledReminderKey = "cancelled-reminder-" + UUID.randomUUID();
    UUID cancelledReminderId = UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO notifications
                    (id, recipient_user_id, type, category, title, message, reference_type,
                     reference_id, status, scheduled_at, expires_at, deduplication_key)
                VALUES (?, ?, 'CHORE_OVERDUE', 'CHORE_REMINDER', 'Overdue', 'Reminder',
                        'CHORE_ASSIGNMENT', ?, 'PENDING', NOW(), NOW() + INTERVAL '1 hour', ?)
                """,
        cancelledReminderId,
        UUID.fromString(owner.userId()),
        assignmentIds.getLast(),
        cancelledReminderKey);
    jdbcTemplate.update(
        """
                INSERT INTO notification_deliveries (notification_id, channel, status)
                VALUES (?, 'IN_APP', 'PENDING'), (?, 'WEB_PUSH', 'PENDING')
                """,
        cancelledReminderId,
        cancelledReminderId);
    notificationScheduler.run();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM notifications WHERE id=?", String.class, cancelledReminderId))
        .isEqualTo("CANCELLED");
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM notification_deliveries
                WHERE notification_id=? AND status='CANCELLED'
                """,
                Integer.class,
                cancelledReminderId))
        .isEqualTo(2);
    String skippedReminderKey = "skipped-reminder-" + UUID.randomUUID();
    UUID skippedReminderId = UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO notifications
                    (id, recipient_user_id, type, category, title, message, reference_type,
                     reference_id, status, scheduled_at, expires_at, deduplication_key)
                VALUES (?, ?, 'CHORE_OVERDUE', 'CHORE_REMINDER', 'Overdue', 'Reminder',
                        'CHORE_ASSIGNMENT', ?, 'PENDING', NOW(), NOW() + INTERVAL '1 hour', ?)
                """,
        skippedReminderId,
        UUID.fromString(owner.userId()),
        assignmentIds.getLast(),
        skippedReminderKey);
    jdbcTemplate.update(
        """
                INSERT INTO notification_deliveries (notification_id, channel, status)
                VALUES (?, 'IN_APP', 'PENDING'), (?, 'WEB_PUSH', 'PENDING')
                """,
        skippedReminderId,
        skippedReminderId);
    jdbcTemplate.update(
        "UPDATE chore_assignments SET status='SKIPPED' WHERE id=?", assignmentIds.getLast());
    notificationScheduler.run();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM notifications WHERE id=?", String.class, skippedReminderId))
        .isEqualTo("CANCELLED");
    mockMvc
        .perform(get(base + "/my-chores").param("status", "UPCOMING").cookie(member.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
    MvcResult randomCreated =
        mockMvc
            .perform(
                post(base + "/chores")
                    .cookie(owner.cookie())
                    .header(owner.csrfHeader(), owner.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "title":"Random team task",
                          "schedule":{
                            "recurrenceRule":"FREQ=ONCE",
                            "startsOn":"%s",
                            "assignmentStrategy":"RANDOM",
                            "participantUserIds":["%s","%s","%s"],
                            "peopleNeeded":2
                          }
                        }
                        """
                            .formatted(
                                today, owner.userId(), member.userId(), nonAssignee.userId())))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.schedule.peopleNeeded").value(2))
            .andReturn();
    UUID randomChoreId =
        UUID.fromString(
            objectMapper
                .readTree(randomCreated.getResponse().getContentAsString())
                .get("id")
                .asText());
    UUID randomAssignmentId =
        jdbcTemplate.queryForObject(
            "SELECT id FROM chore_assignments WHERE chore_id=?", UUID.class, randomChoreId);
    List<UUID> randomAssignees =
        jdbcTemplate.query(
            "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
            (rs, row) -> rs.getObject("user_id", UUID.class),
            randomAssignmentId);
    assertThat(randomAssignees).hasSize(2);
    mockMvc.perform(get(base + "/dashboard").cookie(owner.cookie())).andExpect(status().isOk());
    mockMvc.perform(get(base + "/dashboard").cookie(owner.cookie())).andExpect(status().isOk());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=?",
                Integer.class,
                randomChoreId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.query(
                "SELECT user_id FROM chore_assignment_assignees WHERE assignment_id=? ORDER BY user_id",
                (rs, row) -> rs.getObject("user_id", UUID.class),
                randomAssignmentId))
        .containsExactlyElementsOf(randomAssignees);
    mockMvc
        .perform(get(base + "/dashboard").cookie(owner.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.weekSummary.completedCount").isNumber())
        .andExpect(jsonPath("$.thisWeek").isArray())
        .andExpect(jsonPath("$.today").isArray());
    MvcResult memberStats =
        mockMvc
            .perform(get(base + "/members").cookie(owner.cookie()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].assignedThisWeek").isNumber())
            .andExpect(jsonPath("$[0].completedThisWeek").isNumber())
            .andReturn();
    var stats = objectMapper.readTree(memberStats.getResponse().getContentAsString());
    var ownerStats =
        java.util.stream.StreamSupport.stream(stats.spliterator(), false)
            .filter(item -> item.get("userId").asText().equals(owner.userId()))
            .findFirst()
            .orElseThrow();
    assertThat(ownerStats.get("completedThisWeek").asLong()).isEqualTo(1);
  }

  @Test
  void concurrentDashboardGenerationCreatesOneOccurrenceWithOnePersistedRandomTeam()
      throws Exception {
    WebSession owner = login("concurrentgeneration");
    WebSession member = login("concurrentmember");
    UUID householdId = createHousehold(owner, "Concurrent Home", "UTC");
    join(member, createInvitation(owner, householdId)).andExpect(status().isOk());
    LocalDate scheduledFor = LocalDate.now(ZoneOffset.UTC).plusDays(1);
    String base = "/api/households/" + householdId;
    MvcResult created =
        mockMvc
            .perform(
                post(base + "/chores")
                    .cookie(owner.cookie())
                    .header(owner.csrfHeader(), owner.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content(
                        """
                        {
                          "title":"Concurrent task",
                          "schedule":{
                            "recurrenceRule":"FREQ=ONCE",
                            "startsOn":"%s",
                            "assignmentStrategy":"RANDOM",
                            "participantUserIds":["%s","%s"],
                            "peopleNeeded":2
                          }
                        }
                        """
                            .formatted(scheduledFor, owner.userId(), member.userId())))
            .andExpect(status().isCreated())
            .andReturn();
    UUID choreId =
        UUID.fromString(
            objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asText());
    UUID oldAssignment =
        jdbcTemplate.queryForObject(
            "SELECT id FROM chore_assignments WHERE chore_id=?", UUID.class, choreId);
    jdbcTemplate.update(
        "DELETE FROM chore_assignment_assignees WHERE assignment_id=?", oldAssignment);
    jdbcTemplate.update("DELETE FROM chore_assignments WHERE id=?", oldAssignment);

    CompletableFuture<MvcResult> first =
        CompletableFuture.supplyAsync(() -> performDashboard(base, owner));
    CompletableFuture<MvcResult> second =
        CompletableFuture.supplyAsync(() -> performDashboard(base, owner));
    CompletableFuture.allOf(first, second).join();
    assertThat(first.join().getResponse().getStatus()).isEqualTo(200);
    assertThat(second.join().getResponse().getStatus()).isEqualTo(200);
    UUID assignmentId =
        jdbcTemplate.queryForObject(
            "SELECT id FROM chore_assignments WHERE chore_id=?", UUID.class, choreId);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_assignments WHERE chore_id=?", Integer.class, choreId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_assignment_assignees WHERE assignment_id=?",
                Integer.class,
                assignmentId))
        .isEqualTo(2);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(DISTINCT user_id) FROM chore_assignment_assignees WHERE assignment_id=?",
                Integer.class,
                assignmentId))
        .isEqualTo(2);
  }

  @Test
  void createRequiresAuthenticationAndCsrfAndValidInput() throws Exception {
    MvcResult anonymousCsrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
    CsrfResponse anonymousToken = readCsrf(anonymousCsrf);
    mockMvc
        .perform(
            post("/api/households")
                .cookie(anonymousCsrf.getResponse().getCookie("SESSION"))
                .header(anonymousToken.headerName(), anonymousToken.token())
                .contentType(APPLICATION_JSON)
                .content(validHouseholdJson()))
        .andExpect(status().isUnauthorized());

    WebSession owner = login("csrf-required");
    mockMvc
        .perform(
            post("/api/households")
                .cookie(owner.cookie())
                .contentType(APPLICATION_JSON)
                .content(validHouseholdJson()))
        .andExpect(status().isForbidden());

    mockMvc
        .perform(
            post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"name":"  ", "timezone":"America/Halifax"}
                        """))
        .andExpect(status().isBadRequest());

    mockMvc
        .perform(
            post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"name":"A", "timezone":"America/Halifax"}
                        """))
        .andExpect(status().isBadRequest());

    mockMvc
        .perform(
            post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(
                    """
                        {"name":"Valid Name", "timezone":"Mars/Olympus"}
                        """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("A valid IANA timezone is required."));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM households WHERE created_by_user_id = ?",
                Integer.class,
                UUID.fromString(owner.userId())))
        .isZero();
  }

  @Test
  void householdCreationRollsBackIfOwnerMembershipPersistenceFails() throws Exception {
    WebSession owner = login("rollback-owner");
    doAnswer(
            invocation -> {
              HouseholdMembership membership = invocation.getArgument(0);
              if (failOwnerMembershipSave.get() && membership.getRole() == HouseholdRole.OWNER) {
                throw new DataIntegrityViolationException("internal database detail");
              }
              return invocation.callRealMethod();
            })
        .when(householdMembershipRepository)
        .save(any(HouseholdMembership.class));
    failOwnerMembershipSave.set(true);

    mockMvc
        .perform(
            post("/api/households")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken())
                .contentType(APPLICATION_JSON)
                .content(validHouseholdJson()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("The request conflicts with existing data."));

    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM households WHERE created_by_user_id = ?",
                Integer.class,
                UUID.fromString(owner.userId())))
        .isZero();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE user_id = ?",
                Integer.class,
                UUID.fromString(owner.userId())))
        .isZero();
  }

  @Test
  void householdListContainsOnlyCurrentUsersActiveMemberships() throws Exception {
    WebSession userA = login("list-a");
    WebSession userB = login("list-b");
    createHousehold(userA, "A household", "UTC");
    createHousehold(userB, "B household", "UTC");

    mockMvc
        .perform(get("/api/households").cookie(userA.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1))
        .andExpect(jsonPath("$[0].name").value("A household"));

    UUID userAId = UUID.fromString(userA.userId());
    jdbcTemplate.update(
        "UPDATE household_memberships SET status = 'LEFT' WHERE user_id = ?", userAId);
    mockMvc
        .perform(get("/api/households").cookie(userA.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));

    mockMvc.perform(get("/api/households")).andExpect(status().isUnauthorized());
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

    mockMvc
        .perform(
            post(invitationPath(householdId))
                .cookie(member.cookie())
                .header(member.csrfHeader(), member.csrfToken()))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(
            post(invitationPath(householdId))
                .cookie(stranger.cookie())
                .header(stranger.csrfHeader(), stranger.csrfToken()))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
                INSERT INTO household_memberships (household_id, user_id, role, status, joined_at)
                VALUES (?, ?, 'ADMIN', 'ACTIVE', NOW())
                """,
        householdId,
        UUID.fromString(admin.userId()));
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
    var row =
        jdbcTemplate.queryForMap(
            "SELECT role_to_assign, expires_at, used_at, revoked_at FROM household_invitations WHERE household_id = ?",
            householdId);
    assertThat(row.get("role_to_assign")).isEqualTo("MEMBER");
    OffsetDateTime expiresAt =
        ((java.sql.Timestamp) row.get("expires_at")).toInstant().atOffset(java.time.ZoneOffset.UTC);
    assertThat(expiresAt).isBetween(beforeCreate.plusDays(7), afterCreate.plusDays(7));
    assertThat(row.get("used_at")).isNull();
    assertThat(row.get("revoked_at")).isNull();
  }

  @Test
  void joinActivatesOneMemberAndConsumesInvitationWithoutAcceptingPrivilegeInput()
      throws Exception {
    WebSession owner = login("join-owner");
    WebSession member = login("join-member");
    UUID householdId = createHousehold(owner, "Join Home", "UTC");
    String code = createInvitation(owner, householdId);

    MvcResult result =
        join(
                member,
                code,
                """
                {"inviteCode":"  %s  ","role":"OWNER","roleToAssign":"ADMIN","userId":"%s","householdId":"%s"}
                """
                    .formatted(code, owner.userId(), UUID.randomUUID()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.currentUserRole").value("MEMBER"))
            .andReturn();
    assertThat(
            objectMapper.readTree(result.getResponse().getContentAsString()).get("name").asText())
        .isEqualTo("Join Home");
    assertMembership(member, householdId, "MEMBER", "ACTIVE");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT used_at FROM household_invitations WHERE household_id = ?",
                java.sql.Timestamp.class,
                householdId))
        .isNotNull();
  }

  @Test
  void joinRejectsUnknownExpiredRevokedAndUsedCodesWithSameSafeMessage() throws Exception {
    WebSession owner = login("invalid-code-owner");
    WebSession member = login("invalid-code-member");
    UUID householdId = createHousehold(owner, "Invalid Code Home", "UTC");
    String expiredCode = createInvitation(owner, householdId);
    String revokedCode = createInvitation(owner, householdId);
    String usedCode = createInvitation(owner, householdId);
    jdbcTemplate.update(
        "UPDATE household_invitations SET expires_at = NOW() - INTERVAL '1 second' WHERE invite_code = ?",
        hash(expiredCode));
    jdbcTemplate.update(
        "UPDATE household_invitations SET revoked_at = NOW() WHERE invite_code = ?",
        hash(revokedCode));
    join(member, usedCode).andExpect(status().isOk());

    for (String code : new String[] {"unknown-code", expiredCode, revokedCode, usedCode}) {
      mockMvc
          .perform(
              post("/api/households/join")
                  .cookie(member.cookie())
                  .header(member.csrfHeader(), member.csrfToken())
                  .contentType(APPLICATION_JSON)
                  .content("{\"inviteCode\":\"" + code + "\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value(INVALID_INVITE_MESSAGE));
    }
  }

  @Test
  void activeMembershipConflictDoesNotConsumeInviteAndLeftOrInvitedMembershipReactivates()
      throws Exception {
    WebSession owner = login("reactivate-owner");
    WebSession member = login("reactivate-member");
    WebSession invitedUser = login("reactivate-invited");
    UUID householdId = createHousehold(owner, "Reactivate Home", "UTC");
    join(member, createInvitation(owner, householdId)).andExpect(status().isOk());
    String activeConflictInvite = createInvitation(owner, householdId);
    join(member, activeConflictInvite)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("You are already a member of this household."));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT used_at FROM household_invitations WHERE invite_code = ?",
                java.sql.Timestamp.class,
                hash(activeConflictInvite)))
        .isNull();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(member.userId())))
        .isEqualTo(1);

    jdbcTemplate.update(
        """
                UPDATE household_memberships
                SET role = 'ADMIN', status = 'LEFT', joined_at = NOW() - INTERVAL '1 day', left_at = NOW()
                WHERE household_id = ? AND user_id = ?
                """,
        householdId,
        UUID.fromString(member.userId()));
    String leftInvite = createInvitation(owner, householdId);
    join(member, leftInvite)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
    assertMembership(member, householdId, "MEMBER", "ACTIVE");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(member.userId())))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT left_at FROM household_memberships WHERE household_id = ? AND user_id = ?",
                java.sql.Timestamp.class,
                householdId,
                UUID.fromString(member.userId())))
        .isNull();

    jdbcTemplate.update(
        """
                INSERT INTO household_memberships (household_id, user_id, role, status)
                VALUES (?, ?, 'ADMIN', 'INVITED')
                """,
        householdId,
        UUID.fromString(invitedUser.userId()));
    String invitedMembershipCode = createInvitation(owner, householdId);
    join(invitedUser, invitedMembershipCode)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
    assertMembership(invitedUser, householdId, "MEMBER", "ACTIVE");
  }

  @Test
  void removedMembershipRejoinsOnlyWithNewValidInviteAndKeepsHistoryAndScheduleChanges()
      throws Exception {
    WebSession owner = login("removed-owner");
    WebSession removedUser = login("removed-user");
    WebSession inviteConsumer = login("removed-invite-consumer");
    UUID householdId = createHousehold(owner, "Removed Home", "UTC");
    join(removedUser, createInvitation(owner, householdId)).andExpect(status().isOk());
    jdbcTemplate.update(
        "UPDATE household_memberships SET role = 'ADMIN' WHERE household_id = ? AND user_id = ?",
        householdId,
        UUID.fromString(removedUser.userId()));

    UUID choreId = UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO chores (id, household_id, title, default_priority, difficulty, created_by_user_id)
                VALUES (?, ?, 'Rejoin schedule', 'NORMAL', 1, ?)
                """,
        choreId,
        householdId,
        UUID.fromString(owner.userId()));
    jdbcTemplate.update(
        """
                INSERT INTO chore_schedules
                    (household_id, chore_id, recurrence_rule, timezone, starts_on,
                     assignment_strategy, strategy_config)
                VALUES (?, ?, 'FREQ=DAILY', 'UTC', CURRENT_DATE, 'ROUND_ROBIN',
                        jsonb_build_object('peopleNeeded', 1, 'participantUserIds',
                            jsonb_build_array(?::text, ?::text)))
                """,
        householdId,
        choreId,
        owner.userId(),
        removedUser.userId());

    UUID historicalAssignmentId = UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO chore_assignments
                    (id, household_id, chore_id, scheduled_for, status, assigned_to_user_id,
                     title_snapshot, priority_snapshot, difficulty_snapshot)
                VALUES (?, ?, ?, CURRENT_DATE - 1, 'COMPLETED', ?, 'Old chore title', 'NORMAL', 1)
                """,
        historicalAssignmentId,
        householdId,
        choreId,
        UUID.fromString(removedUser.userId()));
    jdbcTemplate.update(
        """
                INSERT INTO chore_completions (household_id, assignment_id, completed_by_user_id)
                VALUES (?, ?, ?)
                """,
        householdId,
        historicalAssignmentId,
        UUID.fromString(removedUser.userId()));
    String futureNotificationKey = "removed-member-future-" + UUID.randomUUID();
    jdbcTemplate.update(
        """
                INSERT INTO notifications
                    (recipient_user_id, type, category, title, message, status, scheduled_at, deduplication_key)
                VALUES (?, 'CHORE_DUE_SOON', 'CHORE_REMINDER', 'Upcoming chore', 'Reminder',
                        'PENDING', NOW() + INTERVAL '1 day', ?)
                """,
        UUID.fromString(removedUser.userId()),
        futureNotificationKey);

    mockMvc
        .perform(
            post("/api/households/" + householdId + "/members/" + removedUser.userId() + "/remove")
                .cookie(owner.cookie())
                .header(owner.csrfHeader(), owner.csrfToken()))
        .andExpect(status().isOk());
    assertMembership(removedUser, householdId, "MEMBER", "REMOVED");
    mockMvc
        .perform(get("/api/households").cookie(removedUser.cookie()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM notifications WHERE deduplication_key = ?",
                String.class,
                futureNotificationKey))
        .isEqualTo("CANCELLED");
    java.sql.Timestamp removedAt =
        jdbcTemplate.queryForObject(
            "SELECT left_at FROM household_memberships WHERE household_id = ? AND user_id = ?",
            java.sql.Timestamp.class,
            householdId,
            UUID.fromString(removedUser.userId()));
    assertThat(removedAt).isNotNull();
    String participantIdsAfterRemoval =
        jdbcTemplate.queryForObject(
            "SELECT strategy_config -> 'participantUserIds' ->> 0 FROM chore_schedules WHERE chore_id = ?",
            String.class,
            choreId);
    assertThat(participantIdsAfterRemoval).isEqualTo(owner.userId());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_completions WHERE assignment_id = ?",
                Integer.class,
                historicalAssignmentId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM chore_assignments WHERE id = ?",
                String.class,
                historicalAssignmentId))
        .isEqualTo("COMPLETED");

    // Exercise legacy rows that still retain an elevated role after removal.
    jdbcTemplate.update(
        "UPDATE household_memberships SET role = 'ADMIN' WHERE household_id = ? AND user_id = ?",
        householdId,
        UUID.fromString(removedUser.userId()));

    String expiredCode = createInvitation(owner, householdId);
    String revokedCode = createInvitation(owner, householdId);
    String consumedCode = createInvitation(owner, householdId);
    jdbcTemplate.update(
        "UPDATE household_invitations SET expires_at = NOW() - INTERVAL '1 second' WHERE invite_code = ?",
        hash(expiredCode));
    jdbcTemplate.update(
        "UPDATE household_invitations SET revoked_at = NOW() WHERE invite_code = ?",
        hash(revokedCode));
    join(inviteConsumer, consumedCode).andExpect(status().isOk());

    for (String invalidCode : new String[] {expiredCode, revokedCode, consumedCode}) {
      join(removedUser, invalidCode)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value(INVALID_INVITE_MESSAGE));
      assertMembership(removedUser, householdId, "ADMIN", "REMOVED");
    }

    String newCode = createInvitation(owner, householdId);
    jdbcTemplate.update(
        "UPDATE household_invitations SET role_to_assign = 'ADMIN' WHERE invite_code = ?",
        hash(newCode));
    join(removedUser, newCode)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
    assertMembership(removedUser, householdId, "MEMBER", "ACTIVE");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(removedUser.userId())))
        .isEqualTo(1);
    java.sql.Timestamp joinedAt =
        jdbcTemplate.queryForObject(
            "SELECT joined_at FROM household_memberships WHERE household_id = ? AND user_id = ?",
            java.sql.Timestamp.class,
            householdId,
            UUID.fromString(removedUser.userId()));
    assertThat(joinedAt.toInstant()).isAfter(removedAt.toInstant());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT left_at FROM household_memberships WHERE household_id = ? AND user_id = ?",
                java.sql.Timestamp.class,
                householdId,
                UUID.fromString(removedUser.userId())))
        .isNull();
    assertThat(
            jdbcTemplate.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM chore_schedules schedule,
                         jsonb_array_elements_text(schedule.strategy_config -> 'participantUserIds') participant_id
                    WHERE schedule.chore_id = ? AND participant_id = ?
                )
                """,
                Boolean.class,
                choreId,
                removedUser.userId()))
        .isFalse();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM chore_completions WHERE assignment_id = ?",
                Integer.class,
                historicalAssignmentId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM activity_events WHERE household_id = ? AND event_type = 'MEMBER_REJOINED' AND entity_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(removedUser.userId())))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT used_at FROM household_invitations WHERE invite_code = ?",
                java.sql.Timestamp.class,
                hash(newCode)))
        .isNotNull();
  }

  @Test
  void inviteForAnotherHouseholdDoesNotReactivateOldMembership() throws Exception {
    WebSession ownerA = login("cross-household-owner-a");
    WebSession ownerB = login("cross-household-owner-b");
    WebSession formerMember = login("cross-household-former-member");
    UUID householdA = createHousehold(ownerA, "Old Household", "UTC");
    UUID householdB = createHousehold(ownerB, "Invited Household", "UTC");
    jdbcTemplate.update(
        """
                INSERT INTO household_memberships (household_id, user_id, role, status, left_at)
                VALUES (?, ?, 'OWNER', 'REMOVED', NOW())
                """,
        householdA,
        UUID.fromString(formerMember.userId()));

    join(formerMember, createInvitation(ownerB, householdB))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("Invited Household"))
        .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM household_memberships WHERE household_id = ? AND user_id = ?",
                String.class,
                householdA,
                UUID.fromString(formerMember.userId())))
        .isEqualTo("REMOVED");
    assertMembership(formerMember, householdB, "MEMBER", "ACTIVE");
    join(formerMember, createInvitation(ownerA, householdA))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
    assertMembership(formerMember, householdA, "MEMBER", "ACTIVE");
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
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND role = 'MEMBER' AND status = 'ACTIVE'",
                Integer.class,
                householdId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_invitations WHERE household_id = ? AND used_at IS NOT NULL",
                Integer.class,
                householdId))
        .isEqualTo(1);
  }

  @Test
  void simultaneousRedemptionReactivatesOneExistingMembershipOnce() throws Exception {
    WebSession owner = login("race-rejoin-owner");
    WebSession member = login("race-rejoin-member");
    UUID householdId = createHousehold(owner, "Race Rejoin Home", "UTC");
    jdbcTemplate.update(
        """
                INSERT INTO household_memberships (household_id, user_id, role, status, left_at)
                VALUES (?, ?, 'ADMIN', 'REMOVED', NOW() - INTERVAL '1 day')
                """,
        householdId,
        UUID.fromString(member.userId()));
    String code = createInvitation(owner, householdId);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);

    CompletableFuture<Integer> resultA = redeemConcurrently(member, code, ready, start);
    CompletableFuture<Integer> resultB = redeemConcurrently(member, code, ready, start);
    assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
    start.countDown();

    assertThat(
            java.util.List.of(resultA.get(30, TimeUnit.SECONDS), resultB.get(30, TimeUnit.SECONDS)))
        .containsExactlyInAnyOrder(200, 400);
    assertMembership(member, householdId, "MEMBER", "ACTIVE");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_memberships WHERE household_id = ? AND user_id = ?",
                Integer.class,
                householdId,
                UUID.fromString(member.userId())))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM household_invitations WHERE invite_code = ? AND used_at IS NOT NULL",
                Integer.class,
                hash(code)))
        .isEqualTo(1);
  }

  private CompletableFuture<Integer> redeemConcurrently(
      WebSession session, String code, CountDownLatch ready, CountDownLatch start) {
    return CompletableFuture.supplyAsync(
        () -> {
          ready.countDown();
          try {
            if (!start.await(10, TimeUnit.SECONDS)) {
              throw new IllegalStateException("Concurrent redemption test was not started.");
            }
            return mockMvc
                .perform(
                    post("/api/households/join")
                        .cookie(session.cookie())
                        .header(session.csrfHeader(), session.csrfToken())
                        .contentType(APPLICATION_JSON)
                        .content("{\"inviteCode\":\"" + code + "\"}"))
                .andReturn()
                .getResponse()
                .getStatus();
          } catch (Exception exception) {
            throw new IllegalStateException(exception);
          }
        });
  }

  private UUID createHousehold(WebSession session, String name, String timezone) throws Exception {
    MvcResult result =
        mockMvc
            .perform(
                post("/api/households")
                    .cookie(session.cookie())
                    .header(session.csrfHeader(), session.csrfToken())
                    .contentType(APPLICATION_JSON)
                    .content("{\"name\":\"" + name + "\",\"timezone\":\"" + timezone + "\"}"))
            .andExpect(status().isCreated())
            .andReturn();
    return UUID.fromString(
        objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText());
  }

  private String pushSubscriptionJson(String endpoint, String key, String auth) {
    return "{\"endpoint\":\""
        + endpoint
        + "\",\"publicKey\":\""
        + key
        + "\",\"authSecret\":\""
        + auth
        + "\"}";
  }

  private void insertRetentionNotification(UUID userId, String key, String readAtExpression) {
    jdbcTemplate.update(
        """
                INSERT INTO notifications
                    (recipient_user_id, type, category, title, message, status,
                     scheduled_at, sent_at, read_at, deduplication_key)
                VALUES (?, 'HOUSEHOLD_JOINED', 'HOUSEHOLD', 'Update', 'Body', 'SENT',
                        NOW(), NOW(), %s, ?)
                """
            .formatted(readAtExpression == null ? "NULL" : readAtExpression),
        userId,
        key);
  }

  private int notificationCount(String key) {
    return jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM notifications WHERE deduplication_key=?", Integer.class, key);
  }

  private void setNotificationPreferences(
      UUID userId,
      boolean remindersEnabled,
      boolean overdueEnabled,
      boolean competitiveEnabled,
      boolean householdEnabled,
      boolean pushEnabled) {
    jdbcTemplate.update(
        """
                INSERT INTO notification_preferences
                    (user_id, chore_reminders_enabled, overdue_enabled,
                     competitive_notifications_enabled, household_updates_enabled, push_enabled)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id) DO UPDATE SET
                    chore_reminders_enabled=EXCLUDED.chore_reminders_enabled,
                    overdue_enabled=EXCLUDED.overdue_enabled,
                    competitive_notifications_enabled=EXCLUDED.competitive_notifications_enabled,
                    household_updates_enabled=EXCLUDED.household_updates_enabled,
                    push_enabled=EXCLUDED.push_enabled
                """,
        userId,
        remindersEnabled,
        overdueEnabled,
        competitiveEnabled,
        householdEnabled,
        pushEnabled);
  }

  private int notificationCountByReference(UUID referenceId) {
    return jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM notifications WHERE reference_id=?", Integer.class, referenceId);
  }

  private String notificationStatus(UUID referenceId) {
    return jdbcTemplate.queryForObject(
        "SELECT status FROM notifications WHERE reference_id=?", String.class, referenceId);
  }

  private String notificationDeliveryStatus(UUID referenceId, String channel) {
    return jdbcTemplate.queryForObject(
        """
                SELECT d.status FROM notification_deliveries d
                JOIN notifications n ON n.id=d.notification_id
                WHERE n.reference_id=? AND d.channel=?
                """,
        String.class,
        referenceId,
        channel);
  }

  private String createInvitation(WebSession session, UUID householdId) throws Exception {
    MvcResult result =
        mockMvc
            .perform(
                post(invitationPath(householdId))
                    .cookie(session.cookie())
                    .header(session.csrfHeader(), session.csrfToken()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.expiresAt").isString())
            .andReturn();
    return objectMapper
        .readTree(result.getResponse().getContentAsString())
        .get("inviteCode")
        .asText();
  }

  private MvcResult performDashboard(String base, WebSession session) {
    try {
      return mockMvc.perform(get(base + "/dashboard").cookie(session.cookie())).andReturn();
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  private org.springframework.test.web.servlet.ResultActions join(WebSession session, String code)
      throws Exception {
    return join(session, code, "{\"inviteCode\":\"" + code + "\"}");
  }

  private org.springframework.test.web.servlet.ResultActions join(
      WebSession session, String code, String requestBody) throws Exception {
    return mockMvc.perform(
        post("/api/households/join")
            .cookie(session.cookie())
            .header(session.csrfHeader(), session.csrfToken())
            .contentType(APPLICATION_JSON)
            .content(requestBody));
  }

  private WebSession login(String prefix) throws Exception {
    String emailPrefix =
        prefix
            .substring(0, Math.min(prefix.length(), 8))
            .replaceAll("[^a-zA-Z0-9]", "")
            .toLowerCase(java.util.Locale.ROOT);
    String email = "hhtest-" + emailPrefix + "-" + UUID.randomUUID() + "@example.com";
    authService.register(new RegisterRequest("Test User", email, PASSWORD));
    User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();

    MvcResult initialCsrfResult = mockMvc.perform(get("/api/auth/csrf")).andReturn();
    CsrfResponse initialCsrf = readCsrf(initialCsrfResult);
    MvcResult loginResult =
        mockMvc
            .perform(
                post("/api/auth/login")
                    .cookie(initialCsrfResult.getResponse().getCookie("SESSION"))
                    .header(initialCsrf.headerName(), initialCsrf.token())
                    .contentType(APPLICATION_JSON)
                    .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
            .andReturn();
    assertThat(loginResult.getResponse().getStatus())
        .as("login response: %s", loginResult.getResponse().getContentAsString())
        .isEqualTo(200);
    Cookie cookie = loginResult.getResponse().getCookie("SESSION");
    MvcResult authenticatedCsrfResult =
        mockMvc.perform(get("/api/auth/csrf").cookie(cookie)).andReturn();
    CsrfResponse csrf = readCsrf(authenticatedCsrfResult);
    return new WebSession(cookie, csrf.headerName(), csrf.token(), user.getId().toString());
  }

  private CsrfResponse readCsrf(MvcResult result) throws Exception {
    return objectMapper.readValue(result.getResponse().getContentAsString(), CsrfResponse.class);
  }

  private void assertMembership(
      WebSession session, UUID householdId, String role, String membershipStatus) {
    assertThat(
            jdbcTemplate.queryForMap(
                """
                SELECT role, status, joined_at
                FROM household_memberships
                WHERE household_id = ? AND user_id = ?
                """,
                householdId,
                UUID.fromString(session.userId())))
        .containsEntry("role", role)
        .containsEntry("status", membershipStatus)
        .containsKey("joined_at");
  }

  private void assertInvitationStoredAsHash(String rawCode, UUID householdId) throws Exception {
    String storedHash =
        jdbcTemplate.queryForObject(
            "SELECT invite_code FROM household_invitations WHERE household_id = ? ORDER BY created_at DESC LIMIT 1",
            String.class,
            householdId);
    assertThat(storedHash).hasSize(64).isEqualTo(hash(rawCode)).isNotEqualTo(rawCode);
  }

  private String hash(String rawCode) throws Exception {
    return HexFormat.of()
        .formatHex(
            MessageDigest.getInstance("SHA-256").digest(rawCode.getBytes(StandardCharsets.UTF_8)));
  }

  private String invitationPath(UUID householdId) {
    return "/api/households/" + householdId + "/invitations";
  }

  private String validHouseholdJson() {
    return "{\"name\":\"Valid Home\",\"timezone\":\"UTC\"}";
  }

  private void clearHouseholdData() {
    String testUsers = "SELECT id FROM users WHERE email LIKE 'hhtest-%@example.com'";
    String testHouseholds =
        "SELECT id FROM households WHERE created_by_user_id IN (" + testUsers + ")";
    jdbcTemplate.update(
        "DELETE FROM household_invitations WHERE household_id IN ("
            + testHouseholds
            + ") OR created_by_user_id IN ("
            + testUsers
            + ")");
    jdbcTemplate.update(
        "DELETE FROM notifications WHERE recipient_user_id IN ("
            + testUsers
            + ") OR event_id IN (SELECT id FROM notification_events WHERE household_id IN ("
            + testHouseholds
            + ") OR actor_user_id IN ("
            + testUsers
            + "))");
    jdbcTemplate.update(
        "DELETE FROM notification_events WHERE household_id IN ("
            + testHouseholds
            + ") OR actor_user_id IN ("
            + testUsers
            + ")");
    jdbcTemplate.update(
        "DELETE FROM notification_preferences WHERE user_id IN (" + testUsers + ")");
    jdbcTemplate.update(
        "DELETE FROM activity_events WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update(
        "DELETE FROM chore_completions WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update(
        "DELETE FROM chore_assignment_assignees WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update(
        "DELETE FROM chore_assignments WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update(
        "DELETE FROM chore_schedules WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update("DELETE FROM chores WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update(
        "DELETE FROM chore_categories WHERE household_id IN (" + testHouseholds + ")");
    jdbcTemplate.update(
        "DELETE FROM household_memberships WHERE household_id IN ("
            + testHouseholds
            + ") OR user_id IN ("
            + testUsers
            + ")");
    jdbcTemplate.update("DELETE FROM households WHERE id IN (" + testHouseholds + ")");
    jdbcTemplate.update("DELETE FROM users WHERE email LIKE 'hhtest-%@example.com'");
  }

  private record WebSession(Cookie cookie, String csrfHeader, String csrfToken, String userId) {}
}
