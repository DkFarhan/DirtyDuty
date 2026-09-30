// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createBrowserPushSubscription, removeBrowserPushSubscription } from "./push"

const permissionRequest = vi.fn<() => Promise<NotificationPermission>>()
const register = vi.fn()
const getRegistration = vi.fn()
const getSubscription = vi.fn()
const subscribe = vi.fn()
const unsubscribe = vi.fn()
const subscription = {
  endpoint: "https://push.example.test/subscription",
  expirationTime: null,
  options: { applicationServerKey: null, userVisibleOnly: true },
  getKey: () => null,
  toJSON: () => ({
    endpoint: "https://push.example.test/subscription",
    expirationTime: null,
    keys: { p256dh: "client-key", auth: "auth-key" },
  }),
  unsubscribe,
} satisfies PushSubscription

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
const originalPushManager = Object.getOwnPropertyDescriptor(window, "PushManager")

describe("browser push helpers", () => {
  beforeEach(() => {
    permissionRequest.mockReset()
    register.mockReset()
    getRegistration.mockReset()
    getSubscription.mockReset()
    subscribe.mockReset()
    unsubscribe.mockReset()
    vi.stubGlobal("Notification", class {
      static requestPermission = permissionRequest
    })
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} })
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, getRegistration },
    })
    register.mockResolvedValue({ pushManager: { getSubscription, subscribe } })
    getRegistration.mockResolvedValue({ pushManager: { getSubscription } })
    getSubscription.mockResolvedValue(null)
    subscribe.mockResolvedValue(subscription)
    unsubscribe.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker)
    else Reflect.deleteProperty(navigator, "serviceWorker")
    if (originalPushManager) Object.defineProperty(window, "PushManager", originalPushManager)
    else Reflect.deleteProperty(window, "PushManager")
  })

  it("requests permission and subscribes the browser through the service worker", async () => {
    permissionRequest.mockResolvedValue("granted")

    await expect(createBrowserPushSubscription("BNc-test-key")).resolves.toBe(subscription)

    expect(permissionRequest).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith("/service-worker.js")
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
  })

  it("stops before registering a worker when browser permission is denied", async () => {
    permissionRequest.mockResolvedValue("denied")

    await expect(createBrowserPushSubscription("BNc-test-key")).rejects.toThrow(/permission was denied/)
    expect(register).not.toHaveBeenCalled()
  })

  it("unsubscribes the current browser subscription", async () => {
    getSubscription.mockResolvedValue(subscription)

    await expect(removeBrowserPushSubscription()).resolves.toBe(subscription.endpoint)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
