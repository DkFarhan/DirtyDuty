// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"
import { clearCsrfToken } from "../../lib/auth/api"

const fetchMock = vi.fn<typeof fetch>()
const user = {
  userId: "user-1",
  displayName: "Browser User",
  email: "user@example.com",
  emailVerified: false,
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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function startAuthenticated(households: unknown[] = []) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(user))
    .mockResolvedValueOnce(jsonResponse(households))
  if (households.length > 0) fetchMock.mockResolvedValueOnce(jsonResponse(dashboard))
  render(<AppShell />)
}

async function openWelcome() {
  startAuthenticated()
  await screen.findByRole("button", { name: /Create a Household/ })
}

describe("household onboarding", () => {
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

  it("loads households only after auth restoration and routes existing members to the dashboard", async () => {
    startAuthenticated([household])

    expect(await screen.findByText("Today")).toBeTruthy()
    expect(screen.queryByText("Welcome!")).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8080/api/auth/me",
      "http://localhost:8080/api/households",
      "http://localhost:8080/api/households/home-1/dashboard",
      "http://localhost:8080/api/notifications/unread-count",
    ])
  })

  it("keeps household load failures distinct from an empty household list", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(user))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse([]))
    render(<AppShell />)

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to connect to DirtyDuty",
    )
    expect(screen.queryByText("Welcome!")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }))
    expect(await screen.findByText("Welcome!")).toBeTruthy()
  })

  it("creates a household with browser timezone, omits description, and refreshes into the dashboard", async () => {
    await openWelcome()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "household-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse(household, 201))
      .mockResolvedValueOnce(jsonResponse([household]))
      .mockResolvedValueOnce(jsonResponse(dashboard))

    fireEvent.click(screen.getByRole("button", { name: /Create a Household/ }))
    fireEvent.change(screen.getByLabelText(/Household Name/), {
      target: { value: "  Our Place  " },
    })
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Not part of the API" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Household" }))

    expect(await screen.findByText("Today")).toBeTruthy()
    const createRequest = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === "http://localhost:8080/api/households" && options?.method === "POST",
    )
    expect(createRequest?.[1]?.body).toBe(
      JSON.stringify({
        name: "Our Place",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    )
    expect(new Headers(createRequest?.[1]?.headers).get("X-CSRF-TOKEN")).toBe("household-csrf")
    const inviteDialog = await screen.findByRole("dialog", { name: "Invite a housemate" })
    expect(inviteDialog.textContent).toContain("add to Apartment 305")
    expect(screen.getByRole("button", { name: "Generate invite" })).toBeTruthy()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it("generates and displays a secure invite from Household Admin Actions", async () => {
    startAuthenticated([household])
    expect(await screen.findByText("Today")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    fireEvent.click(screen.getByRole("button", { name: /Invite Member/ }))
    expect(screen.getByRole("dialog", { name: "Invite a housemate" })).toBeTruthy()
    expect(screen.queryByText("one-time-code-from-server")).toBeNull()

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "invite-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(
        jsonResponse({
          inviteCode: "one-time-code-from-server",
          expiresAt: "2026-09-26T12:00:00Z",
        }),
      )
    fireEvent.click(screen.getByRole("button", { name: "Generate invite" }))

    expect(await screen.findByText("one-time-code-from-server")).toBeTruthy()
    expect(screen.getByText("This invite can be used once.")).toBeTruthy()
    expect(screen.getByText(/Expires/)).toBeTruthy()
    const createRequest = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === "http://localhost:8080/api/households/home-1/invitations" &&
        options?.method === "POST",
    )
    expect(createRequest?.[1]).toMatchObject({ credentials: "include", method: "POST" })
    expect(new Headers(createRequest?.[1]?.headers).get("X-CSRF-TOKEN")).toBe("invite-csrf")

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("one-time-code-from-server")

    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByText("one-time-code-from-server")).toBeNull()
  })

  it("does not show the invitation action to household members without invite permissions", async () => {
    startAuthenticated([{ ...household, currentUserRole: "MEMBER" }])

    expect(await screen.findByText("Today")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Invite housemate" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(await screen.findByRole("heading", { name: "Members" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Admin Actions" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Invite Member" })).toBeNull()
  })

  it("restores owner admin actions and routes secure invitations and chore management", async () => {
    startAuthenticated([household])
    expect(await screen.findByText("Today")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(await screen.findByRole("heading", { name: "Admin Actions" })).toBeTruthy()
    expect(screen.queryByText("APT305")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Invite Member/ }))
    expect(screen.getByRole("dialog", { name: "Invite a housemate" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Generate invite" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close invitation dialog" }))

    fireEvent.click(screen.getByRole("button", { name: /Manage Chores/ }))
    expect(await screen.findByRole("heading", { name: "Household Management" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Create a chore" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Invite Member/ })).toBeNull()
  })

  it("shows household admin actions to admins", async () => {
    startAuthenticated([{ ...household, currentUserRole: "ADMIN" }])
    expect(await screen.findByText("Today")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(await screen.findByRole("heading", { name: "Admin Actions" })).toBeTruthy()
  })

  it("guards against duplicate create submissions while a request is pending", async () => {
    await openWelcome()
    let resolveCreate!: (response: Response) => void
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
      )
      .mockResolvedValueOnce(jsonResponse([household]))
      .mockResolvedValueOnce(jsonResponse(dashboard))

    fireEvent.click(screen.getByRole("button", { name: /Create a Household/ }))
    fireEvent.change(screen.getByLabelText(/Household Name/), { target: { value: household.name } })
    const submit = screen.getByRole("button", { name: "Create Household" })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true),
    )
    fireEvent.click(submit)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1)

    resolveCreate(jsonResponse(household, 201))
    expect(await screen.findByText("Today")).toBeTruthy()
  })

  it("shows create errors and stays in onboarding", async () => {
    await openWelcome()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ message: "backend details" }, 400))

    fireEvent.click(screen.getByRole("button", { name: /Create a Household/ }))
    fireEvent.change(screen.getByLabelText(/Household Name/), { target: { value: "Our Place" } })
    fireEvent.click(screen.getByRole("button", { name: "Create Household" }))

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please check your information",
    )
    expect(screen.getByRole("heading", { name: "Create Household" })).toBeTruthy()
    expect(screen.queryByText("Today")).toBeNull()
  })

  it("joins with trimmed, case-preserved invite code and delegates CSRF to the API client", async () => {
    await openWelcome()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "join-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse(household))
      .mockResolvedValueOnce(jsonResponse([household]))
      .mockResolvedValueOnce(jsonResponse(dashboard))

    fireEvent.click(screen.getByRole("button", { name: /Join a Household/ }))
    fireEvent.change(screen.getByLabelText("Invite Code"), { target: { value: "  abCd12 \n" } })
    expect(screen.queryByText(/Household found/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Join Household" }))

    expect(await screen.findByText("Today")).toBeTruthy()
    const joinRequest = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === "http://localhost:8080/api/households/join" && options?.method === "POST",
    )
    expect(joinRequest?.[1]?.body).toBe(JSON.stringify({ inviteCode: "abCd12" }))
    expect(new Headers(joinRequest?.[1]?.headers).get("X-CSRF-TOKEN")).toBe("join-csrf")
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it("guards against duplicate join submissions while redemption is pending", async () => {
    await openWelcome()
    let resolveJoin!: (response: Response) => void
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveJoin = resolve
        }),
      )
      .mockResolvedValueOnce(jsonResponse([household]))
      .mockResolvedValueOnce(jsonResponse(dashboard))

    fireEvent.click(screen.getByRole("button", { name: /Join a Household/ }))
    fireEvent.change(screen.getByLabelText("Invite Code"), { target: { value: "AbC123" } })
    const submit = screen.getByRole("button", { name: "Join Household" })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true),
    )
    fireEvent.click(submit)
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1)

    resolveJoin(jsonResponse(household))
    expect(await screen.findByText("Today")).toBeTruthy()
  })

  it("shows join errors without navigating or persisting the invite code", async () => {
    await openWelcome()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ message: "backend details" }, 400))

    fireEvent.click(screen.getByRole("button", { name: /Join a Household/ }))
    fireEvent.change(screen.getByLabelText("Invite Code"), { target: { value: "Code123" } })
    fireEvent.click(screen.getByRole("button", { name: "Join Household" }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Invite code is invalid or no longer available.",
    )
    expect(screen.queryByText("Today")).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it("signs out from the welcome screen using the existing auth flow", async () => {
    await openWelcome()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ token: "logout-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(await screen.findByRole("button", { name: "Sign In" })).toBeTruthy()
    expect(
      fetchMock.mock.calls.some(([url]) => url === "http://localhost:8080/api/auth/logout"),
    ).toBe(true)
  })

  it("returns notifications to Home or Profile based on the in-app origin", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/api/auth/me")) return jsonResponse(user)
      if (url.endsWith("/api/households")) return jsonResponse([household])
      if (url.endsWith("/api/households/home-1/dashboard")) return jsonResponse(dashboard)
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 0 })
      if (url.endsWith("/api/notifications")) return jsonResponse([])
      if (url.endsWith("/api/notifications/preferences")) {
        return jsonResponse({
          choreAssignedEnabled: true,
          choreRemindersEnabled: true,
          overdueEnabled: true,
          choreCompletionEnabled: true,
          householdUpdatesEnabled: true,
          quietHoursStart: null,
          quietHoursEnd: null,
          notificationStyleOverride: null,
          householdNotificationStyle: "NORMAL",
          funnyNotificationsEnabled: false,
          competitiveNotificationsEnabled: true,
          pushEnabled: false,
        })
      }
      if (url.endsWith("/api/profile")) {
        return jsonResponse({
          id: user.userId,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: null,
          householdName: household.name,
          assigned: 0,
          completed: 0,
          completionRate: 0,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    render(<AppShell />)
    expect(await screen.findByText("Today")).toBeTruthy()

    fireEvent.click(screen.getAllByRole("button", { name: "Notifications" })[0])
    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(await screen.findByText("Today")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Profile" }))
    expect(await screen.findByText(user.displayName)).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Notifications" })[0])
    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(await screen.findByText(user.displayName)).toBeTruthy()
  })

  it("uses Home as a safe fallback for direct notification URLs with external return targets", async () => {
    window.history.replaceState(
      {},
      "",
      "/?screen=notifications&returnTo=https%3A%2F%2Fevil.example",
    )
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/api/auth/me")) return jsonResponse(user)
      if (url.endsWith("/api/households")) return jsonResponse([household])
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 0 })
      if (url.endsWith("/api/notifications")) return jsonResponse([])
      if (url.endsWith("/api/notifications/preferences"))
        return jsonResponse({
          choreAssignedEnabled: true,
          choreRemindersEnabled: true,
          overdueEnabled: true,
          choreCompletionEnabled: true,
          householdUpdatesEnabled: true,
          quietHoursStart: null,
          quietHoursEnd: null,
          notificationStyleOverride: null,
          householdNotificationStyle: "NORMAL",
          funnyNotificationsEnabled: false,
          competitiveNotificationsEnabled: true,
          pushEnabled: false,
        })
      if (url.endsWith("/api/households/home-1/dashboard")) return jsonResponse(dashboard)
      throw new Error(`Unexpected request: ${url}`)
    })
    render(<AppShell />)

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(await screen.findByText("Today")).toBeTruthy()
    expect(window.location.href).not.toContain("evil.example")
  })
})
