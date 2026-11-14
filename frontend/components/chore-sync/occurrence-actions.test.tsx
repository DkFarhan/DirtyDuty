// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"
import { clearCsrfToken } from "@/lib/auth/api"
import type { AssignmentDTO, HouseholdDashboard } from "@/lib/household/chores"
import { stubAuthFeatures } from "../../test/stub-auth-features"

const fetchMock = vi.fn<typeof fetch>()
vi.mock("@/lib/notifications/push", () => ({
  browserPushEndpointFingerprint: vi.fn().mockResolvedValue("a".repeat(64)),
  inspectBrowserPushSubscription: vi
    .fn()
    .mockResolvedValue({ status: "unsupported", subscription: null }),
  inspectBrowserPushDevice: vi.fn().mockResolvedValue({
    permission: "unsupported",
    worker: "unsupported",
    subscription: "unknown",
  }),
  createBrowserPushSubscription: vi.fn(),
  prepareBrowserPushWorker: vi.fn().mockResolvedValue(undefined),
  requestBrowserNotificationPermission: vi.fn(),
  repairBrowserPushSubscription: vi.fn(),
  removeBrowserPushSubscription: vi.fn(),
  PushVapidKeyMismatchError: class extends Error {},
}))

const today = new Date().toISOString().slice(0, 10)
const user = {
  userId: "owner",
  displayName: "Olive",
  email: "olive@example.test",
  emailVerified: true,
  hasPassword: true,
  authProviders: ["PASSWORD"],
}
const household = {
  id: "home-1",
  name: "Test home",
  timezone: "UTC",
  currentUserRole: "OWNER",
  createdAt: "2026-09-25T12:00:00Z",
}
const allActions = {
  canMove: true,
  canSkip: true,
  canUnskip: false,
  canReassign: true,
  moveEarliest: today,
  moveLatest: null,
  maxAssignees: 1,
}

function chore(overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return {
    id: "kitchen",
    householdId: household.id,
    choreId: "chore-1",
    categoryName: "Kitchen",
    categoryIcon: "kitchen",
    title: "Kitchen clean-up",
    scheduledFor: today,
    dueAt: `${today}T23:00:00Z`,
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 2,
    estimatedMinutes: null,
    assignees: [{ userId: user.userId, displayName: "Olive" }],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    originalDate: null,
    moved: false,
    reassigned: false,
    actions: allActions,
    ...overrides,
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

type Server = {
  dashboard: HouseholdDashboard
  upcoming: AssignmentDTO[]
  action?: (url: string, init?: RequestInit) => Promise<Response>
}

function serve(server: Server) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/api/auth/me")) return json(user)
    if (url.endsWith("/api/auth/csrf")) return json({ token: "t", headerName: "X-CSRF-TOKEN" })
    if (url.endsWith("/api/households")) return json([household])
    if (url.endsWith("/dashboard")) return json(server.dashboard)
    if (url.includes("/my-chores?status=UPCOMING")) return json(server.upcoming)
    if (url.includes("/my-chores?status=COMPLETED")) return json([])
    if (url.endsWith("/chore-management-options")) {
      return json({
        categories: [],
        activeMembers: [
          { userId: "owner", displayName: "Olive" },
          { userId: "ben", displayName: "Ben" },
        ],
      })
    }
    if (/\/assignments\/[^/]+\/(move|skip|unskip|assignees)$/.test(url) && server.action) {
      return server.action(url, init)
    }
    if (url.endsWith("/api/notifications/preferences")) return json({ pushEnabled: false })
    if (url.endsWith("/api/notifications/unread-count")) return json({ count: 0 })
    return json({}, 404)
  })
}

function dashboardWith(items: AssignmentDTO[], completed = 0): HouseholdDashboard {
  return {
    weekSummary: {
      completedCount: completed,
      totalCount: items.filter((item) => item.status !== "SKIPPED").length,
      completionPercentage: 0,
    },
    today: items.filter((item) => item.scheduledFor === today),
    thisWeek: items,
    overdue: [],
  }
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function startAtHome() {
  render(<AppShell initialScreen="dashboard" />)
  await screen.findByRole("heading", { name: "Today" }, { timeout: 3_000 })
}

async function openActions(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: `More actions for ${title}` }))
  return screen.getByRole("dialog", { name: title })
}

describe("single-occurrence actions on Home and My Chores", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    stubAuthFeatures(fetchMock)
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

  it("shows a skip at once, takes it out of the week totals and keeps My Chores in step", async () => {
    const pending = chore()
    const skipped = chore({
      status: "SKIPPED",
      canComplete: false,
      actions: {
        ...allActions,
        canMove: false,
        canSkip: false,
        canReassign: false,
        canUnskip: true,
      },
    })
    const response = deferred()
    const server: Server = {
      dashboard: dashboardWith([pending]),
      upcoming: [pending],
      action: () => response.promise,
    }
    serve(server)
    await startAtHome()
    expect(screen.getByText("0 of 1 chores completed")).toBeTruthy()

    const dialog = await openActions("Kitchen clean-up")
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip this day" }))
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Skip this day" }).at(-1)!)

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByText("Skipped")).toBeTruthy()
    expect(screen.getByText("0 of 0 chores completed")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull()

    server.dashboard = dashboardWith([skipped])
    server.upcoming = []
    response.resolve(json(skipped))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/dashboard")).length,
      ).toBeGreaterThan(1),
    )
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/assignments/kitchen/skip") && init?.method === "POST",
      ),
    ).toBe(true)

    // The owner can undo it from the same card.
    const again = await openActions("Kitchen clean-up")
    expect(within(again).getByRole("button", { name: "Undo skip" })).toBeTruthy()
    fireEvent.keyDown(document, { key: "Escape" })

    fireEvent.click(screen.getByRole("button", { name: "My Chores" }))
    expect(await screen.findByRole("heading", { name: "My chores." })).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("Kitchen clean-up")).toBeNull())
  })

  it("rolls a move back and explains why when the server refuses it", async () => {
    const pending = chore()
    const response = deferred()
    serve({
      dashboard: dashboardWith([pending]),
      upcoming: [pending],
      action: () => response.promise,
    })
    await startAtHome()
    const dialog = await openActions("Kitchen clean-up")
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to another day" }))
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    fireEvent.change(within(dialog).getByLabelText("Day"), { target: { value: tomorrow } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getAllByText(/^Moved from /).length).toBeGreaterThan(0)

    response.resolve(json({ message: "This chore is already scheduled on that day." }, 400))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "This chore is already scheduled on that day.",
      ),
    )
    expect(screen.queryByText(/^Moved from /)).toBeNull()
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeTruthy()
  })

  it("shows the moved hint and offers More only where the viewer may act", async () => {
    const moved = chore({
      id: "moved",
      title: "Water plants",
      originalDate: "2026-11-09",
      moved: true,
      actions: { ...allActions, canSkip: false, canReassign: false },
    })
    const locked = chore({ id: "locked", title: "Bins out", actions: undefined })
    serve({ dashboard: dashboardWith([moved, locked]), upcoming: [moved, locked] })
    await startAtHome()
    expect(await screen.findByText("Moved from Mon")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "More actions for Bins out" })).toBeNull()
    const dialog = await openActions("Water plants")
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Move to another day"])
  })

  it("removes a chore reassigned away from My Chores at once and refreshes Home", async () => {
    const pending = chore()
    const response = deferred()
    const server: Server = {
      dashboard: dashboardWith([pending]),
      upcoming: [pending],
      action: () => response.promise,
    }
    serve(server)
    await startAtHome()
    fireEvent.click(screen.getByRole("button", { name: "My Chores" }))
    expect(await screen.findByRole("heading", { name: "My chores." })).toBeTruthy()

    const dialog = await openActions("Kitchen clean-up")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign this day" }))
    fireEvent.click(await within(dialog).findByRole("radio", { name: "Ben" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.queryByText("Kitchen clean-up")).toBeNull())
    const reassigned = chore({
      assignees: [{ userId: "ben", displayName: "Ben" }],
      canComplete: false,
      reassigned: true,
    })
    server.dashboard = dashboardWith([reassigned])
    server.upcoming = []
    response.resolve(json(reassigned))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/assignments/kitchen/assignees") &&
            init?.method === "PUT" &&
            init.body === JSON.stringify({ userIds: ["ben"] }),
        ),
      ).toBe(true),
    )
    fireEvent.click(screen.getByRole("button", { name: "Home" }))
    expect(await screen.findByText("Assigned to Ben")).toBeTruthy()
  })
})
