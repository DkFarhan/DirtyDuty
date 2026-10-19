// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBrowserPushSubscription,
  getBrowserPushSubscriptionStatus,
  removeBrowserPushSubscription,
} from "./push"

const permissionRequest = vi.fn<() => Promise<NotificationPermission>>()
let permissionState: NotificationPermission = "default"
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
    permissionState = "default"
    vi.stubGlobal(
      "Notification",
      class {
        static get permission() {
          return permissionState
        }

        static requestPermission = permissionRequest
      },
    )
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
    if (originalServiceWorker)
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker)
    else Reflect.deleteProperty(navigator, "serviceWorker")
    if (originalPushManager) Object.defineProperty(window, "PushManager", originalPushManager)
    else Reflect.deleteProperty(window, "PushManager")
  })

  it("requests permission and subscribes the browser through the service worker", async () => {
    permissionRequest.mockResolvedValue("granted")

    await expect(createBrowserPushSubscription("BNc-test-key")).resolves.toBe(subscription)

    expect(permissionRequest).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith("/service-worker.js", { scope: "/" })
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
  })

  it("reuses an existing subscription without requesting already-granted permission", async () => {
    permissionState = "granted"
    getSubscription.mockResolvedValue(subscription)

    await expect(createBrowserPushSubscription("BNc-test-key")).resolves.toBe(subscription)

    expect(permissionRequest).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("does not request permission again after it has been denied", async () => {
    permissionState = "denied"

    await expect(createBrowserPushSubscription("BNc-test-key")).rejects.toThrow(
      /permission was denied/,
    )

    expect(permissionRequest).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it("reports a granted permission with no subscription as recoverable", async () => {
    permissionState = "granted"
    getRegistration.mockResolvedValue({ pushManager: { getSubscription } })
    getSubscription.mockResolvedValue(null)

    await expect(getBrowserPushSubscriptionStatus()).resolves.toBe("missing")
    expect(getRegistration).toHaveBeenCalledWith("/")
    expect(permissionRequest).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("reports an existing subscription without modifying it", async () => {
    permissionState = "granted"
    getRegistration.mockResolvedValue({ pushManager: { getSubscription } })
    getSubscription.mockResolvedValue(subscription)

    await expect(getBrowserPushSubscriptionStatus()).resolves.toBe("subscribed")
    expect(subscribe).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it("does not inspect subscription state when permission has not been granted", async () => {
    await expect(getBrowserPushSubscriptionStatus()).resolves.toBe("permission-required")
    expect(getRegistration).not.toHaveBeenCalled()
    expect(permissionRequest).not.toHaveBeenCalled()
  })

  it("reports denied permission without requesting it again", async () => {
    permissionState = "denied"

    await expect(getBrowserPushSubscriptionStatus()).resolves.toBe("permission-denied")

    expect(getRegistration).not.toHaveBeenCalled()
    expect(permissionRequest).not.toHaveBeenCalled()
  })

  it("reports unsupported browsers without attempting permission or worker access", async () => {
    Reflect.deleteProperty(window, "PushManager")

    await expect(getBrowserPushSubscriptionStatus()).resolves.toBe("unsupported")

    expect(permissionRequest).not.toHaveBeenCalled()
    expect(getRegistration).not.toHaveBeenCalled()
  })

  it("unsubscribes the current browser subscription", async () => {
    getSubscription.mockResolvedValue(subscription)

    await expect(removeBrowserPushSubscription()).resolves.toBe(subscription.endpoint)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
