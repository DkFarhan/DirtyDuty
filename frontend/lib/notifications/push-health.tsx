"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { notificationApi } from "./api"
import {
  browserPushEndpointFingerprint,
  createBrowserPushSubscription,
  inspectBrowserPushDevice,
  inspectBrowserPushSubscription,
  prepareBrowserPushWorker,
  PushVapidKeyMismatchError,
  repairBrowserPushSubscription,
  requestBrowserNotificationPermission,
} from "./push"

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
  | "vapid-key-mismatch"
  | "check-failed"

export type PushDeviceState = {
  permission: "granted" | "default" | "denied" | "unsupported"
  worker: "ready" | "missing" | "starting" | "unexpected" | "unsupported" | "unknown"
  subscription: "present" | "missing" | "unknown"
  serverSync: "confirmed" | "required" | "unknown"
}

export type PushHealthState =
  | { status: "loading" | "checking" | "disabled" | "healthy"; reason: null; message: null }
  | { status: "attention"; reason: PushHealthReason; message: string | null }

type PushSubscriptionHealthContextValue = {
  state: PushHealthState
  refresh: (force?: boolean) => Promise<void>
  restore: () => Promise<boolean>
  repair: () => Promise<boolean>
  device: PushDeviceState
  cancelPendingSetup: () => void
  setPushEnabled: (enabled: boolean) => void
}

const PushSubscriptionHealthContext = createContext<PushSubscriptionHealthContextValue | null>(null)

function messageFor(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error && error.message
      ? error.message
      : "Unable to check push notifications right now. Please try again."
}

function currentPermission(): PushDeviceState["permission"] {
  if (!("Notification" in window)) return "unsupported"
  return Notification.permission
}

function initialDeviceState(): PushDeviceState {
  return {
    permission: typeof window === "undefined" ? "unsupported" : currentPermission(),
    worker: "unknown",
    subscription: "unknown",
    serverSync: "unknown",
  }
}

function deviceStateFromInspection(
  inspection: Awaited<ReturnType<typeof inspectBrowserPushDevice>>,
): PushDeviceState {
  return {
    ...inspection,
    serverSync: "unknown",
  }
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
  const [device, setDevice] = useState<PushDeviceState>(initialDeviceState)
  const currentUserIdRef = useRef<string | null>(user?.userId ?? null)
  const preferenceUserIdRef = useRef<string | null>(null)
  const pushEnabledRef = useRef(false)
  const generationRef = useRef(0)
  const lastLocalCheckAtRef = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const restoreInFlightRef = useRef<Promise<boolean> | null>(null)
  const preferenceRetryInFlightRef = useRef<Promise<void> | null>(null)
  const preferenceFailedRef = useRef(false)
  const mountedRef = useRef(true)
  const pendingPermissionIntentRef = useRef<{ userId: string; generation: number } | null>(null)
  const restoreRef = useRef<((repair?: boolean) => Promise<boolean>) | null>(null)
  const setupIntentInFlightRef = useRef(false)
  currentUserIdRef.current = user?.userId ?? null

  const isCurrent = useCallback((userId: string, generation: number) => {
    return (
      mountedRef.current &&
      currentUserIdRef.current === userId &&
      preferenceUserIdRef.current === userId &&
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
      if (restoreInFlightRef.current) {
        await restoreInFlightRef.current
        return
      }
      if (inFlightRef.current) {
        await inFlightRef.current
        return
      }
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
          setDevice(deviceStateFromInspection(await inspectBrowserPushDevice()))
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

          const fingerprint = await browserPushEndpointFingerprint(inspection.subscription.endpoint)
          if (!isCurrent(userId, generation)) return
          if (isSyncRequiredCached(userId, fingerprint)) {
            setDevice((current) => ({ ...current, serverSync: "required" }))
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
            setDevice((current) => ({ ...current, serverSync: "confirmed" }))
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
            setDevice((current) => ({ ...current, serverSync: "confirmed" }))
            clearSyncRequired(userId, fingerprint)
            cacheConfirmation(userId, fingerprint, result.lastClientConfirmedAt)
            setState({ status: "healthy", reason: null, message: null })
          } else if (result.status === "SYNC_REQUIRED") {
            setDevice((current) => ({ ...current, serverSync: "required" }))
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
      setupIntentInFlightRef.current = false
      pendingPermissionIntentRef.current = null
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

  const cancelPendingSetup = useCallback(() => {
    pendingPermissionIntentRef.current = null
    generationRef.current += 1
    inFlightRef.current = null
    lastLocalCheckAtRef.current = 0
  }, [])

  const restore = useCallback(
    async (repair = false): Promise<boolean> => {
      const userId = user?.userId
      if (
        !userId ||
        !isAuthenticated ||
        preferenceUserIdRef.current !== userId ||
        restoreInFlightRef.current ||
        setupIntentInFlightRef.current
      ) {
        return false
      }
      setupIntentInFlightRef.current = true
      const generation = generationRef.current
      let permission: NotificationPermission
      try {
        permission = await requestBrowserNotificationPermission()
      } catch (error) {
        setState({
          status: "attention",
          reason: "unsupported",
          message: messageFor(error),
        })
        setDevice(initialDeviceState())
        setupIntentInFlightRef.current = false
        return false
      }
      if (!isCurrent(userId, generation)) {
        setupIntentInFlightRef.current = false
        return false
      }
      setDevice((current) => ({ ...current, permission }))
      if (permission !== "granted") {
        if (permission === "default") {
          pendingPermissionIntentRef.current = { userId, generation }
        } else {
          pendingPermissionIntentRef.current = null
        }
        setState({
          status: "attention",
          reason: permission === "denied" ? "permission-denied" : "permission-required",
          message:
            permission === "denied"
              ? "Notifications are blocked for this browser. Allow them in browser or device site settings, then choose Enable or restore again."
              : "Permission was not granted yet. On Android Chrome, you can allow DirtyDuty in Site settings, then return here; this explicit setup will continue when permission becomes available.",
        })
        setupIntentInFlightRef.current = false
        return false
      }
      pendingPermissionIntentRef.current = null
      if (inFlightRef.current) await inFlightRef.current
      if (!isCurrent(userId, generation) || restoreInFlightRef.current) {
        setupIntentInFlightRef.current = false
        return false
      }
      const operation = (async () => {
        let completed = false
        setState({ status: "checking", reason: null, message: null })
        const configuration = await notificationApi.pushPublicKey()
        if (!isCurrent(userId, generation)) return false
        const publicKey = configuration.publicKey
        if (!configuration.available || !publicKey) {
          throw new Error("Push notifications are currently unavailable.")
        }
        await prepareBrowserPushWorker()
        if (!isCurrent(userId, generation)) return false
        let subscription: PushSubscription
        if (repair) {
          const inspection = await inspectBrowserPushSubscription()
          if (!isCurrent(userId, generation)) return false
          if (inspection.status === "subscribed") {
            await notificationApi.unsubscribePush(inspection.subscription.endpoint)
            if (!isCurrent(userId, generation)) return false
          }
          subscription = await repairBrowserPushSubscription(publicKey)
        } else {
          subscription = await createBrowserPushSubscription(publicKey)
        }
        if (!isCurrent(userId, generation)) return false
        const keys = subscription.toJSON().keys
        if (!keys?.p256dh || !keys.auth) {
          throw new Error("Push notifications could not be enabled. Please try again.")
        }
        const fingerprint = await browserPushEndpointFingerprint(subscription.endpoint)
        if (!isCurrent(userId, generation)) return false
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
        if (!isCurrent(userId, generation)) return false
        const result = await notificationApi.confirmPushSubscription({
          endpoint: subscription.endpoint,
          publicKey: keys.p256dh,
          authSecret: keys.auth,
        })
        if (!isCurrent(userId, generation)) return false
        if (result.status === "CONFIRMED" && result.lastClientConfirmedAt) {
          clearSyncRequired(userId, fingerprint)
          cacheConfirmation(userId, fingerprint, result.lastClientConfirmedAt)
          pushEnabledRef.current = true
          setPushEnabledState(true)
          setDevice({
            permission: "granted",
            worker: "ready",
            subscription: "present",
            serverSync: "confirmed",
          })
          setState({ status: "healthy", reason: null, message: null })
          completed = true
        } else if (result.status === "SYNC_REQUIRED") {
          cacheSyncRequired(userId, fingerprint)
          setDevice((current) => ({ ...current, subscription: "present", serverSync: "required" }))
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
        return completed
      })()
      restoreInFlightRef.current = operation
      try {
        return await operation
      } catch (error) {
        if (!isCurrent(userId, generation)) return false
        const isSubscriptionConflict = error instanceof ApiError && error.status === 409
        const isVapidMismatch = error instanceof PushVapidKeyMismatchError
        const reason = isSubscriptionConflict
          ? "sync-required"
          : isVapidMismatch
            ? "vapid-key-mismatch"
            : "check-failed"
        setState({
          status: "attention",
          reason,
          message: isSubscriptionConflict
            ? "This browser subscription is registered to another account. Sign in with that account or use a different browser subscription."
            : isVapidMismatch
              ? "This browser subscription was created with a different VAPID key. Repair only this browser’s subscription to match the current server key."
              : messageFor(error),
        })
        return false
      } finally {
        if (restoreInFlightRef.current === operation) restoreInFlightRef.current = null
        setupIntentInFlightRef.current = false
      }
    },
    [isAuthenticated, isCurrent, user?.userId],
  )
  restoreRef.current = restore

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      pendingPermissionIntentRef.current = null
    }
  }, [])

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current = null
    restoreInFlightRef.current = null
    setupIntentInFlightRef.current = false
    pendingPermissionIntentRef.current = null
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
          void prepareBrowserPushWorker()
            .then(() =>
              setDevice((current) => ({
                ...current,
                permission: currentPermission(),
                worker: "ready",
              })),
            )
            .catch((error: unknown) => {
              if (cancelled || currentUserIdRef.current !== userId) return
              setDevice((current) => ({ ...current, worker: "starting" }))
              setState({
                status: "attention",
                reason: "check-failed",
                message: messageFor(error),
              })
            })
          void refresh(true)
        } else {
          setState({ status: "disabled", reason: null, message: null })
          void inspectBrowserPushDevice().then((inspection) => {
            if (cancelled || currentUserIdRef.current !== userId) return
            setDevice(deviceStateFromInspection(inspection))
          })
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
    const continuePendingIntent = () => {
      const pending = pendingPermissionIntentRef.current
      if (
        !pending ||
        pending.userId !== currentUserIdRef.current ||
        pending.generation !== generationRef.current ||
        currentPermission() !== "granted"
      ) {
        return
      }
      pendingPermissionIntentRef.current = null
      void restoreRef.current?.()
    }
    let permissionStatus: PermissionStatus | null = null
    let cancelled = false
    const onPermissionChange = () => continuePendingIntent()
    const onResume = () => {
      setDevice((current) => ({ ...current, permission: currentPermission() }))
      continuePendingIntent()
    }
    if ("permissions" in navigator && navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "notifications" as PermissionName })
        .then((status) => {
          if (cancelled) return
          permissionStatus = status
          status.addEventListener("change", onPermissionChange)
          continuePendingIntent()
        })
        .catch(() => {
          // Visibility and page lifecycle events remain the fallback.
        })
    }
    document.addEventListener("visibilitychange", onResume)
    window.addEventListener("pageshow", onResume)
    return () => {
      cancelled = true
      permissionStatus?.removeEventListener("change", onPermissionChange)
      document.removeEventListener("visibilitychange", onResume)
      window.removeEventListener("pageshow", onResume)
    }
  }, [])

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
    restore: () => restore(false),
    repair: () => restore(true),
    device,
    cancelPendingSetup,
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
