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
  /** Later dashboard and My Chores answers, for refreshes after an action. */
  after?: () => Pick<Server, "dashboard" | "upcoming">
}

function serve(server: Server) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/api/auth/me")) return json(user)
    if (url.endsWith("/api/auth/csrf")) return json({ token: "t", headerName: "X-CSRF-TOKEN" })
    if (url.endsWith("/api/households")) return json([household])
    if (url.endsWith("/dashboard")) return json((server.after?.() ?? server).dashboard)
    if (url.includes("/my-chores?status=UPCOMING")) {
      return json((server.after?.() ?? server).upcoming)
    }
    if (url.includes("/my-chores?status=COMPLETED")) return json([])
    if (url.endsWith("/chore-management-options")) {
      return json({
        categories: [],
        activeMembers: [
          { userId: "owner", displayName: "Olive" },
          { userId: "ben", displayName: "Ben" },
          { userId: "cara", displayName: "Cara" },
        ],
      })
    }
    if (url.endsWith("/chores/chore-garbage")) {
      return json({
        id: "chore-garbage",
        schedule: {
          kind: "AS_NEEDED",
          recurrenceRule: null,
          participantUserIds: ["ben", "owner"],
        },
      })
    }
    if (
      /\/assignments\/[^/]+\/(move|skip|unskip|assignees|flag|complete)$/.test(url) &&
      server.action
    ) {
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

const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()

function job(overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return chore({
    id: "garbage",
    choreId: "chore-garbage",
    title: "Garbage",
    categoryName: "Bins",
    kind: "AS_NEEDED",
    dueAt: `${today}T23:30:00Z`,
    assignees: [{ userId: "ben", displayName: "Ben" }],
    turn: { userId: "ben", displayName: "Ben" },
    lastDone: { at: twoDaysAgo, byUserId: "abu", byDisplayName: "Abubakar" },
    flag: null,
    repeat: { intervalCount: null, intervalUnit: null, backstopDays: 2, dueTime: "23:30" },
    canComplete: false,
    actions: { ...allActions, canMove: false, canSkip: false, canReassign: false, canFlag: true },
    ...overrides,
  })
}

describe("household jobs (When needed) on Home and My Chores", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    stubAuthFeatures(fetchMock)
    clearCsrfToken()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearCsrfToken()
  })

  it("shows every member the Household jobs section, with Needs doing but no Done for non-participants", async () => {
    serve({ dashboard: { ...dashboardWith([]), householdJobs: [job()] }, upcoming: [] })
    await startAtHome()

    const section = await screen.findByRole("region", { name: "Household jobs" })
    const card = within(section).getByRole("article", { name: "Garbage" })
    expect(within(card).getByText("Ben's turn")).toBeTruthy()
    expect(within(card).getByText("Last done 2 days ago by Abubakar")).toBeTruthy()
    expect(within(card).getByText("Due by 11:30 PM today")).toBeTruthy()
    expect(within(card).getByRole("button", { name: "Needs doing: Garbage" })).toBeTruthy()
    expect(within(card).queryByRole("button", { name: /^(Done|I did it) Garbage$/ })).toBeNull()
  })

  it("hides the section when the household has no When needed chores", async () => {
    serve({ dashboard: dashboardWith([]), upcoming: [] })
    await startAtHome()
    expect(screen.queryByRole("region", { name: "Household jobs" })).toBeNull()
  })

  it("shows Reminder sent at once, and Already asked then the server's flag after a 409", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(`${today}T15:00:00Z`))
    const response = deferred()
    const calls: string[] = []
    let conflicted = false
    const benAsked = job({
      flag: { at: `${today}T14:59:00Z`, byUserId: "ben", byDisplayName: "Ben" },
    })
    serve({
      dashboard: { ...dashboardWith([]), householdJobs: [job()] },
      upcoming: [],
      action: (url) => {
        calls.push(url)
        return response.promise
      },
      after: () => ({
        dashboard: { ...dashboardWith([]), householdJobs: [conflicted ? benAsked : job()] },
        upcoming: [],
      }),
    })
    await startAtHome()

    fireEvent.click(await screen.findByRole("button", { name: "Needs doing: Garbage" }))
    expect(await screen.findByText("You asked just now")).toBeTruthy()
    expect(screen.getByText("Due now")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Reminder sent: Garbage" }).getAttribute("aria-disabled"),
    ).toBe("true")
    expect(calls.at(-1)).toMatch(/\/assignments\/garbage\/flag$/)

    conflicted = true
    response.resolve(json({ message: "Already flagged at 2:59 PM." }, 409))
    const alert = await screen.findByText("Already asked at 2:59 PM.")
    expect(
      alert.closest("[data-card-feedback]")?.previousElementSibling?.getAttribute("aria-label"),
    ).toBe("Garbage")
    expect(await screen.findByText("Ben asked 1 min ago")).toBeTruthy()
    const sent = screen.getByRole("button", { name: "Reminder sent: Garbage" })
    expect(sent.getAttribute("aria-disabled")).toBe("true")
    expect(document.getElementById(sent.getAttribute("aria-describedby")!)?.textContent).toBe(
      "You can remind again at 4:59 PM",
    )
    expect(screen.queryByRole("button", { name: "Needs doing: Garbage" })).toBeNull()
  })

  it("lets a participant whose turn it is not do the job with I did it from My Chores", async () => {
    const theirTurn = job({ canComplete: true })
    const completed = { ...theirTurn, status: "COMPLETED" as const, canComplete: false }
    const calls: string[] = []
    serve({
      dashboard: dashboardWith([]),
      upcoming: [theirTurn],
      action: async (url) => {
        calls.push(url)
        return json(completed)
      },
    })
    await startAtHome()
    fireEvent.click(screen.getAllByRole("button", { name: /My chores/i })[0])

    const section = await screen.findByRole("region", { name: "Household jobs" })
    expect(within(section).getByText("Ben's turn")).toBeTruthy()
    fireEvent.click(within(section).getByRole("button", { name: "I did it Garbage" }))
    await waitFor(() => expect(calls.at(-1)).toMatch(/\/assignments\/garbage\/complete$/))
  })

  it("puts a flagged job first with a full-width I did it and no reminder button on the viewer's turn", async () => {
    const mine = job({
      id: "mine",
      title: "Recycling",
      turn: { userId: "owner", displayName: "Olive" },
      assignees: [{ userId: "owner", displayName: "Olive" }],
      canComplete: true,
      lastDone: null,
      flag: {
        at: new Date(Date.now() - 10 * 60_000).toISOString(),
        byUserId: "ben",
        byDisplayName: "Ben",
      },
    })
    serve({ dashboard: dashboardWith([]), upcoming: [job({ canComplete: true }), mine] })
    await startAtHome()
    fireEvent.click(screen.getAllByRole("button", { name: /My chores/i })[0])

    const section = await screen.findByRole("region", { name: "Household jobs" })
    const cards = within(section).getAllByRole("article")
    expect(cards[0].getAttribute("aria-label")).toBe("Recycling")
    expect(within(cards[0]).getByText("Your turn")).toBeTruthy()
    expect(within(cards[0]).getByText("Not done yet")).toBeTruthy()
    expect(within(cards[0]).getByText("Ben asked 10 min ago")).toBeTruthy()
    expect(within(cards[0]).getByRole("button", { name: "I did it Recycling" })).toBeTruthy()
    expect(
      within(cards[0]).queryByRole("button", {
        name: /^(Needs doing|Reminder sent|Remind again):/,
      }),
    ).toBeNull()
  })
  it("puts the Needs doing confirmation under the job card, then holds Reminder sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(`${today}T15:00:00Z`))
    let flagged: AssignmentDTO | null = null
    serve({
      dashboard: { ...dashboardWith([]), householdJobs: [job()] },
      upcoming: [],
      action: async () => {
        flagged = job({
          flag: { at: new Date().toISOString(), byUserId: "owner", byDisplayName: "Olive" },
        })
        return json(flagged)
      },
      after: () => ({
        dashboard: { ...dashboardWith([]), householdJobs: [flagged ?? job()] },
        upcoming: [],
      }),
    })
    await startAtHome()

    fireEvent.click(await screen.findByRole("button", { name: "Needs doing: Garbage" }))
    const confirmation = await screen.findByRole("status")
    expect(confirmation.textContent).toBe("Flagged. Ben has been told.")
    expect(confirmation.previousElementSibling?.getAttribute("aria-label")).toBe("Garbage")

    const card = screen.getByRole("article", { name: "Garbage" })
    expect(within(card).getByText("You asked just now")).toBeTruthy()
    expect(
      within(card)
        .getByRole("button", { name: "Reminder sent: Garbage" })
        .getAttribute("aria-disabled"),
    ).toBe("true")
    expect(within(card).getByText("You can remind again at 5:00 PM")).toBeTruthy()
  })

  it("shows Already done next to the job's new open copy after someone else did it", async () => {
    let done = false
    const fresh = job({ id: "garbage-next", turn: { userId: "owner", displayName: "Olive" } })
    serve({
      dashboard: dashboardWith([]),
      upcoming: [job({ canComplete: true })],
      action: async () => {
        done = true
        return json({ message: "Already done by Ben." }, 409)
      },
      after: () => ({
        dashboard: dashboardWith([]),
        upcoming: [done ? fresh : job({ canComplete: true })],
      }),
    })
    await startAtHome()
    fireEvent.click(screen.getAllByRole("button", { name: /My chores/i })[0])
    const section = await screen.findByRole("region", { name: "Household jobs" })
    fireEvent.click(within(section).getByRole("button", { name: "I did it Garbage" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("Already done by Ben.")
    await waitFor(() =>
      expect(document.querySelector('[data-household-job="garbage-next"]')).toBeTruthy(),
    )
    expect(
      document.querySelector('[data-household-job="garbage-next"]')?.nextElementSibling
        ?.textContent,
    ).toBe("Already done by Ben.")
  })

  it("shows an occurrence action error under its card on Home and My Chores", async () => {
    const pending = chore()
    serve({
      dashboard: dashboardWith([pending]),
      upcoming: [pending],
      action: async () => json({ message: "This chore is already scheduled on that day." }, 400),
    })
    await startAtHome()

    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Kitchen clean-up" }),
    )
    const dialog = screen.getByRole("dialog", { name: "Kitchen clean-up" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip this day" }))
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Skip this day" }).at(-1)!)
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("This chore is already scheduled on that day.")
    expect(alert.previousElementSibling?.getAttribute("data-occurrence-card")).toBe("kitchen")

    fireEvent.click(screen.getAllByRole("button", { name: /My chores/i })[0])
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Kitchen clean-up" }),
    )
    const sheet = screen.getByRole("dialog", { name: "Kitchen clean-up" })
    fireEvent.click(within(sheet).getByRole("button", { name: "Skip this day" }))
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Skip this day" }).at(-1)!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-occurrence-card="kitchen"]')?.nextElementSibling?.textContent,
      ).toBe("This chore is already scheduled on that day."),
    )
  })

  it("offers only the rotation, in rotation order, when reassigning a When needed chore", async () => {
    const owned = job({
      canComplete: true,
      actions: { ...allActions, canMove: false, canSkip: false, canReassign: true, canFlag: true },
    })
    serve({ dashboard: { ...dashboardWith([]), householdJobs: [owned] }, upcoming: [] })
    await startAtHome()

    fireEvent.click(await screen.findByRole("button", { name: "More actions for Garbage" }))
    const dialog = screen.getByRole("dialog", { name: "Garbage" })
    fireEvent.click(within(dialog).getByRole("button", { name: /Reassign/ }))
    const group = await within(dialog).findByRole("radiogroup", { name: "Rotation members" })
    expect(
      within(group)
        .getAllByRole("radio")
        .map((option) => option.textContent?.trim()),
    ).toEqual(["Ben", "Olive"])
    expect(within(dialog).queryByText("Cara")).toBeNull()
  })

  it("keeps the household member list for reassigning other chores", async () => {
    const pending = chore()
    serve({ dashboard: dashboardWith([pending]), upcoming: [pending] })
    await startAtHome()
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Kitchen clean-up" }),
    )
    const dialog = screen.getByRole("dialog", { name: "Kitchen clean-up" })
    fireEvent.click(within(dialog).getByRole("button", { name: /Reassign/ }))
    const group = await within(dialog).findByRole("radiogroup", { name: "Household members" })
    expect(within(group).getAllByRole("radio")).toHaveLength(3)
  })
  it("shows a result only under the card that was pressed when a job is on Home twice", async () => {
    // Asked three hours ago, so the window has ended and Remind again is back.
    const flaggedMine = job({
      assignees: [{ userId: "owner", displayName: "Olive" }],
      canComplete: true,
      overdue: true,
      flag: {
        at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        byUserId: "ben",
        byDisplayName: "Ben",
      },
    })
    serve({
      dashboard: { ...dashboardWith([]), overdue: [flaggedMine], householdJobs: [flaggedMine] },
      upcoming: [],
      action: async (url) =>
        url.endsWith("/flag")
          ? json({ message: "Already flagged at 5:01 AM." }, 409)
          : json({ message: "Already done by Ben." }, 409),
    })
    await startAtHome()

    fireEvent.click(await screen.findByRole("button", { name: "Remind again: Garbage" }))
    await screen.findByText("Already asked at 5:01 AM.")
    expect(screen.getAllByText("Already asked at 5:01 AM.")).toHaveLength(1)
    expect(
      screen
        .getByText("Already asked at 5:01 AM.")
        .closest("[data-card-feedback]")
        ?.previousElementSibling?.getAttribute("data-household-job"),
    ).toBe("garbage")

    const attention = screen.getByRole("region", { name: "Needs attention" })
    fireEvent.click(within(attention).getByRole("button", { name: "Mark complete" }))
    await screen.findByText("Already done by Ben.", {}, { timeout: 3_000 })
    expect(screen.getAllByText("Already done by Ben.")).toHaveLength(1)
    // The section left during the optimistic completion and came back on rollback.
    const restored = screen.getByRole("region", { name: "Needs attention" })
    expect(within(restored).getByText("Already done by Ben.")).toBeTruthy()
    expect(screen.queryByText("Already asked at 5:01 AM.")).toBeNull()
  })
})
