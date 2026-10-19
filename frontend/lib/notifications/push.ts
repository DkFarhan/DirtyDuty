export type BrowserPushSubscriptionStatus =
  "unsupported" | "permission-required" | "permission-denied" | "missing" | "subscribed"

export async function getBrowserPushSubscriptionStatus(): Promise<BrowserPushSubscriptionStatus> {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return "unsupported"
  }

  if (Notification.permission === "denied") return "permission-denied"
  if (Notification.permission !== "granted") return "permission-required"

  const registration = await navigator.serviceWorker.getRegistration("/")
  const subscription = await registration?.pushManager.getSubscription()
  return subscription ? "subscribed" : "missing"
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
