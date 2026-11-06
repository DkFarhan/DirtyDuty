"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import {
  notificationApi,
  type Notification,
  type NotificationPreferences,
  type NotificationStyle,
} from "@/lib/notifications/api"
import { removeBrowserPushSubscription } from "@/lib/notifications/push"
import { usePushSubscriptionHealth } from "@/lib/notifications/push-health"
import { useChoreSync } from "@/lib/chore-sync/store"
import { notificationResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { SettingsRow } from "../primitives"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileDestinationHeader, ProfileDestinationView } from "./profile-screen-view"
import profileStyles from "./profile-screen-view.module.css"

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

const preferenceLabels: Array<
  [
    keyof Pick<
      NotificationPreferences,
      | "choreAssignedEnabled"
      | "choreRemindersEnabled"
      | "overdueEnabled"
      | "choreCompletionEnabled"
      | "householdUpdatesEnabled"
      | "funnyNotificationsEnabled"
      | "competitiveNotificationsEnabled"
    >,
    string,
    string,
  ]
> = [
  ["choreAssignedEnabled", "Chore assignments", "When a chore is assigned to you."],
  ["choreRemindersEnabled", "Chore reminders", "Get a reminder when chores are due."],
  ["overdueEnabled", "Overdue reminders", "Reminders for chores past their due time."],
  ["choreCompletionEnabled", "Chore updates", "Updates when household chores are completed."],
  ["householdUpdatesEnabled", "Household updates", "Invitations and other household activity."],
  ["funnyNotificationsEnabled", "Funny messages", "Add a lighthearted tone to notifications."],
  [
    "competitiveNotificationsEnabled",
    "Competitive notifications",
    "Allow notifications that compare household activity.",
  ],
]
const notificationStyles: Array<[NotificationStyle, string]> = [
  ["NORMAL", "Normal"],
  ["FUNNY", "Funny"],
  ["MOTIVATIONAL", "Motivational"],
  ["COMPETITIVE", "Competitive"],
  ["MINIMAL", "Minimal"],
]

export function NotificationsScreen({ theme = "light" }: { theme?: Exclude<Theme, "system"> }) {
  const { returnFromNotifications } = useChoreSync()
  const {
    state: pushHealth,
    refresh: refreshPushHealth,
    restore: restorePush,
    repair: repairPush,
    cancelPendingSetup,
    setPushEnabled,
  } = usePushSubscriptionHealth()
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [markAllBusy, setMarkAllBusy] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [savedPreferences, setSavedPreferences] = useState<NotificationPreferences | null>(null)
  const [preferencesError, setPreferencesError] = useState("")
  const [preferencesBusy, setPreferencesBusy] = useState(false)
  const [preferencesSaved, setPreferencesSaved] = useState(false)
  const itemsRef = useRef<Notification[]>([])
  const unreadCountRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const requestSequence = useRef(0)
  const preferencesRequestSequence = useRef(0)
  const preferencesEditSequence = useRef(0)
  const pendingReads = useRef(
    new Map<
      string,
      { previousReadAt: string | null; optimisticReadAt: string; serverConfirmed: boolean }
    >(),
  )
  const pendingReadAll = useRef(
    new Map<string, { previousReadAt: string | null; optimisticReadAt: string }>(),
  )
  const pendingReadAllCount = useRef<number | null>(null)
  const {
    revision: notificationRevision,
    invalidate: invalidateNotifications,
    claim,
    release,
  } = useDataSync(notificationResource)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    const hasLoaded = hasLoadedRef.current
    if (!hasLoaded) setStatus("loading")
    try {
      const [notifications, unread] = await Promise.all([
        notificationApi.list(),
        notificationApi.unreadCount(),
      ])
      if (requestId !== requestSequence.current) return
      const nextItems = notifications.map((notification) => {
        const pending = pendingReads.current.get(notification.id)
        if (pending && notification.readAt) {
          pending.serverConfirmed = true
          return notification
        }
        if (pending) {
          return { ...notification, readAt: pending.optimisticReadAt }
        }
        const pendingAll = pendingReadAll.current.get(notification.id)
        if (pendingAll && !notification.readAt) {
          return { ...notification, readAt: pendingAll.optimisticReadAt }
        }
        return notification
      })
      const pendingUnread = [...pendingReads.current.keys()].filter((id) =>
        notifications.some((notification) => notification.id === id && !notification.readAt),
      ).length
      const nextUnreadCount = pendingReadAll.current.size
        ? 0
        : Math.max(0, unread.count - pendingUnread)
      itemsRef.current = nextItems
      unreadCountRef.current = nextUnreadCount
      setItems(nextItems)
      setUnreadCount(nextUnreadCount)
      setError("")
      hasLoadedRef.current = true
      setStatus("loaded")
    } catch (cause) {
      if (requestId !== requestSequence.current) return
      setError(
        cause instanceof ApiError
          ? cause.message
          : hasLoaded
            ? "Unable to refresh notifications. Please try again."
            : "Unable to load notifications. Please try again.",
      )
      if (!hasLoaded) setStatus("error")
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    const requestId = ++preferencesRequestSequence.current
    const editSequence = preferencesEditSequence.current
    setPreferencesError("")
    try {
      const nextPreferences = await notificationApi.preferences()
      if (
        requestId !== preferencesRequestSequence.current ||
        editSequence !== preferencesEditSequence.current
      ) {
        return
      }
      setPreferences(nextPreferences)
      setSavedPreferences(nextPreferences)
    } catch (cause) {
      if (requestId !== preferencesRequestSequence.current) return
      setPreferencesError(
        cause instanceof ApiError ? cause.message : "Unable to load notification preferences.",
      )
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load, notificationRevision])

  useEffect(() => {
    void loadPreferences()
    return () => {
      preferencesRequestSequence.current += 1
    }
  }, [loadPreferences])

  const markRead = async (notification: Notification) => {
    if (
      notification.readAt ||
      markAllBusy ||
      pendingReadAll.current.size > 0 ||
      pendingReads.current.has(notification.id) ||
      !claim(notification.id)
    ) {
      return
    }
    const current = itemsRef.current.find((item) => item.id === notification.id)
    if (!current || current.readAt) {
      release(notification.id)
      return
    }
    const optimisticReadAt = new Date().toISOString()
    pendingReads.current.set(notification.id, {
      previousReadAt: current.readAt,
      optimisticReadAt,
      serverConfirmed: false,
    })
    requestSequence.current += 1
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === notification.id ? { ...item, readAt: optimisticReadAt } : item,
    )
    unreadCountRef.current = Math.max(0, unreadCountRef.current - 1)
    setItems(itemsRef.current)
    setUnreadCount(unreadCountRef.current)
    setBusyIds((currentIds) => new Set(currentIds).add(notification.id))
    setActionError("")
    try {
      await notificationApi.markRead(notification.id)
      pendingReads.current.delete(notification.id)
      invalidateNotifications()
    } catch (cause) {
      requestSequence.current += 1
      const pending = pendingReads.current.get(notification.id)
      if (pending && !pending.serverConfirmed) {
        itemsRef.current = itemsRef.current.map((item) =>
          item.id === notification.id && item.readAt === pending.optimisticReadAt
            ? { ...item, readAt: pending.previousReadAt }
            : item,
        )
        unreadCountRef.current += 1
        setItems(itemsRef.current)
        setUnreadCount(unreadCountRef.current)
      }
      pendingReads.current.delete(notification.id)
      setActionError(
        cause instanceof ApiError ? cause.message : "Unable to mark this notification as read.",
      )
      invalidateNotifications()
    } finally {
      release(notification.id)
      setBusyIds((currentIds) => {
        const next = new Set(currentIds)
        next.delete(notification.id)
        return next
      })
    }
  }

  const markAllRead = async () => {
    if (
      !unreadCountRef.current ||
      busyIds.size > 0 ||
      pendingReads.current.size > 0 ||
      markAllBusy ||
      !claim("read-all")
    ) {
      return
    }
    const optimisticReadAt = new Date().toISOString()
    pendingReadAllCount.current = unreadCountRef.current
    const unreadItems = itemsRef.current.filter((item) => !item.readAt)
    pendingReadAll.current = new Map(
      unreadItems.map((item) => [item.id, { previousReadAt: item.readAt, optimisticReadAt }]),
    )
    requestSequence.current += 1
    itemsRef.current = itemsRef.current.map((item) =>
      item.readAt ? item : { ...item, readAt: optimisticReadAt },
    )
    unreadCountRef.current = 0
    setItems(itemsRef.current)
    setUnreadCount(0)
    setMarkAllBusy(true)
    setActionError("")
    try {
      await notificationApi.markAllRead()
      pendingReadAll.current.clear()
      pendingReadAllCount.current = null
      invalidateNotifications()
    } catch (cause) {
      requestSequence.current += 1
      itemsRef.current = itemsRef.current.map((item) => {
        const pending = pendingReadAll.current.get(item.id)
        return pending && item.readAt === pending.optimisticReadAt
          ? { ...item, readAt: pending.previousReadAt }
          : item
      })
      unreadCountRef.current =
        pendingReadAllCount.current ?? itemsRef.current.filter((item) => !item.readAt).length
      setItems(itemsRef.current)
      setUnreadCount(unreadCountRef.current)
      pendingReadAll.current.clear()
      pendingReadAllCount.current = null
      setActionError(
        cause instanceof ApiError ? cause.message : "Unable to mark notifications as read.",
      )
      invalidateNotifications()
    } finally {
      release("read-all")
      setMarkAllBusy(false)
    }
  }

  const savePreferences = async () => {
    if (!preferences || preferencesBusy) return
    const previousPushState = savedPreferences?.pushEnabled ?? false
    const editSequence = preferencesEditSequence.current
    preferencesRequestSequence.current += 1
    setPreferencesBusy(true)
    setPreferencesError("")
    setPreferencesSaved(false)
    try {
      if (preferences.pushEnabled !== previousPushState) {
        if (preferences.pushEnabled) {
          const restored = await restorePush()
          if (!restored) {
            throw new Error("Push notifications could not be enabled. Please try again.")
          }
        } else {
          const endpoint = await removeBrowserPushSubscription()
          if (endpoint) {
            try {
              await notificationApi.unsubscribePush(endpoint)
            } catch (cause) {
              throw new Error(
                cause instanceof ApiError
                  ? cause.message
                  : "Push notifications could not be disabled. Please try again.",
              )
            }
          }
        }
      }

      const updated = await notificationApi.updatePreferences(preferences)
      setSavedPreferences(updated)
      if (editSequence === preferencesEditSequence.current) {
        setPreferences(updated)
        setPreferencesSaved(true)
      }
      setPushEnabled(updated.pushEnabled)
    } catch (cause) {
      setPreferencesError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Unable to save notification preferences.",
      )
    } finally {
      setPreferencesBusy(false)
    }
  }

  const recoverPush = async () => {
    if (pushHealth.status !== "attention") return
    if (pushHealth.reason === "check-failed" || pushHealth.reason === "permission-denied") {
      await refreshPushHealth(true)
    } else if (pushHealth.reason === "vapid-key-mismatch") {
      if (await repairPush()) await loadPreferences()
    } else {
      await restorePush()
    }
  }

  const updatePreference = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => {
    if (key === "pushEnabled" && value === false) cancelPendingSetup()
    preferencesEditSequence.current += 1
    setPreferences((current) => (current ? { ...current, [key]: value } : current))
    setPreferencesSaved(false)
  }

  const hasPreferencesChanges = useMemo(() => {
    if (!preferences || !savedPreferences) return false
    return JSON.stringify(preferences) !== JSON.stringify(savedPreferences)
  }, [preferences, savedPreferences])

  return (
    <ProfileDestinationView destination="notifications" theme={theme}>
      {
        <ProfileDestinationHeader
          eyebrow="STAY IN THE LOOP"
          title="Notifications"
          subtitle={unreadCount ? `${unreadCount} unread` : "You're all caught up"}
          back={returnFromNotifications}
          theme={theme}
          action={
            unreadCount > 0 ? (
              <button
                className={profileStyles.notificationsReadAll}
                disabled={markAllBusy || busyIds.size > 0}
                onClick={() => void markAllRead()}
                type="button"
              >
                Read all
              </button>
            ) : undefined
          }
        />
      }
      <main className={profileStyles.notificationsMain}>
        {
          <div className={profileStyles.notificationsIntro}>
            <p>HOUSEHOLD UPDATES</p>
            <h2>Your activity</h2>
          </div>
        }
        {(actionError || (status === "loaded" && error)) && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <p className="flex-1" role="alert">
              {actionError || error}
            </p>
            {status === "loaded" && error && (
              <button
                className="shrink-0 font-bold underline"
                onClick={() => void load()}
                type="button"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {status === "loading" && (
          <div
            aria-label="Loading notifications"
            className="h-44 animate-pulse rounded-2xl bg-white"
          />
        )}
        {status === "error" && (
          <div className="rounded-2xl bg-white p-5 text-center">
            <p role="alert" className="text-sm text-slate-600">
              {error}
            </p>
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold"
              onClick={() => void load()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {status === "loaded" && items.length === 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white px-5 py-9 text-center shadow-sm">
            <div className="mb-2 text-3xl" aria-hidden="true">
              🔔
            </div>
            <h2 className="font-bold text-slate-900">No notifications yet</h2>
            <p className="mt-1 text-sm text-slate-400">Household updates will show up here.</p>
          </div>
        )}
        {status === "loaded" && items.length > 0 && (
          <section aria-label="Your notifications" className="flex flex-col gap-2">
            {items.map((item) => {
              const read = Boolean(item.readAt)
              return (
                <article
                  key={item.id}
                  className={profileStyles.notificationCard}
                  data-read={read ? "true" : "false"}
                >
                  <div className={profileStyles.notificationCardContent}>
                    <span
                      aria-hidden="true"
                      className={profileStyles.notificationStatus}
                      data-read={read ? "true" : "false"}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className={profileStyles.notificationTitle}>{item.title}</h2>
                        {!read && <span className={"sr-only"}>Unread</span>}
                      </div>
                      <p className={profileStyles.notificationMessage}>{item.message}</p>
                      <p className={profileStyles.notificationTimestamp}>
                        {dateLabel(item.deliveredAt ?? item.sentAt ?? item.createdAt)}
                      </p>
                      {!read && (
                        <button
                          aria-label={`Mark ${item.title} as read`}
                          className={profileStyles.notificationMarkRead}
                          disabled={busyIds.has(item.id) || markAllBusy}
                          onClick={() => void markRead(item)}
                          type="button"
                        >
                          {busyIds.has(item.id) ? "Marking read…" : "Mark as read"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </section>
        )}

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-display text-base font-extrabold text-slate-900">
            Notification preferences
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Choose which household notifications you receive.
          </p>
          {!preferences && (
            <div className="mt-3">
              {preferencesError ? (
                <>
                  <p role="alert" className="text-xs text-rose-600">
                    {preferencesError}
                  </p>
                  <button
                    className="mt-2 text-xs font-bold text-teal-700"
                    onClick={() => void loadPreferences()}
                    type="button"
                  >
                    Try again
                  </button>
                </>
              ) : (
                <p className="mt-3 text-xs text-slate-400">Loading preferences…</p>
              )}
            </div>
          )}
          {preferences && (
            <div className="mt-4">
              <label className="flex flex-col gap-2 border-b border-slate-100 pb-4 text-sm font-semibold text-slate-800">
                <span>Notification style</span>
                <select
                  aria-label="Notification style"
                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) =>
                    updatePreference(
                      "notificationStyleOverride",
                      notificationStyles.find(([style]) => style === event.target.value)?.[0] ??
                        null,
                    )
                  }
                  value={preferences.notificationStyleOverride ?? ""}
                >
                  <option value="">
                    Use household default ({preferences.householdNotificationStyle.toLowerCase()})
                  </option>
                  {notificationStyles.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Household activity
              </p>
              {preferenceLabels.slice(0, 5).map(([key, label, detail]) => (
                <SettingsRow description={detail} key={key} label={label}>
                  <input
                    aria-label={label}
                    checked={preferences[key]}
                    className="h-5 w-5 shrink-0 accent-teal-600"
                    onChange={(event) => updatePreference(key, event.target.checked)}
                    type="checkbox"
                  />
                </SettingsRow>
              ))}
              <p className="pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Message preferences
              </p>
              {preferenceLabels.slice(5).map(([key, label, detail]) => (
                <SettingsRow description={detail} key={key} label={label}>
                  <input
                    aria-label={label}
                    checked={preferences[key]}
                    className="h-5 w-5 shrink-0 accent-teal-600"
                    onChange={(event) => updatePreference(key, event.target.checked)}
                    type="checkbox"
                  />
                </SettingsRow>
              ))}
              <SettingsRow
                description="Enable push notifications for this browser."
                label="Push notifications"
              >
                <input
                  aria-label="Push notifications"
                  checked={preferences.pushEnabled}
                  className="h-5 w-5 shrink-0 accent-teal-600"
                  onChange={(event) => updatePreference("pushEnabled", event.target.checked)}
                  type="checkbox"
                />
              </SettingsRow>
              {preferences.pushEnabled &&
                savedPreferences?.pushEnabled &&
                pushHealth.status !== "disabled" && (
                  <div className="border-b border-slate-100 px-1 py-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    {(pushHealth.status === "loading" || pushHealth.status === "checking") && (
                      <p>Checking this browser’s push setup…</p>
                    )}
                    {pushHealth.status === "healthy" && (
                      <p role="status" className="text-teal-700 dark:text-teal-300">
                        This browser’s push subscription is synchronized.
                      </p>
                    )}
                    {pushHealth.status === "attention" && (
                      <>
                        <p role={pushHealth.reason === "check-failed" ? "alert" : undefined}>
                          {pushHealth.message}
                        </p>
                        {pushHealth.reason !== "unsupported" && (
                          <button
                            className="mt-2 font-bold text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                            onClick={() => void recoverPush()}
                            type="button"
                          >
                            {pushHealth.reason === "sync-required"
                              ? "Sync this browser"
                              : pushHealth.reason === "check-failed"
                                ? "Retry push check"
                                : pushHealth.reason === "permission-denied"
                                  ? "Check permission again"
                                  : pushHealth.reason === "vapid-key-mismatch"
                                    ? "Repair push notifications"
                                    : "Restore push notifications"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              <div className="grid grid-cols-1 gap-3 py-4 min-[390px]:grid-cols-2">
                <label className="text-xs font-semibold text-slate-500">
                  Quiet hours start
                  <input
                    aria-label="Quiet hours start"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) =>
                      updatePreference("quietHoursStart", event.target.value || null)
                    }
                    type="time"
                    value={preferences.quietHoursStart ?? ""}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500">
                  Quiet hours end
                  <input
                    aria-label="Quiet hours end"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) =>
                      updatePreference("quietHoursEnd", event.target.value || null)
                    }
                    type="time"
                    value={preferences.quietHoursEnd ?? ""}
                  />
                </label>
              </div>
              <button
                className="mt-3 w-full rounded-xl bg-teal-600 py-3 text-sm font-bold text-white disabled:opacity-50"
                disabled={preferencesBusy || !hasPreferencesChanges}
                onClick={() => void savePreferences()}
                type="button"
              >
                {preferencesBusy ? "Saving…" : "Save preferences"}
              </button>
              {preferencesSaved && (
                <p role="status" className="mt-2 text-center text-xs font-medium text-teal-700">
                  Preferences saved.
                </p>
              )}
              {preferencesError && (
                <p role="alert" className="mt-2 text-xs text-rose-600">
                  {preferencesError}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </ProfileDestinationView>
  )
}
