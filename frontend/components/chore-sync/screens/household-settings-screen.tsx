"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdApi, type HouseholdInvitationSummary, type HouseholdSettings } from "@/lib/household/api"
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
  const { households, activeHousehold, refresh } = useHouseholds()
  const household = activeHousehold ?? households[0]
  const [settings, setSettings] = useState<HouseholdSettings | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notificationStyle, setNotificationStyle] = useState<NotificationStyle>("NORMAL")
  const [styleSaved, setStyleSaved] = useState(false)
  const [styleError, setStyleError] = useState("")
  const [invitations, setInvitations] = useState<HouseholdInvitationSummary[]>([])
  const [invitationStatus, setInvitationStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [invitationError, setInvitationError] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteStage, setDeleteStage] = useState<1 | 2 | 3>(1)
  const [deleteConsent, setDeleteConsent] = useState({ one: false, two: false, three: false })
  const [deleteName, setDeleteName] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null)

  const canEdit = settings?.currentUserRole === "OWNER"
  const canEditNotificationStyle = settings?.currentUserRole === "OWNER" || settings?.currentUserRole === "ADMIN"
  const canManageInvitations = settings?.currentUserRole === "OWNER" || settings?.currentUserRole === "ADMIN"

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

  const loadInvitations = useCallback(async () => {
    if (!household) return
    setInvitationStatus("loading")
    setInvitationError("")
    try {
      const result = await householdApi.listInvitations(household.id)
      setInvitations(result.filter((invitation) => invitation.status === "ACTIVE"))
      setInvitationStatus("loaded")
    } catch (cause) {
      setInvitationError(cause instanceof ApiError ? cause.message : "Unable to load active invitations.")
      setInvitationStatus("error")
    }
  }, [household])

  useEffect(() => { void loadSettings() }, [loadSettings])
  useEffect(() => { void loadInvitations() }, [loadInvitations])

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

  const revokeInvitation = async (invitationId: string) => {
    if (!household) return
    setInvitationError("")
    setRevokeTargetId(null)
    try {
      await householdApi.revokeInvitation(household.id, invitationId)
      await loadInvitations()
    } catch (cause) {
      setInvitationError(cause instanceof ApiError ? cause.message : "Unable to revoke this invitation.")
    }
  }

  const resetDeleteFlow = () => {
    setDeleteOpen(false)
    setDeleteStage(1)
    setDeleteConsent({ one: false, two: false, three: false })
    setDeleteName("")
    setDeletePassword("")
    setDeleteError("")
    setDeleteBusy(false)
  }

  const submitDeleteHousehold = async () => {
    if (!household || !settings) return
    if (deleteName.trim() !== household.name || deletePassword.trim().length === 0) {
      setDeleteError("Use the exact household name and your current password to continue.")
      return
    }
    setDeleteBusy(true)
    setDeleteError("")
    try {
      await householdApi.deleteHousehold(household.id, { householdName: household.name, password: deletePassword })
      const remaining = await refresh()
      resetDeleteFlow()
      navigate(remaining.length ? "dashboard" : "welcome")
    } catch (cause) {
      setDeleteError(cause instanceof ApiError ? cause.message : "Unable to delete this household.")
    } finally {
      setDeleteBusy(false)
    }
  }

  const canContinueDelete = deleteConsent.one && deleteConsent.two && deleteConsent.three && deleteName.trim() === (household?.name ?? "") && deletePassword.trim().length > 0
  const revokeTarget = invitations.find((invitation) => invitation.id === revokeTargetId) ?? null

  return (
    <div className="min-h-screen bg-stone-100 pb-8 text-slate-800">
      <SubpageHeader title="Household Settings" subtitle={settings?.name ?? household?.name} back={() => navigate("household")} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-4">
        {status === "loading" && <div aria-label="Loading household settings" className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />}
        {status === "error" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p role="alert" className="text-sm text-slate-600">{error}</p>
            <button className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => void loadSettings()} type="button">Try again</button>
          </div>
        )}
        {status === "loaded" && settings && (
          <>
            <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Household details</p>
                  <h2 className="mt-1 text-xl font-black text-slate-900">{settings.name}</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{settings.currentUserRole}</span>
              </div>

              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
                Household name
                <input aria-label="Household name" className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500" disabled={!canEdit} maxLength={120} onChange={(event) => { setName(event.target.value); setSaved(false) }} value={name} />
              </label>

              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
                Description <span className="font-normal text-slate-400">(optional)</span>
                <textarea aria-label="Household description" className="min-h-[96px] resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500" disabled={!canEdit} maxLength={2000} onChange={(event) => { setDescription(event.target.value); setSaved(false) }} value={description} />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Timezone</p>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-700">{settings.timezone}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Created</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">{dateLabel(settings.createdAt)}</p>
                </div>
              </div>

              {canEdit ? (
                <button className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || name.trim().length < 2} onClick={() => void save()} type="button">
                  {busy ? "Saving…" : "Save changes"}
                </button>
              ) : (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">Only the household owner can edit these details.</p>
              )}
              {saved && <p role="status" className="text-center text-xs font-medium text-teal-700">Household settings saved.</p>}
              {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            </section>

            <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Notifications</p>
                  <h2 className="mt-1 text-lg font-black text-slate-900">Default notification style</h2>
                </div>
              </div>

              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
                Default style
                <select
                  aria-label="Default notification style"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
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
              <p className="text-xs text-slate-500">Members can choose their own style in notification settings.</p>
              {canEditNotificationStyle && (
                <button className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void saveNotificationStyle()} type="button">
                  Save default notification style
                </button>
              )}
              {styleSaved && <p role="status" className="text-center text-xs font-medium text-teal-700">Default style saved.</p>}
              {styleError && <p role="alert" className="text-xs text-rose-600">{styleError}</p>}
            </section>

            {canManageInvitations && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Active invitations</p>
                    <h2 className="mt-1 text-lg font-black text-slate-900">Manage access</h2>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {invitationStatus === "loading" && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">Loading invitations…</p>}
                  {invitationStatus === "error" && (
                    <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                      <p role="alert">{invitationError}</p>
                      <button className="mt-2 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700" onClick={() => void loadInvitations()} type="button">Retry</button>
                    </div>
                  )}
                  {invitationStatus === "loaded" && invitations.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No active invitations.</p>}
                  {invitationStatus === "loaded" && invitations.map((invitation) => (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5" key={invitation.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 text-sm text-slate-600">
                          <p className="font-semibold text-slate-800">Created {dateLabel(invitation.createdAt)}</p>
                          <p>Expires {invitation.expiresAt ? dateLabel(invitation.expiresAt) : "—"}</p>
                          <p>Status: <span className="font-medium text-slate-700">{invitation.status}</span></p>
                          {invitation.createdByDisplayName && <p>Created by {invitation.createdByDisplayName}</p>}
                          {invitation.roleToAssign && <p>Granted role: {invitation.roleToAssign}</p>}
                        </div>
                        <button className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50" onClick={() => setRevokeTargetId(invitation.id)} type="button">Revoke</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {canEdit && (
              <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-500">Danger zone</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">Delete household</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">Permanently remove this household and its data.</p>
                <button className="mt-4 w-full rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-sm font-bold text-rose-700 transition hover:bg-rose-50" onClick={() => setDeleteOpen(true)} type="button">Delete household</button>
              </section>
            )}
          </>
        )}
        {error && status === "loaded" && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </main>

      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" role="dialog">
            <h2 className="font-display text-lg font-black text-slate-900">Revoke invitation?</h2>
            <p className="mt-2 text-sm text-slate-500">This will immediately disable this invitation and no one will be able to use it again.</p>
            <div className="mt-5 flex gap-2">
              <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => setRevokeTargetId(null)} type="button">Cancel</button>
              <button className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white" onClick={() => { void revokeInvitation(revokeTarget.id); setRevokeTargetId(null) }} type="button">Confirm revoke</button>
            </div>
          </section>
        </div>
      )}

      {deleteOpen && household && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" role="dialog">
            {deleteStage === 1 && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900">Delete {household.name}?</h2>
                <p className="mt-2 text-sm text-slate-500">If you only want to stop managing this household, you can transfer ownership instead.</p>
                <div className="mt-5 flex flex-col gap-2">
                  <button className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => navigate("household")} type="button">Transfer ownership</button>
                  <button className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-bold text-rose-700" onClick={() => setDeleteStage(2)} type="button">Continue to deletion</button>
                  <button className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={resetDeleteFlow} type="button">Cancel</button>
                </div>
              </>
            )}
            {deleteStage === 2 && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900">Delete {household.name}?</h2>
                <p className="mt-2 text-sm text-slate-500">This action permanently removes the household and its scoped data.</p>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <label className="flex items-start gap-2"><input checked={deleteConsent.one} className="mt-1" onChange={(event) => setDeleteConsent((state) => ({ ...state, one: event.target.checked }))} type="checkbox" /> <span>All members will lose access.</span></label>
                  <label className="flex items-start gap-2"><input checked={deleteConsent.two} className="mt-1" onChange={(event) => setDeleteConsent((state) => ({ ...state, two: event.target.checked }))} type="checkbox" /> <span>Household data and history will be permanently deleted.</span></label>
                  <label className="flex items-start gap-2"><input checked={deleteConsent.three} className="mt-1" onChange={(event) => setDeleteConsent((state) => ({ ...state, three: event.target.checked }))} type="checkbox" /> <span>I understand this cannot be undone.</span></label>
                </div>
                <div className="mt-5 flex gap-2">
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => setDeleteStage(1)} type="button">Back</button>
                  <button className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60" disabled={!deleteConsent.one || !deleteConsent.two || !deleteConsent.three} onClick={() => setDeleteStage(3)} type="button">Continue</button>
                </div>
              </>
            )}
            {deleteStage === 3 && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900">Permanently delete {household.name}</h2>
                <div className="mt-4 space-y-3">
                  <label className="block text-sm font-medium text-slate-700">
                    Type “{household.name}” to confirm
                    <input autoFocus className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 focus:bg-white" onChange={(event) => setDeleteName(event.target.value)} placeholder={household.name} type="text" value={deleteName} />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Password
                    <input className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 focus:bg-white" onChange={(event) => setDeletePassword(event.target.value)} placeholder="Current password" type="password" value={deletePassword} />
                  </label>
                </div>
                {deleteError && <p role="alert" className="mt-3 text-sm text-rose-600">{deleteError}</p>}
                <div className="mt-5 flex gap-2">
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => setDeleteStage(2)} type="button">Back</button>
                  <button className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60" disabled={deleteBusy || !canContinueDelete} onClick={() => void submitDeleteHousehold()} type="button">{deleteBusy ? "Deleting…" : `Permanently delete ${household.name}`}</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
