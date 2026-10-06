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
const pendingAssignment: import("@/lib/household/chores").AssignmentDTO = {
  id: "assignment-1",
  householdId: household.id,
  choreId: "chore-1",
  categoryName: "Kitchen",
  categoryIcon: "🍽️",
  title: "Clean Kitchen",
  scheduledFor: "2026-09-27T18:00:00Z",
  dueAt: "2026-09-27T18:00:00Z",
  status: "PENDING",
  priority: "HIGH",
  difficulty: 3,
  estimatedMinutes: 20,
  assignees: [
    { userId: user.userId, displayName: "Jahid" },
    { userId: "user-2", displayName: "Ahmed" },
  ],
  canComplete: true,
  completedAt: null,
  completedByDisplayName: null,
  overdue: true,
}
const dashboard = {
  weekSummary: { completedCount: 1, totalCount: 2, completionPercentage: 50 },
  today: [pendingAssignment],
  thisWeek: [pendingAssignment],
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function startAtDashboard(data = dashboard, householdData = household) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(user))
    .mockResolvedValueOnce(jsonResponse([householdData]))
    .mockResolvedValueOnce(jsonResponse(data))
  render(<AppShell />)
  await screen.findByText(`${data.weekSummary.completionPercentage}% done`)
}

describe("server-backed chore data", () => {
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

  it("renders live dashboard summary and assignment data, then completes and refreshes it", async () => {
    const timezoneBoundaryAssignment = {
      ...pendingAssignment,
      scheduledFor: "2026-09-27T00:30:00Z",
      dueAt: "2026-09-27T01:30:00Z",
    }
    await startAtDashboard({
      ...dashboard,
      today: [timezoneBoundaryAssignment],
      thisWeek: [timezoneBoundaryAssignment],
    })
    expect(screen.getByText("1/2")).toBeTruthy()
    expect(screen.getAllByText("Assigned to You, Ahmed")).toHaveLength(2)
    expect(screen.getAllByText("Overdue")).toHaveLength(2)
    const scheduledDay = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 8, 27, 12)))
    const householdTime = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: household.timezone,
    }).format(new Date(timezoneBoundaryAssignment.dueAt))
    expect(screen.getAllByText(`${scheduledDay} · ${householdTime}`)).toHaveLength(2)
    expect(screen.queryByText("Bathroom Cleaning")).toBeNull()

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "complete-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ ...pendingAssignment, status: "COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse({
          weekSummary: { completedCount: 2, totalCount: 2, completionPercentage: 100 },
          today: [
            {
              ...pendingAssignment,
              status: "COMPLETED",
              canComplete: false,
              completedByDisplayName: "Jahid",
            },
          ],
          thisWeek: [],
        }),
      )
    fireEvent.click(screen.getByRole("button", { name: "Mark Clean Kitchen complete" }))

    expect(await screen.findByText("100% done")).toBeTruthy()
    expect(
      fetchMock.mock.calls.some(
        ([url, request]) =>
          url === "http://localhost:8080/api/households/home-1/assignments/assignment-1/complete" &&
          request?.method === "POST",
      ),
    ).toBe(true)
    const completeRequest = fetchMock.mock.calls.find(([, request]) => request?.method === "POST")
    expect(new Headers(completeRequest?.[1]?.headers).get("X-CSRF-TOKEN")).toBe("complete-csrf")
  })

  it("loads upcoming and completed chores, shows server counts and refreshes after completion", async () => {
    await startAtDashboard({
      weekSummary: { completedCount: 0, totalCount: 0, completionPercentage: 0 },
      today: [],
      thisWeek: [],
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([pendingAssignment]))
      .mockResolvedValueOnce(jsonResponse([]))
    fireEvent.click(screen.getByRole("button", { name: "My Chores" }))
    expect(await screen.findByRole("heading", { name: "My Chores" })).toBeTruthy()
    expect(await screen.findByText("Clean Kitchen")).toBeTruthy()
    expect(screen.getByText("1 upcoming · 0 completed")).toBeTruthy()
    expect(screen.getByText("Assigned to You, Ahmed")).toBeTruthy()

    const completed = {
      ...pendingAssignment,
      status: "COMPLETED",
      canComplete: false,
      overdue: false,
      completedByDisplayName: "Jahid",
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "my-chores-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse(completed))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([completed]))
    fireEvent.click(screen.getByRole("button", { name: "Mark Clean Kitchen complete" }))

    await waitFor(() => expect(screen.getByText("0 upcoming · 1 completed")).toBeTruthy())
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "http://localhost:8080/api/households/home-1/my-chores?status=UPCOMING",
      ),
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /completed/i }))
    expect(await screen.findByText("Completed by Jahid")).toBeTruthy()
  })

  it("uses real member roles, join dates and progress in Household and Household Management", async () => {
    await startAtDashboard({
      weekSummary: { completedCount: 0, totalCount: 0, completionPercentage: 0 },
      today: [],
      thisWeek: [],
    })
    const members = [
      {
        userId: "user-1",
        displayName: "Jahid",
        role: "OWNER",
        joinedAt: "2026-01-15T12:00:00Z",
        assignedThisWeek: 4,
        completedThisWeek: 3,
      },
      {
        userId: "user-2",
        displayName: "Ahmed",
        role: "MEMBER",
        joinedAt: "2026-02-20T12:00:00Z",
        assignedThisWeek: 2,
        completedThisWeek: 1,
      },
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse(members))
    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(await screen.findByText("3/4 chores done this week")).toBeTruthy()
    expect(screen.getByText("OWNER")).toBeTruthy()
    expect(screen.getByText("Member since Jan 2026")).toBeTruthy()

    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ categories: [], activeMembers: [] }))
    fireEvent.click(screen.getByRole("button", { name: /Manage Chores/ }))
    expect(await screen.findByRole("heading", { name: "Household Management" })).toBeTruthy()
    expect(await screen.findByText("No chores yet")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Members/ })).toBeNull()
  })

  it("lets an owner transfer ownership and leave in one atomic request", async () => {
    await startAtDashboard({
      weekSummary: { completedCount: 0, totalCount: 0, completionPercentage: 0 },
      today: [],
      thisWeek: [],
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          userId: user.userId,
          displayName: "Jahid",
          role: "OWNER",
          joinedAt: "2026-01-15T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
        {
          userId: "user-2",
          displayName: "Ahmed",
          role: "ADMIN",
          joinedAt: "2026-02-20T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
        {
          userId: "user-3",
          displayName: "Mina",
          role: "MEMBER",
          joinedAt: "2026-03-20T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
        {
          userId: "user-4",
          displayName: "Invited user",
          role: "INVITED",
          joinedAt: "2026-03-20T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
        {
          userId: "user-5",
          displayName: "Former member",
          role: "LEFT",
          joinedAt: "2026-03-20T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
        {
          userId: "user-6",
          displayName: "Removed member",
          role: "REMOVED",
          joinedAt: "2026-03-20T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
      ]),
    )
    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(await screen.findByText("Ahmed")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Leave household" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Leave household" }))

    expect(screen.getByText("Transfer ownership before leaving")).toBeTruthy()
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    fireEvent.click(screen.getByRole("radio", { name: /Ahmed ADMIN/ }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(
      screen.getByRole("heading", { name: "Transfer ownership to Ahmed and leave Apartment 305?" }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Ahmed becomes Owner, you leave the household, and rejoining later requires a new invite/,
      ),
    ).toBeTruthy()

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ token: "leave-owner-csrf", headerName: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))
    fireEvent.click(screen.getByRole("button", { name: "Transfer and leave" }))

    await screen.findByText("Welcome to ChoreSync!")
    const leaveRequest = fetchMock.mock.calls.find(
      ([url, request]) =>
        url === "http://localhost:8080/api/households/home-1/leave" && request?.method === "POST",
    )
    expect(leaveRequest?.[1]?.body).toBe(JSON.stringify({ newOwnerUserId: "user-2" }))
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "http://localhost:8080/api/households/home-1/leave",
      ),
    ).toHaveLength(1)
  })

  it("offers the existing invite and delete household paths to a sole owner", async () => {
    await startAtDashboard({
      weekSummary: { completedCount: 0, totalCount: 0, completionPercentage: 0 },
      today: [],
      thisWeek: [],
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          userId: user.userId,
          displayName: "Jahid",
          role: "OWNER",
          joinedAt: "2026-01-15T12:00:00Z",
          assignedThisWeek: 0,
          completedThisWeek: 0,
        },
      ]),
    )
    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(await screen.findByText("Jahid")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Leave household" }))

    expect(screen.getByText("You’re the only active member")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Invite Member" }))
    expect(screen.getByRole("dialog", { name: "Invite a housemate" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close invitation dialog" }))

    fireEvent.click(screen.getByRole("button", { name: "Leave household" }))
    expect(screen.getByRole("button", { name: "Delete Household" })).toBeTruthy()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          id: household.id,
          name: household.name,
          timezone: household.timezone,
          currentUserRole: "OWNER",
          createdAt: household.createdAt,
          description: null,
          notificationStyle: "NORMAL",
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
    fireEvent.click(screen.getByRole("button", { name: "Delete Household" }))
    expect(await screen.findByRole("heading", { name: "Household Settings" })).toBeTruthy()
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "http://localhost:8080/api/households/home-1/settings",
      ),
    ).toBe(true)
  })

  it.each(["MEMBER", "ADMIN"])(
    "%s retains the existing leave confirmation and leave request",
    async (role) => {
      const roleHousehold = { ...household, currentUserRole: role }
      await startAtDashboard(
        {
          weekSummary: { completedCount: 0, totalCount: 0, completionPercentage: 0 },
          today: [],
          thisWeek: [],
        },
        roleHousehold,
      )
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          {
            userId: user.userId,
            displayName: "Jahid",
            role,
            joinedAt: "2026-01-15T12:00:00Z",
            assignedThisWeek: 0,
            completedThisWeek: 0,
          },
        ]),
      )
      fireEvent.click(screen.getByRole("button", { name: "Household" }))
      expect(await screen.findByText("Jahid")).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Leave household" }))
      expect(screen.getByRole("heading", { name: "Leave Apartment 305?" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy()

      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ token: "member-leave-csrf", headerName: "X-CSRF-TOKEN" }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(jsonResponse([]))
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }))

      await screen.findByText("Welcome to ChoreSync!")
      const leaveRequest = fetchMock.mock.calls.find(
        ([url, request]) =>
          url === "http://localhost:8080/api/households/home-1/leave" && request?.method === "POST",
      )
      expect(leaveRequest?.[1]?.body).toBeUndefined()
    },
  )

  it("keeps API failures distinct from empty dashboard and chore states", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse([household]))
      .mockRejectedValueOnce(new TypeError("offline"))
    render(<AppShell />)
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to connect to DirtyDuty. Please try again.",
    )
    expect(screen.queryByText("No chores due today!")).toBeNull()
  })

  it("does not offer completion when the server denies it and distinguishes My Chores errors from empty data", async () => {
    await startAtDashboard({
      weekSummary: { completedCount: 0, totalCount: 1, completionPercentage: 0 },
      today: [{ ...pendingAssignment, canComplete: false }],
      thisWeek: [],
    })
    expect(screen.queryByRole("button", { name: "Mark Clean Kitchen complete" })).toBeNull()
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse([]))
    fireEvent.click(screen.getByRole("button", { name: "My Chores" }))
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to connect to DirtyDuty. Please try again.",
    )
    expect(screen.queryByText("All caught up!")).toBeNull()
  })

  it("shows only the scheduled local date when no due time is provided", async () => {
    const assignment = {
      ...pendingAssignment,
      scheduledFor: "2026-09-27T00:30:00Z",
      dueAt: null,
    }
    await startAtDashboard({
      weekSummary: { completedCount: 0, totalCount: 1, completionPercentage: 0 },
      today: [assignment],
      thisWeek: [],
    })
    const scheduledDay = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 8, 27, 12)))
    expect(screen.getByText(scheduledDay)).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${scheduledDay} ·`))).toBeNull()
  })
})
