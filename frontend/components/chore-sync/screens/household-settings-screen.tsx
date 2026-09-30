"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdApi, type HouseholdSettings } from "@/lib/household/api"
import { useHouseholds } from "@/lib/household/household-context"
import { notificationApi, type NotificationStyle } from "@/lib/notifications/api"
import { SubpageHeader } from "./subpage-header"

const notificationStyles: Array<[NotificationStyle, string]> = [
  ["NORMAL", "Normal"],
  ["FUNNY", "Funny"],
  ["MOTIVATIONAL", "Motivational"],
  ["COMPETITIVE", "Competitive"],
  ["MINIMAL", "Minimal"],
]

function isNotificationStyle(value: string): value is NotificationStyle {
  return notificationStyles.some(([style]) => style === value)
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)
}

export function HouseholdSettingsScreen() {
  const { navigate } = useChoreSync()
  const { households, refresh } = useHouseholds()
  const household = households[0]
  const [settings, setSettings] = useState<HouseholdSettings | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [notificationStyle, setNotificationStyle] = useState<NotificationStyle>("NORMAL")
  const [styleSaved, setStyleSaved] = useState(false)
  const [styleError, setStyleError] = useState("")

  const loadSettings = useCallback(async () => {
    if (!household) {
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    setStatus("loading")
    setError("")
    try {
      const result = await householdApi.settings(household.id)
      setSettings(result)
      setName(result.name)
      setDescription(result.description ?? "")
      setNotificationStyle(result.notificationStyle ?? "NORMAL")
      setStatus("loaded")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load household settings. Please try again.")
      setStatus("error")
    }
  }, [household])

  useEffect(() => { void loadSettings() }, [loadSettings])
  const canEdit = settings?.currentUserRole === "OWNER"
  const canEditNotificationStyle = settings?.currentUserRole === "OWNER" || settings?.currentUserRole === "ADMIN"
  const canLeave = settings?.currentUserRole !== "OWNER"

  const save = async () => {
    if (!household || busy) return
    setBusy(true)
    setSaved(false)
    setError("")
    let didSave = false
    try {
      const updated = await householdApi.updateSettings(household.id, {
        name: name.trim(),
        description: description.trim() || null,
        timezone: settings?.timezone ?? "",
      })
      setSettings(updated)
      setName(updated.name)
      setDescription(updated.description ?? "")
      setSaved(true)
      didSave = true
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to save household settings. Please try again.")
    } finally {
      setBusy(false)
    }
    if (didSave) await refresh().catch(() => undefined)
  }

  const saveNotificationStyle = async () => {
    if (!household || busy) return
    setBusy(true)
    setStyleError("")
    setStyleSaved(false)
    try {
      await notificationApi.setHouseholdStyle(household.id, notificationStyle)
      setStyleSaved(true)
    } catch (cause) {
      setStyleError(cause instanceof ApiError ? cause.message : "Unable to save the household notification style.")
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    if (!household || busy) return
    setBusy(true)
    setError("")
    try {
      await householdApi.leave(household.id)
      const remaining = await refresh()
      navigate(remaining.length ? "dashboard" : "welcome")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to leave this household. Please try again.")
      setConfirmLeave(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader title="Household Settings" subtitle={settings?.name ?? household?.name} back={() => navigate("household")} />
      <main className="flex flex-col gap-4 px-4 pt-4">
        {status === "loading" && <div aria-label="Loading household settings" className="h-48 animate-pulse rounded-2xl bg-white" />}
        {status === "error" && (
          <div className="rounded-2xl bg-white p-5 text-center">
            <p role="alert" className="text-sm text-slate-600">{error}</p>
            <button className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold" onClick={() => void loadSettings()} type="button">Try again</button>
          </div>
        )}
        {status === "loaded" && settings && (
          <>
            <section className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
                <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
                  Default notification style
                  <select
                    aria-label="Default notification style"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-900 disabled:bg-slate-50"
                    disabled={!canEditNotificationStyle || busy}
                    onChange={(event) => {
                      if (isNotificationStyle(event.target.value)) {
                        setNotificationStyle(event.target.value)
                        setStyleSaved(false)
                      }
                    }}
                    value={notificationStyle}
                  >
                    {notificationStyles.map(([style, label]) => <option key={style} value={style}>{label}</option>)}
                  </select>
                </label>
                <p className="text-xs text-slate-400">Members can choose their own style in notification settings.</p>
                {canEditNotificationStyle && (
                  <button className="w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={busy} onClick={() => void saveNotificationStyle()} type="button">
                    Save default style
                  </button>
                )}
                {styleSaved && <p role="status" className="text-center text-xs font-medium text-teal-700">Default style saved.</p>}
                {styleError && <p role="alert" className="text-xs text-rose-600">{styleError}</p>}
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
                Household name
                <input aria-label="Household name" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500" disabled={!canEdit} maxLength={120} onChange={(event) => { setName(event.target.value); setSaved(false) }} value={name} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
                Description <span className="font-normal">(optional)</span>
                <textarea aria-label="Household description" className="min-h-24 resize-y rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500" disabled={!canEdit} maxLength={2000} onChange={(event) => { setDescription(event.target.value); setSaved(false) }} value={description} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Timezone</p>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-700">{settings.timezone}</p>
                  <p className="mt-1 text-[10px] text-slate-400">Read only</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Created</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">{dateLabel(settings.createdAt)}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">Your role: {settings.currentUserRole}</p>
              {canEdit ? (
                <button className="w-full rounded-xl bg-teal-600 py-3.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50" disabled={busy || name.trim().length < 2} onClick={() => void save()} type="button">
                  {busy ? "Saving…" : "Save changes"}
                </button>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">Only the household owner can edit these details.</p>
              )}
              {saved && <p role="status" className="text-center text-xs font-medium text-teal-700">Household settings saved.</p>}
              {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <h2 className="font-bold text-slate-900">Leave household</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">You will lose access to this household. Your existing chore history may remain visible to its members.</p>
              {canLeave && !confirmLeave ? (
                <button className="mt-3 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50" onClick={() => setConfirmLeave(true)} type="button">Leave household</button>
              ) : canLeave ? (
                <div className="mt-3 rounded-xl bg-rose-50 p-3">
                  <p className="text-sm font-semibold text-rose-800">Are you sure you want to leave?</p>
                  <div className="mt-3 flex gap-2">
                    <button className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void leave()} type="button">{busy ? "Leaving…" : "Yes, leave"}</button>
                    <button className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" onClick={() => setConfirmLeave(false)} type="button">Cancel</button>
                  </div>
                </div>
              ) : <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">The household owner cannot leave until ownership transfer is supported. No request has been sent.</p>}
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <h2 className="font-bold text-slate-900">Delete household</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Household deletion is not available yet. No data will be changed.</p>
              <button aria-describedby="delete-household-note" className="mt-3 cursor-not-allowed rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-400" disabled type="button">Delete household</button>
              <span className="sr-only" id="delete-household-note">Coming soon; deletion is disabled.</span>
            </section>
          </>
        )}
        {error && status === "loaded" && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </main>
    </div>
  )
}
