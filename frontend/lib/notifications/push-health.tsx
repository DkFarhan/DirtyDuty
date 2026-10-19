"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { notificationApi } from "./api"
import { createBrowserPushSubscription, inspectBrowserPushSubscription } from "./push"

const LOCAL_CHECK_INTERVAL_MS = 15 * 60 * 1000
const SERVER_CONFIRMATION_INTERVAL_MS = 24 * 60 * 60 * 1000
const CACHE_KEY_PREFIX = "dirtyduty.push-confirmation.v1"
const SYNC_REQUIRED_KEY_PREFIX = "dirtyduty.push-sync-required.v1"

export type PushHealthReason =
  | "missing-registration"
  | "worker-starting"
  | "unexpected-registration"
  | "missing-subscription"
  | "sync-required"
  | "permission-required"
  | "permission-denied"
  | "unsupported"
  | "check-failed"

export type PushHealthState =
  | { status: "loading" | "checking" | "disabled" | "healthy"; reason: null; message: null }
  | { status: "attention"; reason: PushHealthReason; message: string | null }

type PushSubscriptionHealthContextValue = {
  state: PushHealthState
  refresh: (force?: boolean) => Promise<void>
  restore: () => Promise<void>
  setPushEnabled: (enabled: boolean) => void
}

const PushSubscriptionHealthContext = createContext<PushSubscriptionHealthContextValue | null>(null)

function messageFor(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "Unable to check push notifications right now. Please try again."
}

async function endpointFingerprint(endpoint: string) {
  const subtle = window.crypto?.subtle
  if (!subtle) throw new Error("Secure browser storage is unavailable for push health checks.")
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function cachedConfirmation(userId: string, fingerprint: string) {
  try {
    const value = Number(localStorage.getItem(`${CACHE_KEY_PREFIX}:${userId}:${fingerprint}`))
    if (!Number.isFinite(value) || value <= 0 || value > Date.now()) return null
    return value
  } catch {
    return null
  }
}

function cacheConfirmation(userId: string, fingerprint: string, timestamp: string) {
  const value = Date.parse(timestamp)
  if (!Number.isFinite(value) || value <= 0 || value > Date.now()) return
  try {
    localStorage.setItem(`${CACHE_KEY_PREFIX}:${userId}:${fingerprint}`, String(value))
  } catch {
    // Server-side throttling remains authoritative when browser storage is unavailable.
  }
}

function isSyncRequiredCached(userId: string, fingerprint: string) {
  try {
    const value = Number(
      localStorage.getItem(`${SYNC_REQUIRED_KEY_PREFIX}:${userId}:${fingerprint}`),
    )
    const age = Date.now() - value
    return Number.isFinite(value) && value > 0 && age >= 0 && age < SERVER_CONFIRMATION_INTERVAL_MS
  } catch {
    return false
  }
}

function cacheSyncRequired(userId: string, fingerprint: string) {
  try {
    localStorage.setItem(`${SYNC_REQUIRED_KEY_PREFIX}:${userId}:${fingerprint}`, String(Date.now()))
  } catch {
    return
  }
}

function clearSyncRequired(userId: string, fingerprint: string) {
  try {
    localStorage.removeItem(`${SYNC_REQUIRED_KEY_PREFIX}:${userId}:${fingerprint}`)
  } catch {
    return
  }
}

export function PushSubscriptionHealthProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const [state, setState] = useState<PushHealthState>({
    status: "loading",
    reason: null,
    message: null,
  })
  const [pushEnabled, setPushEnabledState] = useState<boolean | null>(null)
  const currentUserIdRef = useRef<string | null>(user?.userId ?? null)
  const preferenceUserIdRef = useRef<string | null>(null)
  const pushEnabledRef = useRef(false)
  const generationRef = useRef(0)
  const lastLocalCheckAtRef = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const restoreInFlightRef = useRef<Promise<void> | null>(null)
  const preferenceRetryInFlightRef = useRef<Promise<void> | null>(null)
  const preferenceFailedRef = useRef(false)
  const mountedRef = useRef(true)
  currentUserIdRef.current = user?.userId ?? null

  const isCurrent = useCallback((userId: string, generation: number) => {
    return (
      mountedRef.current &&
      currentUserIdRef.current === userId &&
      preferenceUserIdRef.current === userId &&
      pushEnabledRef.current &&
      generationRef.current === generation
    )
  }, [])

  const checkHealth = useCallback(
    async (force = false) => {
      const userId = user?.userId
      if (
        !userId ||
        !isAuthenticated ||
        preferenceUserIdRef.current !== userId ||
        !pushEnabledRef.current
      ) {
        return
      }
      if (restoreInFlightRef.current) return restoreInFlightRef.current
      if (inFlightRef.current) return inFlightRef.current
      const now = Date.now()
      if (!force && now - lastLocalCheckAtRef.current < LOCAL_CHECK_INTERVAL_MS) return
      lastLocalCheckAtRef.current = now
      const generation = generationRef.current
      const check = (async () => {
        if (mountedRef.current) {
          setState({ status: "checking", reason: null, message: null })
        }
        try {
          const inspection = await inspectBrowserPushSubscription()
          if (!isCurrent(userId, generation)) return
          if (inspection.status !== "subscribed") {
            const status = inspection.status
            const reason: PushHealthReason =
              status === "missing"
                ? "missing-subscription"
                : status === "missing-registration" ||
                    status === "worker-starting" ||
                    status === "unexpected-registration"
                  ? status
                  : status
            const message =
              reason === "permission-denied"
                ? "Allow notifications for DirtyDuty in your browser or device settings, then check again."
                : reason === "permission-required"
                  ? "Notification permission has not been granted for this browser."
                  : reason === "unsupported"
                    ? "This browser does not support push notifications."
                    : reason === "missing-registration"
                      ? "DirtyDuty’s notification service worker is not registered in this browser."
                      : reason === "unexpected-registration"
                        ? "DirtyDuty’s notification service worker needs to be refreshed."
                        : reason === "worker-starting"
                          ? "DirtyDuty’s notification service worker is starting."
                          : "This browser no longer has a push subscription."
            setState({ status: "attention", reason, message })
            return
          }

          const fingerprint = await endpointFingerprint(inspection.subscription.endpoint)
          if (!isCurrent(userId, generation)) return
          if (isSyncRequiredCached(userId, fingerprint)) {
            setState({
              status: "attention",
              reason: "sync-required",
              message:
                "This browser subscription is not confirmed for your account. Sync it to continue receiving reminders.",
            })
            return
          }
          const cachedAt = cachedConfirmation(userId, fingerprint)
          if (cachedAt && now - cachedAt < SERVER_CONFIRMATION_INTERVAL_MS) {
            setState({ status: "healthy", reason: null, message: null })
            return
          }

          const keys = inspection.subscription.toJSON().keys
          if (!keys?.p256dh || !keys.auth) {
            throw new Error("The browser returned an incomplete push subscription.")
          }
          const result = await notificationApi.confirmPushSubscription({
            endpoint: inspection.subscription.endpoint,
            publicKey: keys.p256dh,
            authSecret: keys.auth,
          })
          if (!isCurrent(userId, generation)) return
          if (result.status === "CONFIRMED" && result.lastClientConfirmedAt) {
            clearSyncRequired(userId, fingerprint)
            cacheConfirmation(userId, fingerprint, result.lastClientConfirmedAt)
            setState({ status: "healthy", reason: null, message: null })
          } else if (result.status === "SYNC_REQUIRED") {
            cacheSyncRequired(userId, fingerprint)
            setState({
              status: "attention",
              reason: "sync-required",
              message:
                "This browser subscription is not confirmed for your account. Sync it to continue receiving reminders.",
            })
          } else {
            pushEnabledRef.current = false
            setPushEnabledState(false)
            setState({ status: "disabled", reason: null, message: null })
          }
        } catch (error) {
          if (!isCurrent(userId, generation)) return
          setState({
            status: "attention",
            reason: "check-failed",
            message: messageFor(error),
          })
        }
      })()
      inFlightRef.current = check
      try {
        await check
      } finally {
        if (inFlightRef.current === check) inFlightRef.current = null
      }
    },
    [isAuthenticated, isCurrent, user?.userId],
  )

  const refresh = useCallback(
    async (force = false) => {
      const userId = user?.userId
      if (
        !userId ||
        !isAuthenticated ||
        preferenceUserIdRef.current !== userId ||
        !preferenceFailedRef.current
      ) {
        return checkHealth(force)
      }
      if (preferenceRetryInFlightRef.current) return preferenceRetryInFlightRef.current
      const retry = (async () => {
        try {
          const preferences = await notificationApi.preferences()
          if (!mountedRef.current || currentUserIdRef.current !== userId) return
          preferenceFailedRef.current = false
          pushEnabledRef.current = preferences.pushEnabled
          setPushEnabledState(preferences.pushEnabled)
          if (preferences.pushEnabled) await checkHealth(true)
          else setState({ status: "disabled", reason: null, message: null })
        } catch (error) {
          if (!mountedRef.current || currentUserIdRef.current !== userId) return
          setState({
            status: "attention",
            reason: "check-failed",
            message: messageFor(error),
          })
        }
      })()
      preferenceRetryInFlightRef.current = retry
      try {
        await retry
      } finally {
        if (preferenceRetryInFlightRef.current === retry) {
          preferenceRetryInFlightRef.current = null
        }
      }
    },
    [checkHealth, isAuthenticated, user?.userId],
  )

  const setPushEnabled = useCallback(
    (enabled: boolean) => {
      const userId = user?.userId
      if (!userId || !isAuthenticated) return
      generationRef.current += 1
      inFlightRef.current = null
      restoreInFlightRef.current = null
      preferenceFailedRef.current = false
      preferenceUserIdRef.current = userId
      pushEnabledRef.current = enabled
      setPushEnabledState(enabled)
      lastLocalCheckAtRef.current = 0
      setState(
        enabled
          ? { status: "loading", reason: null, message: null }
          : { status: "disabled", reason: null, message: null },
      )
      if (enabled) void refresh(true)
    },
    [isAuthenticated, refresh, user?.userId],
  )

  const restore = useCallback(async () => {
    const userId = user?.userId
    if (
      !userId ||
      !isAuthenticated ||
      preferenceUserIdRef.current !== userId ||
      !pushEnabledRef.current ||
      restoreInFlightRef.current
    ) {
      return
    }
    const generation = generationRef.current
    if (inFlightRef.current) await inFlightRef.current
    if (!isCurrent(userId, generation) || restoreInFlightRef.current) return
    const operation = (async () => {
      setState({ status: "checking", reason: null, message: null })
      const configuration = await notificationApi.pushPublicKey()
      if (!isCurrent(userId, generation)) return
      const publicKey = configuration.publicKey
      if (!configuration.available || !publicKey) {
        throw new Error("Push notifications are currently unavailable.")
      }
      const inspection = await inspectBrowserPushSubscription()
      if (!isCurrent(userId, generation)) return
      const subscription =
        inspection.status === "subscribed"
          ? inspection.subscription
          : await createBrowserPushSubscription(publicKey)
      if (!isCurrent(userId, generation)) return
      const keys = subscription.toJSON().keys
      if (!keys?.p256dh || !keys.auth) {
        throw new Error("Push notifications could not be enabled. Please try again.")
      }
      const fingerprint = await endpointFingerprint(subscription.endpoint)
      if (!isCurrent(userId, generation)) return
      try {
        await notificationApi.subscribePush({
          endpoint: subscription.endpoint,
          publicKey: keys.p256dh,
          authSecret: keys.auth,
        })
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          cacheSyncRequired(userId, fingerprint)
        }
        throw error
      }
      if (!isCurrent(userId, generation)) return
      const result = await notificationApi.confirmPushSubscription({
        endpoint: subscription.endpoint,
        publicKey: keys.p256dh,
        authSecret: keys.auth,
      })
      if (!isCurrent(userId, generation)) return
      if (result.status === "CONFIRMED" && result.lastClientConfirmedAt) {
        clearSyncRequired(userId, fingerprint)
        cacheConfirmation(userId, fingerprint, result.lastClientConfirmedAt)
        setState({ status: "healthy", reason: null, message: null })
      } else if (result.status === "SYNC_REQUIRED") {
        cacheSyncRequired(userId, fingerprint)
        setState({
          status: "attention",
          reason: "sync-required",
          message:
            "This browser subscription could not be confirmed for your account. Check which account owns it.",
        })
      } else {
        pushEnabledRef.current = false
        preferenceFailedRef.current = false
        setPushEnabledState(false)
        setState({ status: "disabled", reason: null, message: null })
      }
    })()
    restoreInFlightRef.current = operation
    try {
      await operation
    } catch (error) {
      if (!isCurrent(userId, generation)) return
      const isSubscriptionConflict = error instanceof ApiError && error.status === 409
      const reason = isSubscriptionConflict ? "sync-required" : "check-failed"
      setState({
        status: "attention",
        reason,
        message: isSubscriptionConflict
          ? "This browser subscription is registered to another account. Sign in with that account or use a different browser subscription."
          : messageFor(error),
      })
    } finally {
      if (restoreInFlightRef.current === operation) restoreInFlightRef.current = null
    }
  }, [isAuthenticated, isCurrent, user?.userId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current = null
    restoreInFlightRef.current = null
    lastLocalCheckAtRef.current = 0
    const userId = user?.userId
    currentUserIdRef.current = userId ?? null
    preferenceUserIdRef.current = null
    preferenceFailedRef.current = false
    preferenceRetryInFlightRef.current = null
    pushEnabledRef.current = false
    if (isAuthLoading) {
      setPushEnabledState(null)
      setState({ status: "loading", reason: null, message: null })
      return
    }
    if (!isAuthenticated || !userId) {
      setPushEnabledState(false)
      setState({ status: "disabled", reason: null, message: null })
      return
    }

    let cancelled = false
    setPushEnabledState(null)
    setState({ status: "loading", reason: null, message: null })
    void notificationApi
      .preferences()
      .then((preferences) => {
        if (cancelled || currentUserIdRef.current !== userId) return
        preferenceFailedRef.current = false
        preferenceUserIdRef.current = userId
        pushEnabledRef.current = preferences.pushEnabled
        setPushEnabledState(preferences.pushEnabled)
        if (preferences.pushEnabled) {
          void refresh(true)
        } else {
          setState({ status: "disabled", reason: null, message: null })
        }
      })
      .catch((error: unknown) => {
        if (cancelled || currentUserIdRef.current !== userId) return
        preferenceFailedRef.current = true
        preferenceUserIdRef.current = userId
        pushEnabledRef.current = false
        setPushEnabledState(false)
        setState({
          status: "attention",
          reason: "check-failed",
          message: messageFor(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isAuthLoading, refresh, user?.userId])

  useEffect(() => {
    if (!isAuthenticated || !user?.userId || !pushEnabled) return
    const onResume = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const onOnline = () => void refresh(true)
    document.addEventListener("visibilitychange", onResume)
    window.addEventListener("pageshow", onResume)
    window.addEventListener("online", onOnline)
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, LOCAL_CHECK_INTERVAL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onResume)
      window.removeEventListener("pageshow", onResume)
      window.removeEventListener("online", onOnline)
      window.clearInterval(interval)
    }
  }, [isAuthenticated, pushEnabled, refresh, user?.userId])

  const value: PushSubscriptionHealthContextValue = {
    state,
    refresh,
    restore,
    setPushEnabled,
  }
  return (
    <PushSubscriptionHealthContext.Provider value={value}>
      {children}
    </PushSubscriptionHealthContext.Provider>
  )
}

export function usePushSubscriptionHealth() {
  const context = useContext(PushSubscriptionHealthContext)
  if (!context) {
    throw new Error("usePushSubscriptionHealth must be used within its provider")
  }
  return context
}
