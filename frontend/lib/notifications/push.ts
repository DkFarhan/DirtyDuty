export type BrowserPushSubscriptionStatus =
  | "unsupported"
  | "permission-required"
  | "permission-denied"
  | "missing-registration"
  | "worker-starting"
  | "unexpected-registration"
  | "missing"
  | "subscribed"

export type BrowserPushSubscriptionInspection =
  | { status: "subscribed"; subscription: PushSubscription }
  | {
      status: Exclude<BrowserPushSubscriptionStatus, "subscribed">
      subscription: null
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

  const registration = await navigator.serviceWorker.getRegistration("/")
  if (!registration) return { status: "missing-registration", subscription: null }
  if (registration.scope !== new URL("/", window.location.origin).href) {
    return { status: "unexpected-registration", subscription: null }
  }
  const worker = registration.active ?? registration.waiting ?? registration.installing
  if (!worker) return { status: "worker-starting", subscription: null }
  if (worker.scriptURL !== new URL("/service-worker.js", window.location.origin).href) {
    return { status: "unexpected-registration", subscription: null }
  }

  const subscription = await registration.pushManager.getSubscription()
  return subscription
    ? { status: "subscribed", subscription }
    : { status: "missing", subscription: null }
}

export async function getBrowserPushSubscriptionStatus(): Promise<BrowserPushSubscriptionStatus> {
  return (await inspectBrowserPushSubscription()).status
}

export async function createBrowserPushSubscription(publicKey: string): Promise<PushSubscription> {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    throw new Error("Push notifications are not supported in this browser.")
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : Notification.permission === "denied"
        ? "denied"
        : await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notification permission was denied in your browser settings."
        : "Notification permission is required to enable push notifications.",
    )
  }

  const registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing

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

function decodeVapidKey(encoded: string): ArrayBuffer {
  const padded = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=")
  const raw = window.atob(padded)
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0))
  return bytes.buffer
}
