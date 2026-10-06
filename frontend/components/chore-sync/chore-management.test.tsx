// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"
import { clearCsrfToken } from "@/lib/auth/api"

const fetchMock = vi.fn<typeof fetch>()
const user = {
  userId: "user-1",
  displayName: "Jahid",
  email: "jahid@example.com",
  emailVerified: true,
}
const household = {
  id: "home-1",
  name: "Apartment 305",
  timezone: "America/Sao_Paulo",
  currentUserRole: "OWNER",
  createdAt: "2026-09-25T12:00:00Z",
}
const dashboard = {
  weekSummary: { completedCount: 0, totalCount: 0, completionPercentage: 0 },
  today: [],
  thisWeek: [],
}
const options = {
  categories: [
    {
      id: "category-1",
      name: "Kitchen",
      iconKey: "🧹",
      sortOrder: 0,
      createdAt: "2026-09-25T12:00:00Z",
    },
  ],
  activeMembers: [
    { userId: "user-1", displayName: "Jahid" },
    { userId: "user-2", displayName: "Ahmed" },
  ],
}
const savedChore = {
  id: "chore-1",
  householdId: household.id,
  categoryId: "category-1",
  title: "Clean Kitchen",
  description: "Wipe counters",
  defaultPriority: "NORMAL",
  difficulty: 3,
  estimatedMinutes: 20,
  requiresVerification: false,
  active: true,
  archivedAt: null,
  createdAt: "2026-09-25T12:00:00Z",
  updatedAt: "2026-09-25T12:00:00Z",
  schedule: {
    recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    timezone: "America/Sao_Paulo",
    startsOn: "2026-09-28",
    endsOn: null,
    dueTime: "18:00:00",
    assignmentStrategy: "FIXED",
    peopleNeeded: 1,
    fixedAssigneeUserId: "user-1",
    participantUserIds: [],
    active: true,
  },
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function openHousehold() {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(user))
    .mockResolvedValueOnce(jsonResponse([household]))
    .mockResolvedValueOnce(jsonResponse(dashboard))
  render(<AppShell />)
  await screen.findByText("Today")
  fireEvent.click(screen.getByRole("button", { name: "Household" }))
}

async function enterChores() {
  fireEvent.click(screen.getByRole("button", { name: /Manage Chores/ }))
  await screen.findByRole("heading", { name: "Household Management" })
}

describe("chore management", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    clearCsrfToken()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearCsrfToken()
  })

  it("distinguishes loading from empty chore state", async () => {
    let resolveList!: (response: Response) => void
    await openHousehold()
    fetchMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveList = resolve
        }),
      )
      .mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    expect(screen.getByLabelText("Loading chores")).toBeTruthy()
    resolveList(jsonResponse([]))
    expect(await screen.findByText("No chores yet")).toBeTruthy()
    expect(screen.getByText("Create your first chore and keep the household moving.")).toBeTruthy()
  })

  it("shows a recoverable error instead of treating a failed request as empty", async () => {
    await openHousehold()
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to connect to DirtyDuty. Please try again.",
    )
    expect(screen.queryByText("No chores yet")).toBeNull()
  })

  it("renders backend chore definitions and persists pause lifecycle actions", async () => {
    await openHousehold()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([savedChore]))
      .mockResolvedValueOnce(jsonResponse(options))
    await enterChores()

    expect(await screen.findByRole("heading", { name: "Clean Kitchen" })).toBeTruthy()
    expect(screen.getByText("Every Monday · 6:00 PM")).toBeTruthy()
    expect(screen.getByText("Fixed · Jahid · Effort 3/5 · ~20 min")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Actions for Clean Kitchen" }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "lifecycle-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ ...savedChore, active: false }))
      .mockResolvedValueOnce(
        jsonResponse([
          { ...savedChore, active: false, schedule: { ...savedChore.schedule, active: false } },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, request]) =>
            url === "http://localhost:8080/api/households/home-1/chores/chore-1/pause" &&
            request?.method === "POST",
        ),
      ).toBe(true),
    )
    expect(await screen.findByText("Paused")).toBeTruthy()
  })

  it("creates a real weekly chore using the household timezone and selected category", async () => {
    await openHousehold()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse({ token: "chore-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ id: "chore-1" }, 201))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    await screen.findByText("No chores yet")

    fireEvent.click(screen.getByRole("button", { name: "Create a chore" }))
    await screen.findByRole("heading", { name: "Create Chore" })
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "category-1" } })
    fireEvent.change(screen.getByPlaceholderText("e.g. Clean Kitchen"), {
      target: { value: "  Clean Kitchen  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Chore" }))

    await screen.findByRole("heading", { name: "Household Management" })
    const createRequest = fetchMock.mock.calls.find(
      ([url, request]) =>
        url === "http://localhost:8080/api/households/home-1/chores" && request?.method === "POST",
    )
    expect(JSON.parse(String(createRequest?.[1]?.body))).toMatchObject({
      title: "Clean Kitchen",
      categoryId: "category-1",
      defaultPriority: "NORMAL",
      difficulty: 3,
      schedule: expect.objectContaining({
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
        timezone: "America/Sao_Paulo",
        assignmentStrategy: "FIXED",
        peopleNeeded: 1,
        fixedAssigneeUserId: "user-1",
        participantUserIds: [],
      }),
    })
    expect(new Headers(createRequest?.[1]?.headers).get("X-CSRF-TOKEN")).toBe("chore-csrf")
  })

  it("loads and updates an existing chore through the shared form", async () => {
    await openHousehold()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([savedChore]))
      .mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    await screen.findByRole("heading", { name: "Clean Kitchen" })

    fireEvent.click(screen.getByRole("button", { name: "Actions for Clean Kitchen" }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse(savedChore))
      .mockResolvedValueOnce(jsonResponse({ token: "edit-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ ...savedChore, title: "Wipe Kitchen" }))
      .mockResolvedValueOnce(jsonResponse([{ ...savedChore, title: "Wipe Kitchen" }]))
      .mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    expect(await screen.findByRole("heading", { name: "Edit Chore" })).toBeTruthy()
    expect(await screen.findByDisplayValue("Clean Kitchen")).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue("Clean Kitchen"), {
      target: { value: "Wipe Kitchen" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }))
    expect(await screen.findByRole("heading", { name: "Wipe Kitchen" })).toBeTruthy()

    const updateRequest = fetchMock.mock.calls.find(
      ([url, request]) =>
        url === "http://localhost:8080/api/households/home-1/chores/chore-1" &&
        request?.method === "PUT",
    )
    expect(JSON.parse(String(updateRequest?.[1]?.body))).toMatchObject({
      title: "Wipe Kitchen",
      categoryId: "category-1",
      schedule: {
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
        timezone: "America/Sao_Paulo",
        assignmentStrategy: "FIXED",
      },
    })
  })

  it("confirms archive, preserves the chore through the lifecycle API, and removes it from the active list", async () => {
    await openHousehold()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([savedChore]))
      .mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    await screen.findByRole("heading", { name: "Clean Kitchen" })

    fireEvent.click(screen.getByRole("button", { name: "Actions for Clean Kitchen" }))
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    expect(screen.getByRole("dialog", { name: "Archive chore?" })).toBeTruthy()
    expect(screen.getByText(/Its history will be preserved/)).toBeTruthy()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "archive-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(
        jsonResponse({ ...savedChore, active: false, archivedAt: "2026-09-27T12:00:00Z" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))

    expect(await screen.findByText("No chores yet")).toBeTruthy()
    expect(
      fetchMock.mock.calls.some(
        ([url, request]) =>
          url === "http://localhost:8080/api/households/home-1/chores/chore-1/archive" &&
          request?.method === "POST",
      ),
    ).toBe(true)
  })

  it("asks before discarding a dirty create form and lets the user keep editing", async () => {
    await openHousehold()
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    await screen.findByText("No chores yet")
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Create a chore" }))
    await screen.findByRole("heading", { name: "Create Chore" })

    fireEvent.change(screen.getByPlaceholderText("e.g. Clean Kitchen"), {
      target: { value: "New chore" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Back to chores" }))
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(screen.getByRole("heading", { name: "Create Chore" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Back to chores" }))
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(await screen.findByRole("heading", { name: "Household Management" })).toBeTruthy()
  })

  it("requires exactly K fixed members and persists multi-person scheduling", async () => {
    await openHousehold()
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    await screen.findByText("No chores yet")

    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Create a chore" }))
    await screen.findByRole("heading", { name: "Create Chore" })
    fireEvent.change(screen.getByPlaceholderText("e.g. Clean Kitchen"), {
      target: { value: "Move Sofa" },
    })
    fireEvent.change(screen.getByLabelText("People Needed"), { target: { value: "2" } })
    expect(screen.getByText("Select exactly 2 members")).toBeTruthy()
    expect(screen.queryByText("Require completion verification")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Ahmed" }))
    fireEvent.click(screen.getByRole("button", { name: "Create Chore" }))
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Choose exactly 2 members for this chore.",
    )
    expect(
      fetchMock.mock.calls.some(
        ([url, request]) =>
          url === "http://localhost:8080/api/households/home-1/chores" &&
          request?.method === "POST",
      ),
    ).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "Jahid" }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "multi-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ id: "chore-multi" }, 201))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Create Chore" }))
    await screen.findByRole("heading", { name: "Household Management" })

    const createRequest = fetchMock.mock.calls.find(
      ([url, request]) =>
        url === "http://localhost:8080/api/households/home-1/chores" && request?.method === "POST",
    )
    expect(JSON.parse(String(createRequest?.[1]?.body))).toMatchObject({
      title: "Move Sofa",
      schedule: {
        assignmentStrategy: "FIXED",
        peopleNeeded: 2,
        fixedAssigneeUserId: null,
        participantUserIds: expect.arrayContaining(["user-1", "user-2"]),
      },
    })
  })

  it("explains the fair rotation ratio and does not save when the eligible pool is too small", async () => {
    await openHousehold()
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse(options))
    await enterChores()
    await screen.findByText("No chores yet")
    fetchMock.mockResolvedValueOnce(jsonResponse(options))
    fireEvent.click(screen.getByRole("button", { name: "Create a chore" }))
    await screen.findByRole("heading", { name: "Create Chore" })

    fireEvent.change(screen.getByPlaceholderText("e.g. Clean Kitchen"), {
      target: { value: "Sweep Floor" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }))
    expect(screen.getByText("Rotate 1/0 people fairly.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("People Needed"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Create Chore" }))
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "People needed must be between 1 and the number of eligible members.",
    )
    expect(
      fetchMock.mock.calls.some(
        ([url, request]) =>
          url === "http://localhost:8080/api/households/home-1/chores" &&
          request?.method === "POST",
      ),
    ).toBe(false)
  })
})
