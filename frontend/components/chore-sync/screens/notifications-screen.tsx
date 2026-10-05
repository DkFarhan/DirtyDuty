"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { notificationApi, type Notification, type NotificationPreferences, type NotificationStyle } from "@/lib/notifications/api"
import { createBrowserPushSubscription, removeBrowserPushSubscription } from "@/lib/notifications/push"
import { useChoreSync } from "@/lib/chore-sync/store"
import { SubpageHeader } from "./subpage-header"

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

const preferenceLabels: Array<[keyof Pick<NotificationPreferences, "choreAssignedEnabled" | "choreRemindersEnabled" | "overdueEnabled" | "choreCompletionEnabled" | "householdUpdatesEnabled" | "funnyNotificationsEnabled" | "competitiveNotificationsEnabled">, string, string]> = [
  ["choreAssignedEnabled", "Chore assignments", "When a chore is assigned to you."],
  ["choreRemindersEnabled", "Chore reminders", "Get a reminder when chores are due."],
  ["overdueEnabled", "Overdue reminders", "Reminders for chores past their due time."],
  ["choreCompletionEnabled", "Chore updates", "Updates when household chores are completed."],
  ["householdUpdatesEnabled", "Household updates", "Invitations and other household activity."],
  ["funnyNotificationsEnabled", "Funny messages", "Add a lighthearted tone to notifications."],
  ["competitiveNotificationsEnabled", "Competitive notifications", "Allow notifications that compare household activity."],
]
const notificationStyles: Array<[NotificationStyle, string]> = [
  ["NORMAL", "Normal"],
  ["FUNNY", "Funny"],
  ["MOTIVATIONAL", "Motivational"],
  ["COMPETITIVE", "Competitive"],
  ["MINIMAL", "Minimal"],
]

export function NotificationsScreen() {
  const { returnFromNotifications } = useChoreSync()
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [savedPreferences, setSavedPreferences] = useState<NotificationPreferences | null>(null)
  const [preferencesError, setPreferencesError] = useState("")
  const [preferencesBusy, setPreferencesBusy] = useState(false)
  const [preferencesSaved, setPreferencesSaved] = useState(false)

  const load = useCallback(async () => {
    setStatus("loading")
    setError("")
    try {
      const [notifications, unread] = await Promise.all([notificationApi.list(), notificationApi.unreadCount()])
      setItems(notifications)
      setUnreadCount(unread.count)
      setStatus("loaded")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load notifications. Please try again.")
      setStatus("error")
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    setPreferencesError("")
    try {
      const nextPreferences = await notificationApi.preferences()
      setPreferences(nextPreferences)
      setSavedPreferences(nextPreferences)
    } catch (cause) {
      setPreferencesError(cause instanceof ApiError ? cause.message : "Unable to load notification preferences.")
    }
  }, [])

  useEffect(() => { void load(); void loadPreferences() }, [load, loadPreferences])

  const markRead = async (notification: Notification) => {
    if (notification.readAt || busyId) return
    setBusyId(notification.id)
    setError("")
    try {
      await notificationApi.markRead(notification.id)
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item))
      setUnreadCount((count) => Math.max(0, count - 1))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to mark this notification as read.")
    } finally {
      setBusyId(null)
    }
  }

  const markAllRead = async () => {
    if (!unreadCount || busyId) return
    setBusyId("all")
    setError("")
    try {
      await notificationApi.markAllRead()
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt }))
      setUnreadCount(0)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to mark notifications as read.")
    } finally {
      setBusyId(null)
    }
  }

  const savePreferences = async () => {
    if (!preferences || preferencesBusy) return
    const previousPushState = savedPreferences?.pushEnabled ?? false
    setPreferencesBusy(true)
    setPreferencesError("")
    setPreferencesSaved(false)
    try {
      if (preferences.pushEnabled !== previousPushState) {
        if (preferences.pushEnabled) {
          const configuration = await notificationApi.pushPublicKey()
          if (!configuration.available || !configuration.publicKey) {
            throw new Error("Push notifications are currently unavailable.")
          }
          const subscription = await createBrowserPushSubscription(configuration.publicKey)
          const keys = subscription.toJSON().keys
          if (!keys?.p256dh || !keys.auth) {
            throw new Error("Push notifications could not be enabled. Please try again.")
          }
          await notificationApi.subscribePush({
            endpoint: subscription.endpoint,
            publicKey: keys.p256dh,
            authSecret: keys.auth,
          })
        } else {
          const endpoint = await removeBrowserPushSubscription()
          if (endpoint) {
            try {
              await notificationApi.unsubscribePush(endpoint)
            } catch (cause) {
              throw new Error(cause instanceof ApiError ? cause.message : "Push notifications could not be disabled. Please try again.")
            }
          }
        }
      }

      const updated = await notificationApi.updatePreferences(preferences)
      setPreferences(updated)
      setSavedPreferences(updated)
      setPreferencesSaved(true)
    } catch (cause) {
      setPreferences((current) => current ? { ...current, pushEnabled: previousPushState } : current)
      setPreferencesError(cause instanceof ApiError
        ? cause.message
        : cause instanceof Error ? cause.message : "Unable to save notification preferences.")
    } finally {
      setPreferencesBusy(false)
    }
  }

  const updatePreference = <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
    setPreferences((current) => current ? { ...current, [key]: value } : current)
    setPreferencesSaved(false)
  }

  const hasPreferencesChanges = useMemo(() => {
    if (!preferences || !savedPreferences) return false
    return JSON.stringify(preferences) !== JSON.stringify(savedPreferences)
  }, [preferences, savedPreferences])

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader
        title="Notifications"
        subtitle={unreadCount ? `${unreadCount} unread` : "You're all caught up"}
        back={returnFromNotifications}
        action={unreadCount > 0 ? (
          <button className="text-xs font-bold text-teal-700 disabled:opacity-50" disabled={busyId !== null} onClick={() => void markAllRead()} type="button">Read all</button>
        ) : undefined}
      />
      <main className="flex flex-col gap-4 px-4 pt-4">
        {error && <p className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
        {status === "loading" && <div aria-label="Loading notifications" className="h-44 animate-pulse rounded-2xl bg-white" />}
        {status === "error" && (
          <div className="rounded-2xl bg-white p-5 text-center">
            <p role="alert" className="text-sm text-slate-600">{error}</p>
            <button className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold" onClick={() => void load()} type="button">Try again</button>
          </div>
        )}
        {status === "loaded" && items.length === 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white px-5 py-9 text-center shadow-sm">
            <div className="mb-2 text-3xl" aria-hidden="true">🔔</div>
            <h2 className="font-bold text-slate-900">No notifications yet</h2>
            <p className="mt-1 text-sm text-slate-400">Household updates will show up here.</p>
          </div>
        )}
        {status === "loaded" && items.length > 0 && (
          <section aria-label="Your notifications" className="flex flex-col gap-2">
            {items.map((item) => {
              const read = Boolean(item.readAt)
              return (
                <article key={item.id} className={`rounded-2xl border p-4 shadow-sm ${read ? "border-slate-100 bg-white" : "border-teal-100 bg-teal-50"}`} data-read={read ? "true" : "false"}>
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${read ? "bg-slate-200" : "bg-teal-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className={`text-sm ${read ? "font-semibold text-slate-700" : "font-bold text-slate-900"}`}>{item.title}</h2>
                        {!read && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700">Unread</span>}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.message}</p>
                      <p className="mt-2 text-[10px] text-slate-400">{dateLabel(item.deliveredAt ?? item.sentAt ?? item.createdAt)} · {item.category.toLowerCase()}</p>
                      {!read && (
                        <button className="mt-2 text-xs font-bold text-teal-700 underline-offset-2 hover:underline disabled:opacity-50" disabled={busyId !== null} onClick={() => void markRead(item)} type="button">
                          {busyId === item.id ? "Marking read…" : "Mark as read"}
                        </button>
                      )}
                    </div>
                    <span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-bold uppercase text-slate-500">{item.priority.toLowerCase()}</span>
                  </div>
                </article>
              )
            })}
          </section>
        )}

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Notification preferences</h2>
          <p className="mt-1 text-xs text-slate-500">Choose which household notifications you receive.</p>
          {!preferences && (
            <div className="mt-3">
              {preferencesError ? (
                <>
                  <p role="alert" className="text-xs text-rose-600">{preferencesError}</p>
                  <button className="mt-2 text-xs font-bold text-teal-700" onClick={() => void loadPreferences()} type="button">Try again</button>
                </>
              ) : <p className="mt-3 text-xs text-slate-400">Loading preferences…</p>}
            </div>
          )}
          {preferences && (
            <div className="mt-3 flex flex-col divide-y divide-slate-100">
              <label className="flex flex-col gap-2 py-3 text-sm font-semibold text-slate-800">
                Notification style
                <select
                  aria-label="Notification style"
                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm"
                  onChange={(event) => updatePreference(
                    "notificationStyleOverride",
                    notificationStyles.find(([style]) => style === event.target.value)?.[0] ?? null,
                  )}
                  value={preferences.notificationStyleOverride ?? ""}
                >
                  <option value="">Use household default ({preferences.householdNotificationStyle.toLowerCase()})</option>
                  {notificationStyles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {preferenceLabels.map(([key, label, detail]) => (
                <label className="flex items-center justify-between gap-3 py-3" key={key}>
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{label}</span>
                    <span className="block text-xs text-slate-400">{detail}</span>
                  </span>
                  <input aria-label={label} checked={preferences[key]} className="h-4 w-4 accent-teal-600" onChange={(event) => updatePreference(key, event.target.checked)} type="checkbox" />
                </label>
              ))}
              <label className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Push notifications</span>
                  <span className="block text-xs text-slate-400">Enable push notifications for this browser.</span>
                </span>
                <input aria-label="Push notifications" checked={preferences.pushEnabled} className="h-4 w-4 accent-teal-600" onChange={(event) => updatePreference("pushEnabled", event.target.checked)} type="checkbox" />
              </label>
              <div className="grid grid-cols-1 gap-3 py-3 min-[390px]:grid-cols-2">
                <label className="text-xs font-semibold text-slate-500">Quiet hours start
                  <input aria-label="Quiet hours start" className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800" onChange={(event) => updatePreference("quietHoursStart", event.target.value || null)} type="time" value={preferences.quietHoursStart ?? ""} />
                </label>
                <label className="text-xs font-semibold text-slate-500">Quiet hours end
                  <input aria-label="Quiet hours end" className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800" onChange={(event) => updatePreference("quietHoursEnd", event.target.value || null)} type="time" value={preferences.quietHoursEnd ?? ""} />
                </label>
              </div>
              <button className="mt-3 w-full rounded-xl bg-teal-600 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={preferencesBusy || !hasPreferencesChanges} onClick={() => void savePreferences()} type="button">{preferencesBusy ? "Saving…" : "Save preferences"}</button>
              {preferencesSaved && <p role="status" className="mt-2 text-center text-xs font-medium text-teal-700">Preferences saved.</p>}
              {preferencesError && <p role="alert" className="mt-2 text-xs text-rose-600">{preferencesError}</p>}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
