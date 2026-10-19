// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { clearCsrfToken } from "@/lib/auth/api"
import { ChoreSyncProvider } from "@/lib/chore-sync/store"
import {
  createBrowserPushSubscription,
  getBrowserPushSubscriptionStatus,
  removeBrowserPushSubscription,
} from "@/lib/notifications/push"
import { NotificationsScreen } from "./screens/notifications-screen"

vi.mock("@/lib/notifications/push", () => ({
  createBrowserPushSubscription: vi.fn(),
  getBrowserPushSubscriptionStatus: vi.fn(),
  removeBrowserPushSubscription: vi.fn(),
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
let pushSubscriptionRequestFails = false

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("notifications screen", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    currentPreferences = { ...preferences }
    pushSubscriptionRequestFails = false
    vi.mocked(removeBrowserPushSubscription).mockReset()
    vi.mocked(createBrowserPushSubscription).mockReset()
    vi.mocked(getBrowserPushSubscriptionStatus).mockReset()
    vi.mocked(getBrowserPushSubscriptionStatus).mockResolvedValue("unsupported")
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/notifications") && !url.endsWith("/unread-count"))
        return jsonResponse(notifications)
      if (url.endsWith("/api/notifications/unread-count")) return jsonResponse({ count: 1 })
      if (url.endsWith("/api/notifications/preferences") && init?.method === "PUT") {
        return jsonResponse(JSON.parse(String(init.body)))
      }
      if (url.endsWith("/api/notifications/preferences")) return jsonResponse(currentPreferences)
      if (url.endsWith("/api/notifications/push/public-key"))
        return jsonResponse({ publicKey: "test-vapid-key", available: true })
      if (url.endsWith("/api/auth/csrf"))
        return jsonResponse({ token: "notification-csrf", headerName: "X-CSRF-TOKEN" })
      if (
        url.endsWith("/api/notifications/note-1/read") ||
        url.endsWith("/api/notifications/read-all")
      )
        return new Response(null, { status: 204 })
      if (url.endsWith("/api/notifications/push-subscriptions")) {
        return pushSubscriptionRequestFails
          ? jsonResponse({ message: "Temporary failure" }, 500)
          : new Response(null, { status: 204 })
      }
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
    expect(screen.getByLabelText("Quiet hours start")).toHaveProperty("value", "21:30")

    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }))
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

  it("offers user-initiated recovery when enabled push has no browser subscription", async () => {
    currentPreferences = { ...preferences, pushEnabled: true }
    vi.mocked(getBrowserPushSubscriptionStatus).mockResolvedValue("missing")

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )

    const restoreButton = await screen.findByRole("button", {
      name: "Restore push notifications",
    })
    expect(vi.mocked(createBrowserPushSubscription)).not.toHaveBeenCalled()

    fireEvent.click(restoreButton)

    expect(
      await screen.findByText("This browser’s push subscription is synchronized."),
    ).toBeTruthy()
    expect(vi.mocked(createBrowserPushSubscription)).toHaveBeenCalledWith("test-vapid-key")
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/push-subscriptions") && init?.method === "PUT",
      ),
    ).toHaveLength(1)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/preferences") && init?.method === "PUT",
      ),
    ).toBe(false)
  })

  it("lets the user synchronize an existing browser subscription with the current account", async () => {
    currentPreferences = { ...preferences, pushEnabled: true }
    vi.mocked(getBrowserPushSubscriptionStatus).mockResolvedValue("subscribed")

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )

    const syncButton = await screen.findByRole("button", { name: "Sync this browser" })
    expect(vi.mocked(createBrowserPushSubscription)).not.toHaveBeenCalled()
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/push-subscriptions") && init?.method === "PUT",
      ),
    ).toBe(false)

    fireEvent.click(syncButton)

    expect(
      await screen.findByText("This browser’s push subscription is synchronized."),
    ).toBeTruthy()
    expect(vi.mocked(createBrowserPushSubscription)).toHaveBeenCalledWith("test-vapid-key")
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/api/notifications/push-subscriptions") && init?.method === "PUT",
      ),
    ).toHaveLength(1)
  })

  it("keeps recovery available after backend synchronization fails", async () => {
    currentPreferences = { ...preferences, pushEnabled: true }
    pushSubscriptionRequestFails = true
    vi.mocked(getBrowserPushSubscriptionStatus).mockResolvedValue("missing")

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )

    fireEvent.click(await screen.findByRole("button", { name: "Restore push notifications" }))

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy()
    expect(await screen.findByRole("button", { name: "Retry push setup" })).toBeTruthy()
    expect(screen.getByLabelText("Push notifications")).toHaveProperty("checked", true)
  })

  it("does not inspect or restore push when the saved preference is disabled", async () => {
    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )

    await screen.findByLabelText("Push notifications")
    expect(getBrowserPushSubscriptionStatus).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: /restore push|enable push|retry push/i }),
    ).toBeNull()
  })

  it("directs users with blocked permission to settings without retrying a permission prompt", async () => {
    currentPreferences = { ...preferences, pushEnabled: true }
    vi.mocked(getBrowserPushSubscriptionStatus).mockResolvedValue("permission-denied")

    render(
      <ChoreSyncProvider>
        <NotificationsScreen />
      </ChoreSyncProvider>,
    )

    expect(await screen.findByText(/Push permission is blocked\. Allow notifications/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Check permission again" }))
    await waitFor(() => expect(getBrowserPushSubscriptionStatus).toHaveBeenCalledTimes(2))
    expect(createBrowserPushSubscription).not.toHaveBeenCalled()
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
