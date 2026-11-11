package com.dirtyduty.app.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.notification.WebPushClient;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(
    properties = {
      "app.notifications.scheduler-delay=3600000",
      "app.notifications.scheduler-initial-delay=3600000",
      "app.chores.generation.enabled=false"
    })
@AutoConfigureMockMvc
class ChoreCategoryIntegrationTest {
  private static final String PASSWORD = "StrongPassword123!";
  private static final String DUPLICATE = "A category with this name already exists.";
  private static final List<String> DEFAULT_NAMES =
      List.of("Kitchen", "Bathroom", "Laundry", "Trash", "Cleaning", "General");
  private static final List<String> DEFAULT_ICONS =
      List.of("kitchen", "bathroom", "laundry", "trash", "broom", "home");

  @Autowired private MockMvc mockMvc;
  @Autowired private AuthService authService;
  @Autowired private UserRepository userRepository;
  @MockitoSpyBean private JdbcTemplate jdbc;
  @MockitoBean private WebPushClient webPushClient;
  private final ObjectMapper objectMapper = new ObjectMapper();

  @BeforeEach
  @AfterEach
  void clean() {
    String users = "SELECT id FROM users WHERE email LIKE 'cattest-%@example.com'";
    String households = "SELECT id FROM households WHERE created_by_user_id IN (" + users + ")";
    for (String table :
        List.of(
            "household_invitations",
            "activity_events",
            "chore_completions",
            "chore_assignment_assignees",
            "chore_assignments")) {
      jdbc.update("DELETE FROM " + table + " WHERE household_id IN (" + households + ")");
    }
    jdbc.update(
        "DELETE FROM notifications WHERE recipient_user_id IN ("
            + users
            + ") OR event_id IN (SELECT id FROM notification_events WHERE household_id IN ("
            + households
            + "))");
    jdbc.update("DELETE FROM notification_events WHERE household_id IN (" + households + ")");
    jdbc.update(
        "DELETE FROM recurring_chore_assignment_announcements WHERE schedule_id IN "
            + "(SELECT id FROM chore_schedules WHERE household_id IN ("
            + households
            + "))");
    for (String table :
        List.of("chore_schedules", "chores", "chore_categories", "household_memberships")) {
      jdbc.update("DELETE FROM " + table + " WHERE household_id IN (" + households + ")");
    }
    jdbc.update("DELETE FROM households WHERE id IN (" + households + ")");
    jdbc.update("DELETE FROM notification_preferences WHERE user_id IN (" + users + ")");
    jdbc.update("DELETE FROM users WHERE id IN (" + users + ")");
  }

  @Test
  void householdCreationStillSeedsTheSixDefaultsInOrder() throws Exception {
    WebSession owner = login("seed");
    UUID householdId = createHousehold(owner, "Seeded");

    JsonNode categories = listCategories(owner, householdId);
    assertThat(names(categories)).containsExactlyElementsOf(DEFAULT_NAMES);
    List<String> icons = new ArrayList<>();
    categories.forEach(category -> icons.add(category.get("iconKey").asText()));
    assertThat(icons).containsExactlyElementsOf(DEFAULT_ICONS);
    categories.forEach(category -> assertThat(category.get("choreCount").asLong()).isZero());
  }

  @Test
  void ownerAndAdminCreateRenameReorderAndDelete() throws Exception {
    WebSession owner = login("owner");
    UUID householdId = createHousehold(owner, "Managed");
    WebSession admin = login("admin");
    join(admin, createInvitation(owner, householdId));
    jdbc.update(
        "UPDATE household_memberships SET role='ADMIN' WHERE household_id=? AND user_id=?",
        householdId,
        UUID.fromString(admin.userId()));

    for (WebSession actor : List.of(owner, admin)) {
      String name = actor == owner ? "Pets" : "Garden";
      MvcResult created =
          write(actor, post(categories(householdId)), body("  " + name + "  ", "pets"))
              .andExpect(status().isCreated())
              .andExpect(jsonPath("$.name").value(name))
              .andExpect(jsonPath("$.iconKey").value("pets"))
              .andExpect(jsonPath("$.choreCount").value(0))
              .andReturn();
      UUID id = idOf(created);
      List<String> afterCreate = names(listCategories(owner, householdId));
      assertThat(afterCreate.getLast()).as("new categories go last").isEqualTo(name);

      write(actor, put(categories(householdId) + "/" + id), body(name + " care", "plants"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.name").value(name + " care"))
          .andExpect(jsonPath("$.iconKey").value("plants"));

      List<String> ids = ids(listCategories(owner, householdId));
      List<String> reversed = new ArrayList<>(ids.reversed());
      write(actor, put(categories(householdId) + "/order"), orderBody(reversed))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$[0].id").value(reversed.getFirst()));
      assertThat(ids(listCategories(owner, householdId))).containsExactlyElementsOf(reversed);

      write(actor, delete(categories(householdId) + "/" + id), null)
          .andExpect(status().isNoContent());
      assertThat(ids(listCategories(owner, householdId))).doesNotContain(id.toString());
    }
  }

  @Test
  void memberIsRejectedOnEveryWrite() throws Exception {
    WebSession owner = login("owner");
    UUID householdId = createHousehold(owner, "Members");
    WebSession member = login("member");
    join(member, createInvitation(owner, householdId));
    String kitchen = ids(listCategories(owner, householdId)).getFirst();
    List<String> ids = ids(listCategories(owner, householdId));

    write(member, post(categories(householdId)), body("Pets", "pets"))
        .andExpect(status().isForbidden());
    write(member, put(categories(householdId) + "/" + kitchen), body("Cooking", "kitchen"))
        .andExpect(status().isForbidden());
    write(member, put(categories(householdId) + "/order"), orderBody(ids.reversed()))
        .andExpect(status().isForbidden());
    write(member, delete(categories(householdId) + "/" + kitchen), null)
        .andExpect(status().isForbidden());
    mockMvc
        .perform(get(categories(householdId)).cookie(member.cookie()))
        .andExpect(status().isForbidden());

    assertThat(names(listCategories(owner, householdId))).containsExactlyElementsOf(DEFAULT_NAMES);
  }

  @Test
  void duplicateNamesAreRejectedCaseInsensitively() throws Exception {
    WebSession owner = login("dupe");
    UUID householdId = createHousehold(owner, "Dupes");
    String laundry = ids(listCategories(owner, householdId)).get(2);

    write(owner, post(categories(householdId)), body("  kITCHEN ", "kitchen"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(DUPLICATE));
    write(owner, put(categories(householdId) + "/" + laundry), body("TRASH", "laundry"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(DUPLICATE));
    // Changing only the case of its own name is allowed.
    write(owner, put(categories(householdId) + "/" + laundry), body("LAUNDRY", "laundry"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("LAUNDRY"));
  }

  @Test
  void concurrentCreatesWithTheSameNameLetExactlyOneWin() throws Exception {
    WebSession owner = login("race");
    UUID householdId = createHousehold(owner, "Race");
    CountDownLatch start = new CountDownLatch(1);
    List<CompletableFuture<MvcResult>> requests = new ArrayList<>();
    for (String name : List.of("Pets", "pets")) {
      requests.add(
          CompletableFuture.supplyAsync(
              () -> {
                try {
                  start.await(5, TimeUnit.SECONDS);
                  return write(owner, post(categories(householdId)), body(name, "pets"))
                      .andReturn();
                } catch (Exception exception) {
                  throw new IllegalStateException(exception);
                }
              }));
    }
    start.countDown();
    List<Integer> statuses = new ArrayList<>();
    for (CompletableFuture<MvcResult> request : requests) {
      MvcResult result = request.get(20, TimeUnit.SECONDS);
      statuses.add(result.getResponse().getStatus());
      if (result.getResponse().getStatus() == 409) {
        assertThat(result.getResponse().getContentAsString()).contains(DUPLICATE);
      }
    }
    assertThat(statuses).containsExactlyInAnyOrder(201, 409);
  }

  @Test
  void aUniqueIndexViolationThatSlipsPastTheCheckGetsTheSameMessage() throws Exception {
    WebSession owner = login("index");
    UUID householdId = createHousehold(owner, "Index");
    // Make the pre-check miss, as a writer that bypassed the household lock would.
    doReturn(false)
        .when(jdbc)
        .queryForObject(
            argThat((String sql) -> sql != null && sql.contains("LOWER(name)=LOWER(?)")),
            eq(Boolean.class),
            any(),
            any(),
            any());

    write(owner, post(categories(householdId)), body("kitchen", "kitchen"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(DUPLICATE));
    assertThat(names(listCategories(owner, householdId))).containsExactlyElementsOf(DEFAULT_NAMES);
  }

  @Test
  void validatesNameIconAndTheFortyCategoryCap() throws Exception {
    WebSession owner = login("valid");
    UUID householdId = createHousehold(owner, "Validation");

    write(owner, post(categories(householdId)), body("   ", "pets"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Enter a category name."));
    write(owner, post(categories(householdId)), body("x".repeat(41), "pets"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Category names can be at most 40 characters."));
    write(owner, post(categories(householdId)), body("Rockets", "rocket"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Choose an icon for this category."));
    write(owner, post(categories(householdId)), "{\"name\":\"No icon\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Choose an icon for this category."));
    write(owner, post(categories(householdId)), body("x".repeat(40), "broom"))
        .andExpect(status().isCreated());

    // 6 defaults + 1 above; fill up to 40.
    for (int index = 7; index < 40; index++) {
      write(owner, post(categories(householdId)), body("Extra " + index, "general"))
          .andExpect(status().isCreated());
    }
    write(owner, post(categories(householdId)), body("One too many", "general"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("A household can have at most 40 categories."));
    assertThat(listCategories(owner, householdId).size()).isEqualTo(40);
  }

  @Test
  void reorderMustListExactlyTheHouseholdsCategories() throws Exception {
    WebSession owner = login("order");
    UUID householdId = createHousehold(owner, "Order");
    UUID otherHousehold = createHousehold(login("orderother"), "Other");
    List<String> ids = ids(listCategories(owner, householdId));
    String foreign =
        jdbc.queryForObject(
                "SELECT id FROM chore_categories WHERE household_id=? LIMIT 1",
                UUID.class,
                otherHousehold)
            .toString();
    String message = "The new order must list every category in this household exactly once.";

    List<List<String>> invalid = new ArrayList<>();
    invalid.add(ids.subList(1, ids.size()));
    List<String> withForeign = new ArrayList<>(ids.subList(1, ids.size()));
    withForeign.add(foreign);
    invalid.add(withForeign);
    List<String> duplicated = new ArrayList<>(ids.subList(1, ids.size()));
    duplicated.add(ids.get(1));
    invalid.add(duplicated);
    List<String> extra = new ArrayList<>(ids);
    extra.add(foreign);
    invalid.add(extra);
    for (List<String> order : invalid) {
      write(owner, put(categories(householdId) + "/order"), orderBody(order))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value(message));
    }
    assertThat(ids(listCategories(owner, householdId))).containsExactlyElementsOf(ids);
  }

  @Test
  void anotherHouseholdsCategoryIsNotFound() throws Exception {
    WebSession owner = login("scope");
    UUID householdId = createHousehold(owner, "Mine");
    WebSession other = login("scopeother");
    UUID otherHousehold = createHousehold(other, "Theirs");
    String foreign = ids(listCategories(other, otherHousehold)).getFirst();

    write(owner, put(categories(householdId) + "/" + foreign), body("Stolen", "kitchen"))
        .andExpect(status().isNotFound());
    write(owner, delete(categories(householdId) + "/" + foreign), null)
        .andExpect(status().isNotFound());
    write(owner, put(categories(householdId) + "/" + UUID.randomUUID()), body("Gone", "kitchen"))
        .andExpect(status().isNotFound());
    assertThat(names(listCategories(other, otherHousehold)))
        .containsExactlyElementsOf(DEFAULT_NAMES);
  }

  @Test
  void deleteClearsTheCategoryFromChoresInEveryStateAndKeepsHistoryReadable() throws Exception {
    WebSession owner = login("delete");
    UUID householdId = createHousehold(owner, "Deletes");
    String base = "/api/households/" + householdId;
    String laundry = ids(listCategories(owner, householdId)).get(2);
    UUID active = createChore(owner, householdId, "Wash towels", laundry);
    UUID paused = createChore(owner, householdId, "Fold sheets", laundry);
    UUID archived = createChore(owner, householdId, "Iron shirts", laundry);
    write(owner, post(base + "/chores/" + paused + "/pause"), null).andExpect(status().isOk());

    // Complete today's occurrence of the active chore so there is history.
    JsonNode upcoming = read(owner, base + "/my-chores");
    String assignment = null;
    for (JsonNode item : upcoming) {
      if (item.get("choreId").asText().equals(active.toString())) {
        assignment = item.get("id").asText();
        assertThat(item.get("categoryName").asText()).isEqualTo("Laundry");
        break;
      }
    }
    assertThat(assignment).isNotNull();
    write(owner, post(base + "/assignments/" + assignment + "/complete"), null)
        .andExpect(status().isOk());
    write(owner, post(base + "/chores/" + archived + "/archive"), null).andExpect(status().isOk());
    assertThat(listCategories(owner, householdId).get(2).get("choreCount").asLong())
        .as("archived chores are not counted")
        .isEqualTo(2);

    write(owner, delete(categories(householdId) + "/" + laundry), null)
        .andExpect(status().isNoContent());

    for (UUID chore : List.of(active, paused, archived)) {
      assertThat(
              jdbc.queryForObject("SELECT category_id FROM chores WHERE id=?", UUID.class, chore))
          .isNull();
    }
    JsonNode chores = read(owner, base + "/chores?includeArchived=true");
    assertThat(chores.size()).isEqualTo(3);
    chores.forEach(chore -> assertThat(chore.get("categoryId").isNull()).isTrue());
    JsonNode completed = read(owner, base + "/my-chores?status=COMPLETED");
    assertThat(completed.size()).isEqualTo(1);
    assertThat(completed.get(0).get("categoryName").isNull()).isTrue();
    assertThat(completed.get(0).get("categoryIcon").isNull()).isTrue();
    read(owner, base + "/dashboard");
    read(owner, base + "/my-chores");
    read(owner, base + "/chore-management-options");
  }

  @Test
  void deletingEveryCategoryDoesNotReseedTheDefaults() throws Exception {
    WebSession owner = login("empty");
    UUID householdId = createHousehold(owner, "Empty");
    for (String id : ids(listCategories(owner, householdId))) {
      write(owner, delete(categories(householdId) + "/" + id), null)
          .andExpect(status().isNoContent());
    }

    assertThat(listCategories(owner, householdId).size()).isZero();
    JsonNode options = read(owner, "/api/households/" + householdId + "/chore-management-options");
    assertThat(options.get("categories").size()).isZero();
    assertThat(listCategories(owner, householdId).size()).isZero();
  }

  private UUID createChore(WebSession owner, UUID householdId, String title, String categoryId)
      throws Exception {
    String request =
        """
            {
              "title": "%s",
              "categoryId": "%s",
              "defaultPriority": "NORMAL",
              "difficulty": 2,
              "requiresVerification": false,
              "schedule": {
                "recurrenceRule": "FREQ=DAILY",
                "timezone": "UTC",
                "startsOn": "%s",
                "dueTime": "23:59",
                "assignmentStrategy": "FIXED",
                "fixedAssigneeUserId": "%s"
              }
            }
            """
            .formatted(title, categoryId, LocalDate.now(ZoneOffset.UTC), owner.userId());
    return idOf(
        write(owner, post("/api/households/" + householdId + "/chores"), request)
            .andExpect(status().isCreated())
            .andReturn());
  }

  private static String categories(UUID householdId) {
    return "/api/households/" + householdId + "/chore-categories";
  }

  private static String body(String name, String iconKey) {
    return "{\"name\":\"%s\",\"iconKey\":\"%s\"}".formatted(name, iconKey);
  }

  private String orderBody(List<String> ids) throws Exception {
    return objectMapper.writeValueAsString(java.util.Map.of("categoryIds", ids));
  }

  private ResultActions write(
      WebSession session,
      org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
      String json)
      throws Exception {
    request.cookie(session.cookie()).header(session.csrfHeader(), session.csrfToken());
    if (json != null) {
      request.contentType(APPLICATION_JSON).content(json);
    }
    return mockMvc.perform(request);
  }

  private JsonNode read(WebSession session, String path) throws Exception {
    MvcResult result =
        mockMvc.perform(get(path).cookie(session.cookie())).andExpect(status().isOk()).andReturn();
    return objectMapper.readTree(result.getResponse().getContentAsString());
  }

  private JsonNode listCategories(WebSession session, UUID householdId) throws Exception {
    return read(session, categories(householdId));
  }

  private static List<String> names(JsonNode categories) {
    List<String> names = new ArrayList<>();
    categories.forEach(category -> names.add(category.get("name").asText()));
    return names;
  }

  private static List<String> ids(JsonNode categories) {
    List<String> ids = new ArrayList<>();
    categories.forEach(category -> ids.add(category.get("id").asText()));
    return ids;
  }

  private UUID idOf(MvcResult result) throws Exception {
    return UUID.fromString(
        objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText());
  }

  private UUID createHousehold(WebSession session, String name) throws Exception {
    return idOf(
        write(session, post("/api/households"), "{\"name\":\"" + name + "\",\"timezone\":\"UTC\"}")
            .andExpect(status().isCreated())
            .andReturn());
  }

  private String createInvitation(WebSession session, UUID householdId) throws Exception {
    MvcResult result =
        write(session, post("/api/households/" + householdId + "/invitations"), null)
            .andExpect(status().isCreated())
            .andReturn();
    return objectMapper
        .readTree(result.getResponse().getContentAsString())
        .get("inviteCode")
        .asText();
  }

  private void join(WebSession session, String code) throws Exception {
    write(session, post("/api/households/join"), "{\"inviteCode\":\"" + code + "\"}")
        .andExpect(status().isOk());
  }

  private WebSession login(String prefix) throws Exception {
    String email = "cattest-" + prefix + "-" + UUID.randomUUID() + "@example.com";
    authService.register(new RegisterRequest("Category Tester", email, PASSWORD));
    User user = userRepository.findByEmailIgnoreCase(email).orElseThrow();
    MvcResult initial = mockMvc.perform(get("/api/auth/csrf")).andReturn();
    CsrfResponse initialCsrf = readCsrf(initial);
    MvcResult login =
        mockMvc
            .perform(
                post("/api/auth/login")
                    .cookie(initial.getResponse().getCookie("SESSION"))
                    .header(initialCsrf.headerName(), initialCsrf.token())
                    .contentType(APPLICATION_JSON)
                    .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
            .andExpect(status().isOk())
            .andReturn();
    Cookie cookie = login.getResponse().getCookie("SESSION");
    CsrfResponse csrf = readCsrf(mockMvc.perform(get("/api/auth/csrf").cookie(cookie)).andReturn());
    return new WebSession(cookie, csrf.headerName(), csrf.token(), user.getId().toString());
  }

  private CsrfResponse readCsrf(MvcResult result) throws Exception {
    return objectMapper.readValue(result.getResponse().getContentAsString(), CsrfResponse.class);
  }

  private record WebSession(Cookie cookie, String csrfHeader, String csrfToken, String userId) {}
}
