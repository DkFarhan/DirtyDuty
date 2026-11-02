// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { clearCsrfToken } from "@/lib/auth/api"
import { ChoreSyncProvider } from "@/lib/chore-sync/store"
import type { Notification } from "@/lib/notifications/api"
import {
  createBrowserPushSubscription,
  removeBrowserPushSubscription,
} from "@/lib/notifications/push"
import { NotificationsScreen } from "./screens/notifications-screen"

const pushHealthMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  restore: vi.fn(),
  setPushEnabled: vi.fn(),
}))

vi.mock("@/lib/notifications/push", () => ({
  createBrowserPushSubscription: vi.fn(),
  removeBrowserPushSubscription: vi.fn(),
}))
vi.mock("@/lib/notifications/push-health", () => ({
  usePushSubscriptionHealth: () => ({
    state: { status: "disabled", reason: null, message: null },
    refresh: pushHealthMocks.refresh,
    restore: pushHealthMocks.restore,
    setPushEnabled: pushHealthMocks.setPushEnabled,
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const notifications = [
  {
    id: "note-1",
    type: "CHORE_REMINDER",
    category: "CHORES",
    priority: "HIGH",
    title: "Kitchen chore due",
    message: "Please complete the kitchen chore.",
    referenceType: "ASSIGNMENT",
    referenceId: "assignment-1",
    status: "SENT",
    scheduledAt: null,
    sentAt: "2026-09-29T12:00:00Z",
    deliveredAt: null,
    readAt: null,
    createdAt: "2026-09-29T12:00:00Z",
  },
  {
    id: "note-2",
    type: "HOUSEHOLD_UPDATE",
    category: "HOUSEHOLD",
    priority: "NORMAL",
    title: "Welcome home",
    message: "Your household is ready.",
    referenceType: null,
    referenceId: null,
    status: "SENT",
    scheduledAt: null,
    sentAt: "2026-09-28T12:00:00Z",
    deliveredAt: null,
    readAt: "2026-09-28T12:00:00Z",
    createdAt: "2026-09-28T12:00:00Z",
  },
]
const preferences = {
  choreAssignedEnabled: true,
  choreRemindersEnabled: true,
  overdueEnabled: true,
  choreCompletionEnabled: true,
  householdUpdatesEnabled: true,
  quietHoursStart: "21:30:00",
  quietHoursEnd: "06:30:00",
  notificationStyleOverride: null,
  householdNotificationStyle: "NORMAL",
  funnyNotificationsEnabled: false,
  competitiveNotificationsEnabled: true,
  pushEnabled: false,
}
let currentPreferences = { ...preferences }
let currentNotifications: Notification[] = [...notifications]

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("notifications screen", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushHealthMocks.refresh.mockReset()
    pushHealthMocks.restore.mockReset()
    pushHealthMocks.setPushEnabled.mockReset()
    currentPreferences = { ...preferences }
    currentNotifications = [...notifications]
    vi.mocked(removeBrowserPushSubscription).mockReset()
    vi.mocked(createBrowserPushSubscription).mockReset()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/notifications") && !url.endsWith("/unread-count"))
        return jsonResponse(currentNotifications)
      if (url.endsWith("/api/notifications/unread-count"))
        return jsonResponse({
          count: currentNotifications.filter((notification) => !notification.readAt).length,
        })
      if (url.endsWith("/api/notifications/preferences") && init?.method === "PUT") {
        return jsonResponse(JSON.parse(String(init.body)))
      }
      if (url.endsWith("/api/notifications/preferences")) return jsonResponse(currentPreferences)
      if (url.endsWith("/api/notifications/push/public-key"))
        return jsonResponse({ publicKey: "test-vapid-key", available: true })
      if (url.endsWith("/api/auth/csrf"))
        return jsonResponse({ token: "notification-csrf", headerName: "X-CSRF-TOKEN" })
      if (url.endsWith("/api/notifications/note-1/read")) {
        currentNotifications = currentNotifications.map((notification) =>
          notification.id === "note-1"
            ? { ...notification, readAt: new Date().toISOString() }
            : notification,
        )
        return new Response(null, { status: 204 })
      }
      if (url.endsWith("/api/notifications/read-all")) {
        currentNotifications = currentNotifications.map((notification) => ({
          ...notification,
          readAt: notification.readAt ?? new Date().toISOString(),
        }))
        return new Response(null, { status: 204 })
      }
      if (url.endsWith("/api/notifications/push-subscriptions"))
        return new Response(null, { status: 204 })
      if (url.endsWith("/api/notifications/push-subscriptions/unsubscribe"))
        return new Response(null, { status: 204 })
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.mocked(createBrowserPushSubscription).mockResolvedValue({
      endpoint: "https://push.example.test/subscription",
      expirationTime: null,
      options: {} as PushSubscriptionOptions,
      getKey: (name: "p256dh" | "auth") => {
        const key = name === "p256dh" ? "public-key" : "auth-secret"
        return new Uint8Array(new TextEncoder().encode(key)).buffer as ArrayBuffer
      },
      toJSON: () => ({ keys: { p256dh: "public-key", auth: "auth-secret" } }),
      unsubscribe: async () => true,
    } as unknown as Awaited<ReturnType<typeof createBrowserPushSubscription>>)
    vi.mocked(removeBrowserPushSubscription).mockResolvedValue(null)
    vi.stubGlobal("fetch", fetchMock)
    clearCsrfToken()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    clearCsrfToken()
  })

  it("renders read and unread styles, marks a notification read and saves preferences", async () => {
    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )

    const unreadArticle = await screen.findByText("Kitchen chore due")
    expect(unreadArticle.closest("article")?.getAttribute("data-read")).toBe("false")
    expect(unreadArticle.closest("article")?.className).toContain("dark:bg-teal-950/40")
    expect(screen.getByText("Welcome home").closest("article")?.getAttribute("data-read")).toBe(
      "true",
    )
    expect(screen.getByText("Welcome home").closest("article")?.className).toContain(
      "dark:bg-slate-800/70",
    )
    expect(screen.getByText("1 unread")).toBeTruthy()
    expect(screen.queryByText("CHORES")).toBeNull()
    expect(screen.queryByText("high")).toBeNull()
    expect(screen.getByText("Please complete the kitchen chore.")).toBeTruthy()
    expect(screen.getByText("Unread")).toBeTruthy()
    const markAsRead = screen.getByRole("button", { name: "Mark Kitchen chore due as read" })
    expect(markAsRead.textContent).toBe("Mark as read")
    expect(screen.getByLabelText("Quiet hours start")).toHaveProperty("value", "21:30")

    fireEvent.click(markAsRead)
    await waitFor(() =>
      expect(
        screen.getByText("Kitchen chore due").closest("article")?.getAttribute("data-read"),
      ).toBe("true"),
    )
    expect(await screen.findByText("You're all caught up")).toBeTruthy()

    fireEvent.click(screen.getByRole("checkbox", { name: "Funny messages" }))
    fireEvent.change(screen.getByLabelText("Notification style"), {
      target: { value: "MOTIVATIONAL" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Preferences saved.")

    const saveRequest = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/notifications/preferences") && init?.method === "PUT",
    )
    expect(saveRequest?.[1]?.body).toContain('"funnyNotificationsEnabled":true')
    expect(saveRequest?.[1]?.body).toContain('"quietHoursStart":"21:30:00"')
    expect(saveRequest?.[1]?.body).toContain('"notificationStyleOverride":"MOTIVATIONAL"')
    expect(screen.getByLabelText("Push notifications")).toHaveProperty("checked", false)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/note-1/read") && init?.method === "PATCH",
      ),
    ).toBe(true)
  })

  it("updates read state immediately and rolls it back when marking read fails", async () => {
    let finishMarkRead!: (response: Response) => void
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/notifications") && !url.endsWith("/unread-count"))
        return jsonResponse(notifications)
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 1 })
      if (url.endsWith("/api/notifications/preferences")) return jsonResponse(preferences)
      if (url.endsWith("/api/auth/csrf"))
        return jsonResponse({ token: "notification-csrf", headerName: "X-CSRF-TOKEN" })
      if (url.endsWith("/api/notifications/note-1/read") && init?.method === "PATCH")
        return new Promise((resolve) => {
          finishMarkRead = resolve
        })
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`)
    })

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )
    const title = await screen.findByText("Kitchen chore due")

    fireEvent.click(screen.getByRole("button", { name: "Mark Kitchen chore due as read" }))
    await waitFor(() => expect(finishMarkRead).toBeTypeOf("function"))
    expect(title.closest("article")?.getAttribute("data-read")).toBe("true")
    expect(screen.getByText("You're all caught up")).toBeTruthy()

    finishMarkRead(jsonResponse({ message: "Read update rejected." }, 500))
    await waitFor(() => {
      expect(title.closest("article")?.getAttribute("data-read")).toBe("false")
      expect(screen.getByText("1 unread")).toBeTruthy()
      expect(screen.getByRole("alert").textContent).toContain("Something went wrong.")
    })
  })

  it("keeps unsaved preference edits when notification data is invalidated", async () => {
    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )
    const funnyPreference = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: "Funny messages",
    })
    expect(funnyPreference.checked).toBe(false)
    fireEvent.click(funnyPreference)
    expect(funnyPreference.checked).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Mark Kitchen chore due as read" }))
    await waitFor(() =>
      expect(
        screen.getByText("Kitchen chore due").closest("article")?.getAttribute("data-read"),
      ).toBe("true"),
    )

    expect(funnyPreference.checked).toBe(true)
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/preferences") && init?.method !== "PUT",
      ),
    ).toHaveLength(1)
  })

  it("preserves editable preference values when saving fails", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/notifications") && !url.endsWith("/unread-count"))
        return jsonResponse(notifications)
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 1 })
      if (url.endsWith("/api/notifications/preferences") && init?.method === "PUT")
        return jsonResponse({ message: "Save failed." }, 500)
      if (url.endsWith("/api/notifications/preferences")) return jsonResponse(preferences)
      if (url.endsWith("/api/auth/csrf"))
        return jsonResponse({ token: "notification-csrf", headerName: "X-CSRF-TOKEN" })
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`)
    })

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )
    const funnyPreference = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: "Funny messages",
    })
    fireEvent.click(funnyPreference)
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Something went wrong."),
    )
    expect(funnyPreference.checked).toBe(true)
  })

  it("marks all unread notifications read optimistically", async () => {
    let finishMarkAll!: (response: Response) => void
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/notifications") && !url.endsWith("/unread-count"))
        return jsonResponse(notifications)
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 1 })
      if (url.endsWith("/api/notifications/preferences")) return jsonResponse(preferences)
      if (url.endsWith("/api/auth/csrf"))
        return jsonResponse({ token: "notification-csrf", headerName: "X-CSRF-TOKEN" })
      if (url.endsWith("/api/notifications/read-all") && init?.method === "PATCH")
        return new Promise((resolve) => {
          finishMarkAll = resolve
        })
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`)
    })

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )
    const title = await screen.findByText("Kitchen chore due")

    fireEvent.click(screen.getByRole("button", { name: "Read all" }))
    await waitFor(() => expect(finishMarkAll).toBeTypeOf("function"))
    expect(title.closest("article")?.getAttribute("data-read")).toBe("true")
    expect(screen.getByText("You're all caught up")).toBeTruthy()

    finishMarkAll(jsonResponse({ message: "Read-all update rejected." }, 500))
    await waitFor(() => {
      expect(title.closest("article")?.getAttribute("data-read")).toBe("false")
      expect(screen.getByText("1 unread")).toBeTruthy()
      expect(screen.getByRole("alert").textContent).toContain("Something went wrong.")
    })
  })

  it("waits for an explicit save before enabling or disabling push", async () => {
    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )
    const pushCheckbox = await screen.findByLabelText("Push notifications")

    fireEvent.click(pushCheckbox)
    await waitFor(() => expect(pushCheckbox).toHaveProperty("checked", true))
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/preferences") && init?.method === "PUT",
      ),
    ).toBe(false)
    expect(screen.queryByText("Preferences saved.")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
    expect(await screen.findByText("Preferences saved.")).toBeTruthy()
    expect(vi.mocked(createBrowserPushSubscription)).toHaveBeenCalledWith(expect.any(String))
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/push-subscriptions") && init?.method === "PUT",
      ),
    ).toBe(true)
  })

  it("shows a clear empty state when there are no notifications", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/api/notifications") && !url.endsWith("/unread-count"))
        return jsonResponse([])
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 0 })
      if (url.endsWith("/api/notifications/preferences")) return jsonResponse(preferences)
      throw new Error(`Unexpected request: ${url}`)
    })
    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )
    expect(await screen.findByText("No notifications yet")).toBeTruthy()
  })
})
