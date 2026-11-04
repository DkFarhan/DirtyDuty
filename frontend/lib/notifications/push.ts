export type BrowserPushSubscriptionStatus =
  | "unsupported"
  | "permission-required"
  | "permission-denied"
  | "missing-registration"
  | "worker-starting"
  | "unexpected-registration"
  | "missing"
  | "subscribed"
  | "vapid-key-mismatch"

export type BrowserPushSubscriptionInspection =
  | { status: "subscribed"; subscription: PushSubscription }
  | {
      status: Exclude<BrowserPushSubscriptionStatus, "subscribed">
      subscription: null
    }

export type BrowserPushDeviceInspection = {
  permission: "granted" | "default" | "denied" | "unsupported"
  worker: "ready" | "missing" | "starting" | "unexpected" | "unsupported"
  subscription: "present" | "missing" | "unknown"
}

export async function inspectBrowserPushDevice(): Promise<BrowserPushDeviceInspection> {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { permission: "unsupported", worker: "unsupported", subscription: "unknown" }
  }

  const permission = Notification.permission
  const registration = await navigator.serviceWorker.getRegistration("/")
  if (!registration) {
    return { permission, worker: "missing", subscription: "unknown" }
  }
  if (registration.scope !== new URL("/", window.location.origin).href) {
    return { permission, worker: "unexpected", subscription: "unknown" }
  }
  const worker = registration.active ?? registration.waiting ?? registration.installing
  if (!worker) return { permission, worker: "starting", subscription: "unknown" }
  if (worker.scriptURL !== new URL("/service-worker.js", window.location.origin).href) {
    return { permission, worker: "unexpected", subscription: "unknown" }
  }

  const subscription = await registration.pushManager.getSubscription()
  return {
    permission,
    worker: registration.active?.state === "activated" ? "ready" : "starting",
    subscription: subscription ? "present" : "missing",
  }
}

export async function inspectBrowserPushSubscription(): Promise<BrowserPushSubscriptionInspection> {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { status: "unsupported", subscription: null }
  }
  if (Notification.permission === "denied") {
    return { status: "permission-denied", subscription: null }
  }
  if (Notification.permission !== "granted") {
    return { status: "permission-required", subscription: null }
  }

  const device = await inspectBrowserPushDevice()
  if (device.worker === "missing") return { status: "missing-registration", subscription: null }
  if (device.worker === "starting") return { status: "worker-starting", subscription: null }
  if (device.worker === "unexpected")
    return { status: "unexpected-registration", subscription: null }
  if (device.subscription !== "present") return { status: "missing", subscription: null }
  const registration = await navigator.serviceWorker.getRegistration("/")
  const subscription = await registration?.pushManager.getSubscription()
  return subscription
    ? { status: "subscribed", subscription }
    : { status: "missing", subscription: null }
}

export async function getBrowserPushSubscriptionStatus(): Promise<BrowserPushSubscriptionStatus> {
  return (await inspectBrowserPushSubscription()).status
}

export async function createBrowserPushSubscription(publicKey: string): Promise<PushSubscription> {
  assertPushSupport()
  if (Notification.permission !== "granted") {
    throw new Error(
      Notification.permission === "denied"
        ? "Notification permission was denied in your browser settings."
        : "Notification permission is required to enable push notifications.",
    )
  }

  const registration = await ensureRootServiceWorker()
  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    if (!matchesVapidKey(existing, publicKey)) throw new PushVapidKeyMismatchError()
    return existing
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(publicKey),
  })
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  assertPushSupport()
  if (Notification.permission !== "default") return Notification.permission
  return Notification.requestPermission()
}

export async function prepareBrowserPushWorker(): Promise<void> {
  assertPushSupport()
  await ensureRootServiceWorker()
}

export async function repairBrowserPushSubscription(publicKey: string): Promise<PushSubscription> {
  assertPushSupport()
  if (Notification.permission !== "granted") {
    throw new Error("Notification permission is required to repair this browser subscription.")
  }
  const registration = await ensureRootServiceWorker()
  const existing = await registration.pushManager.getSubscription()
  if (existing) await existing.unsubscribe()
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(publicKey),
  })
}

export async function removeBrowserPushSubscription(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration("/")
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return null

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}

export async function browserPushEndpointFingerprint(endpoint: string): Promise<string> {
  const subtle = window.crypto?.subtle
  if (!subtle) throw new Error("Secure browser storage is unavailable for push diagnostics.")
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export class PushVapidKeyMismatchError extends Error {
  constructor() {
    super("This browser subscription uses a different VAPID key and must be repaired.")
    this.name = "PushVapidKeyMismatchError"
  }
}

const WORKER_ACTIVATION_TIMEOUT_MS = 15_000

function assertPushSupport() {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    throw new Error(
      "Push notifications are not supported in this browser. Use a supported browser rather than a private or in-app browsing window.",
    )
  }
}

async function ensureRootServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
  const expectedScope = new URL("/", window.location.origin).href
  const expectedScript = new URL("/service-worker.js", window.location.origin).href
  if (registration.scope !== expectedScope) {
    throw new Error("DirtyDuty’s notification service worker has an unexpected scope.")
  }

  await new Promise<void>((resolve, reject) => {
    const workers = new Set<ServiceWorker>()
    let settled = false
    const timeout = window.setTimeout(
      () => finish(new Error("DirtyDuty’s notification service worker did not become ready.")),
      WORKER_ACTIVATION_TIMEOUT_MS,
    )

    const listenToWorker = (worker: ServiceWorker | null) => {
      if (!worker || workers.has(worker)) return
      workers.add(worker)
      worker.addEventListener("statechange", check)
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      registration.removeEventListener("updatefound", onUpdateFound)
      for (const worker of workers) worker.removeEventListener("statechange", check)
    }

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }

    const check = () => {
      listenToWorker(registration.installing)
      listenToWorker(registration.waiting)
      listenToWorker(registration.active)
      const active = registration.active
      if (active?.scriptURL === expectedScript && active.state === "activated") {
        finish()
      } else if (
        [registration.installing, registration.waiting, registration.active].some(
          (worker) => worker?.state === "redundant",
        )
      ) {
        finish(new Error("DirtyDuty’s notification service worker failed to activate."))
      }
    }

    const onUpdateFound = () => {
      listenToWorker(registration.installing)
      check()
    }

    registration.addEventListener("updatefound", onUpdateFound)
    check()
  })
  return registration
}

function matchesVapidKey(subscription: PushSubscription, encodedKey: string) {
  const subscribedKey = subscription.options.applicationServerKey
  if (!subscribedKey) return false
  const expectedKey = new Uint8Array(decodeVapidKey(encodedKey))
  const actualKey = new Uint8Array(subscribedKey)
  return (
    expectedKey.length === actualKey.length &&
    expectedKey.every((byte, index) => byte === actualKey[index])
  )
}

function decodeVapidKey(encoded: string): ArrayBuffer {
  const padded = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=")
  const raw = window.atob(padded)
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0))
  return bytes.buffer
}
