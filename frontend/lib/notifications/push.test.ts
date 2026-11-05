// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createBrowserPushSubscription,
  getBrowserPushSubscriptionStatus,
  inspectBrowserPushDevice,
  repairBrowserPushSubscription,
  requestBrowserNotificationPermission,
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
  options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer, userVisibleOnly: true },
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

function mockWorker(state: ServiceWorkerState) {
  const listeners = new Set<EventListener>()
  return {
    scriptURL: new URL("/service-worker.js", window.location.origin).href,
    state,
    addEventListener: vi.fn((_name: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_name: string, listener: EventListener) =>
      listeners.delete(listener),
    ),
    dispatch: () => listeners.forEach((listener) => listener(new Event("statechange"))),
  } as unknown as ServiceWorker & { dispatch: () => void }
}

function activeRegistration() {
  return {
    scope: new URL("/", window.location.origin).href,
    active: mockWorker("activated"),
    waiting: null,
    installing: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    pushManager: { getSubscription, subscribe },
  }
}

describe("browser push helpers", () => {
  beforeEach(() => {
    permissionRequest.mockReset()
    register.mockReset()
    getRegistration.mockReset()
    getSubscription.mockReset()
    subscribe.mockReset()
    unsubscribe.mockReset()
    permissionState = "default"
    vi.useRealTimers()
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
    register.mockImplementation(async () => activeRegistration())
    getRegistration.mockResolvedValue(activeRegistration())
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

  it("subscribes through the active root service worker without prompting implicitly", async () => {
    permissionState = "granted"

    await expect(createBrowserPushSubscription("AQID")).resolves.toBe(subscription)

    expect(permissionRequest).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledWith("/service-worker.js", { scope: "/" })
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
  })

  it("requests permission only through its explicit permission action", async () => {
    permissionRequest.mockResolvedValue("granted")

    await expect(requestBrowserNotificationPermission()).resolves.toBe("granted")

    expect(permissionRequest).toHaveBeenCalledOnce()
  })

  it("waits for a first-install worker to activate before subscribing", async () => {
    permissionState = "granted"
    const worker = mockWorker("installing")
    const registration = {
      ...activeRegistration(),
      active: null,
      installing: worker,
      pushManager: { getSubscription, subscribe },
    }
    register.mockResolvedValue(registration)

    const result = createBrowserPushSubscription("AQID")
    await Promise.resolve()
    expect(subscribe).not.toHaveBeenCalled()
    ;(worker as ServiceWorker & { state: ServiceWorkerState }).state = "activated"
    ;(registration as { active: ServiceWorker | null }).active = worker
    worker.dispatch()

    await expect(result).resolves.toBe(subscription)
    expect(subscribe).toHaveBeenCalledOnce()
    expect(worker.removeEventListener).toHaveBeenCalled()
  })

  it("fails when the worker never activates and removes its listeners", async () => {
    permissionState = "granted"
    const worker = mockWorker("installing")
    const registration = {
      ...activeRegistration(),
      active: null,
      installing: worker,
      pushManager: { getSubscription, subscribe },
    }
    register.mockResolvedValue(registration)
    vi.useFakeTimers()

    const result = createBrowserPushSubscription("AQID")
    const rejection = expect(result).rejects.toThrow(/did not become ready/)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(15_000)

    await rejection
    expect(subscribe).not.toHaveBeenCalled()
    expect(worker.removeEventListener).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("does not reuse a subscription with an incompatible VAPID key", async () => {
    permissionState = "granted"
    getSubscription.mockResolvedValue({
      ...subscription,
      options: { applicationServerKey: new Uint8Array([1, 2, 4]).buffer },
    })

    await expect(createBrowserPushSubscription("AQID")).rejects.toThrow(/different VAPID key/)
    expect(subscribe).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it("repairs only the current browser subscription after explicit confirmation", async () => {
    permissionState = "granted"
    getSubscription.mockResolvedValue(subscription)

    await expect(repairBrowserPushSubscription("AQID")).resolves.toBe(subscription)

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledOnce()
  })

  it("reuses an existing subscription without requesting already-granted permission", async () => {
    permissionState = "granted"
    getSubscription.mockResolvedValue(subscription)

    await expect(createBrowserPushSubscription("AQID")).resolves.toBe(subscription)

    expect(permissionRequest).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("does not request permission again after it has been denied", async () => {
    permissionState = "denied"

    await expect(createBrowserPushSubscription("AQID")).rejects.toThrow(/permission was denied/)

    expect(permissionRequest).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it("reports a granted permission with no subscription as recoverable", async () => {
    permissionState = "granted"
    getRegistration.mockResolvedValue(activeRegistration())
    getSubscription.mockResolvedValue(null)

    await expect(getBrowserPushSubscriptionStatus()).resolves.toBe("missing")
    expect(getRegistration).toHaveBeenCalledWith("/")
    expect(permissionRequest).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("reports an existing subscription without modifying it", async () => {
    permissionState = "granted"
    getRegistration.mockResolvedValue(activeRegistration())
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

  it("reports device permission separately from a still-registered subscription", async () => {
    permissionState = "denied"
    getRegistration.mockResolvedValue(activeRegistration())
    getSubscription.mockResolvedValue(subscription)

    await expect(inspectBrowserPushDevice()).resolves.toEqual({
      permission: "denied",
      worker: "ready",
      subscription: "present",
    })
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
