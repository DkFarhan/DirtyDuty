"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, LockKeyhole, UsersRound } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { apiUrl } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import {
  householdApi,
  type HouseholdInvitationSummary,
  type HouseholdSettings,
} from "@/lib/household/api"
import { useHouseholds } from "@/lib/household/household-context"
import { notificationApi, type NotificationStyle } from "@/lib/notifications/api"
import { PasswordInput } from "@/components/ui/password-input"
import { CategoryManager } from "../category-manager"
import { useDialogFocus } from "../use-dialog-focus"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import designStyles from "../redesign/household-secondary-design-preview.module.css"

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
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)
}

function invitationCreatedLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)
}

function invitationExpiryLabel(value: string | null) {
  if (!value) return "No expiry date"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return `Expires ${value}`

  const dateText = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
  const daysRemaining = Math.ceil((date.getTime() - Date.now()) / 86_400_000)
  const remainingText = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    daysRemaining,
    "day",
  )

  return `Expires ${dateText} · ${remainingText}`
}

export function HouseholdSettingsScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { navigate, pendingAccountDeletionUserId, clearAccountDeletion } = useChoreSync()
  const { user, features } = useAuth()
  const { households, activeHousehold, refresh, updateHousehold, removeHousehold } = useHouseholds()
  const household = activeHousehold ?? households[0]
  const householdId = household?.id
  const [settings, setSettings] = useState<HouseholdSettings | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [settingsHouseholdId, setSettingsHouseholdId] = useState<string | null>(null)
  const [settingsErrorHouseholdId, setSettingsErrorHouseholdId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [reauthMessage, setReauthMessage] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notificationStyle, setNotificationStyle] = useState<NotificationStyle>("NORMAL")
  const [styleSaved, setStyleSaved] = useState(false)
  const [styleError, setStyleError] = useState("")
  const [invitations, setInvitations] = useState<HouseholdInvitationSummary[]>([])
  const [invitationStatus, setInvitationStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  )
  const [invitationError, setInvitationError] = useState("")
  const [invitationHouseholdId, setInvitationHouseholdId] = useState<string | null>(null)
  const [invitationErrorHouseholdId, setInvitationErrorHouseholdId] = useState<string | null>(null)
  const settingsHouseholdIdRef = useRef<string | null>(null)
  const settingsRequestSequence = useRef(0)
  const notificationStyleDrafts = useRef(new Map<string, NotificationStyle>())
  const invitationHouseholdIdRef = useRef<string | null>(null)
  const invitationRequestSequence = useRef(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteStage, setDeleteStage] = useState<1 | 2 | 3>(1)
  const [deleteConsent, setDeleteConsent] = useState({ one: false, two: false, three: false })
  const [deleteName, setDeleteName] = useState("")
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [revokeError, setRevokeError] = useState("")
  const revokeDialogRef = useRef<HTMLElement | null>(null)
  const deleteDialogRef = useRef<HTMLElement | null>(null)
  const revokeBusyRef = useRef(false)
  const hasPassword = user?.hasPassword ?? true
  const hasGoogle = user?.authProviders?.includes("GOOGLE") ?? false
  const continuingAccountDeletion = pendingAccountDeletionUserId === user?.userId

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get("auth")
    if (authResult === "google-error") {
      setReauthMessage("Google verification was not completed. Please try again.")
    } else if (authResult === "google-reauthenticated") {
      setReauthMessage("Google verification succeeded. Retry the action you were performing.")
    }
    if (authResult) {
      params.delete("auth")
      const query = params.toString()
      window.history.replaceState(
        {},
        "",
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      )
    }
  }, [])

  const canEdit = settings?.currentUserRole === "OWNER"
  const canEditNotificationStyle =
    settings?.currentUserRole === "OWNER" || settings?.currentUserRole === "ADMIN"
  const canManageInvitations =
    settings?.currentUserRole === "OWNER" || settings?.currentUserRole === "ADMIN"
  const canManageCategories =
    settings?.currentUserRole === "OWNER" || settings?.currentUserRole === "ADMIN"

  const loadSettings = useCallback(async () => {
    if (!householdId) {
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    const requestId = ++settingsRequestSequence.current
    const hasCurrentData = settingsHouseholdIdRef.current === householdId
    setSettingsErrorHouseholdId(null)
    if (!hasCurrentData) setStatus("loading")
    setError("")
    try {
      const result = await householdApi.settings(householdId)
      if (requestId !== settingsRequestSequence.current) return
      settingsHouseholdIdRef.current = householdId
      setSettingsHouseholdId(householdId)
      setSettingsErrorHouseholdId(null)
      setSettings(result)
      if (!hasCurrentData) {
        setName(result.name)
        setDescription(result.description ?? "")
      }
      setNotificationStyle(
        notificationStyleDrafts.current.get(householdId) ?? result.notificationStyle ?? "NORMAL",
      )
      setStatus("loaded")
    } catch (cause) {
      if (requestId !== settingsRequestSequence.current) return
      setError(
        cause instanceof ApiError
          ? cause.message
          : hasCurrentData
            ? "Unable to refresh household settings. Please try again."
            : "Unable to load household settings. Please try again.",
      )
      setSettingsErrorHouseholdId(householdId)
      if (!hasCurrentData) setStatus("error")
    }
  }, [householdId])

  const loadInvitations = useCallback(async () => {
    if (!householdId) return
    const requestId = ++invitationRequestSequence.current
    const hasCurrentData = invitationHouseholdIdRef.current === householdId
    setInvitationErrorHouseholdId(null)
    if (!hasCurrentData) setInvitationStatus("loading")
    setInvitationError("")
    try {
      const result = await householdApi.listInvitations(householdId)
      if (requestId !== invitationRequestSequence.current) return
      setInvitations(result.filter((invitation) => invitation.status === "ACTIVE"))
      invitationHouseholdIdRef.current = householdId
      setInvitationHouseholdId(householdId)
      setInvitationErrorHouseholdId(null)
      setInvitationStatus("loaded")
    } catch (cause) {
      if (requestId !== invitationRequestSequence.current) return
      setInvitationError(
        cause instanceof ApiError ? cause.message : "Unable to load active invitations.",
      )
      setInvitationErrorHouseholdId(householdId)
      if (!hasCurrentData) setInvitationStatus("error")
    }
  }, [householdId])

  useEffect(() => {
    void loadSettings()
    return () => {
      settingsRequestSequence.current += 1
    }
  }, [loadSettings])
  useEffect(() => {
    void loadInvitations()
    return () => {
      invitationRequestSequence.current += 1
    }
  }, [loadInvitations])

  const save = async () => {
    if (!household || busy) return
    setBusy(true)
    setSaved(false)
    setError("")
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
      updateHousehold(updated)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save household settings. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const saveNotificationStyle = async () => {
    if (!household || busy) return
    const savedHouseholdId = household.id
    const styleToSave = notificationStyle
    setBusy(true)
    setStyleError("")
    setStyleSaved(false)
    try {
      await notificationApi.setHouseholdStyle(savedHouseholdId, styleToSave)
      notificationStyleDrafts.current.delete(savedHouseholdId)
      setStyleSaved(true)
      settingsRequestSequence.current += 1
      await loadSettings()
    } catch (cause) {
      setStyleError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save the household notification style.",
      )
    } finally {
      setBusy(false)
    }
  }

  const revokeInvitation = async (invitationId: string) => {
    if (!household || revokeBusyRef.current) return
    revokeBusyRef.current = true
    setRevokeBusy(true)
    setInvitationError("")
    setRevokeError("")
    try {
      await householdApi.revokeInvitation(household.id, invitationId)
      setRevokeTargetId(null)
      await loadInvitations()
    } catch (cause) {
      setRevokeError(
        cause instanceof ApiError ? cause.message : "Unable to revoke this invitation.",
      )
    } finally {
      revokeBusyRef.current = false
      setRevokeBusy(false)
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

  const closeDeleteDialog = () => {
    if (deleteBusy) return
    resetDeleteFlow()
    if (continuingAccountDeletion) clearAccountDeletion()
  }

  useDialogFocus(
    revokeDialogRef,
    revokeTargetId !== null,
    () => {
      if (!revokeBusy) setRevokeTargetId(null)
    },
    () => {
      if (!revokeTargetId) return null
      return (
        Array.from(
          document.querySelectorAll<HTMLButtonElement>("[data-revoke-invitation-trigger]"),
        ).find((button) => button.dataset.revokeInvitationTrigger === revokeTargetId) ?? null
      )
    },
  )
  useDialogFocus(deleteDialogRef, deleteOpen && Boolean(household), closeDeleteDialog, () =>
    document.querySelector<HTMLElement>("[data-household-delete-trigger]"),
  )

  const submitDeleteHousehold = async () => {
    if (!household || !settings) return
    if (
      deleteName.trim() !== household.name ||
      (hasPassword && deletePassword.trim().length === 0)
    ) {
      setDeleteError(
        hasPassword
          ? "Use the exact household name and your current password to continue."
          : "Use the exact household name to continue.",
      )
      return
    }
    setDeleteBusy(true)
    setDeleteError("")
    try {
      await householdApi.deleteHousehold(household.id, {
        householdName: household.name,
        password: deletePassword,
      })
      const remaining = removeHousehold(household.id)
      resetDeleteFlow()
      if (continuingAccountDeletion) {
        navigate("privacy-security")
      } else {
        navigate(remaining.length ? "dashboard" : "welcome")
        void refresh().catch(() => undefined)
      }
    } catch (cause) {
      setDeleteError(cause instanceof ApiError ? cause.message : "Unable to delete this household.")
    } finally {
      setDeleteBusy(false)
    }
  }

  const canContinueDelete =
    deleteConsent.one &&
    deleteConsent.two &&
    deleteConsent.three &&
    deleteName.trim() === (household?.name ?? "") &&
    (!hasPassword || deletePassword.trim().length > 0)
  const revokeTarget = invitations.find((invitation) => invitation.id === revokeTargetId) ?? null
  const visibleStatus = !householdId
    ? status
    : settingsHouseholdId === householdId
      ? status
      : settingsErrorHouseholdId === householdId
        ? "error"
        : "loading"
  const visibleInvitationStatus = !householdId
    ? invitationStatus
    : invitationHouseholdId === householdId
      ? invitationStatus
      : invitationErrorHouseholdId === householdId
        ? "error"
        : "loading"

  return (
    <div
      className={`min-h-screen pb-8 ${`${designStyles.liveRoot} ${designStyles[theme]} ${designStyles.settingsPage}`}`}
    >
      {
        <HouseholdLiveDesignHeader
          eyebrow="Household · Your home"
          heroDescription="The details and defaults that shape your shared space."
          heroEyebrow="A home, together"
          heroIcon="house"
          heroTitle={
            <>
              Make it feel
              <br />
              like yours.
            </>
          }
          household={settings?.name ?? household?.name ?? "Your household"}
          onBack={() => {
            if (continuingAccountDeletion) clearAccountDeletion()
            navigate("household")
          }}
          title="Household settings"
        />
      }
      <main className={`${designStyles.liveContent} pt-4`}>
        {reauthMessage && (
          <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">
            {reauthMessage}
          </p>
        )}
        {visibleStatus === "loading" && (
          <div
            aria-label="Loading household settings"
            className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm"
          />
        )}
        {visibleStatus === "error" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p role="alert" className="text-sm text-slate-600">
              {error}
            </p>
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              onClick={() => void loadSettings()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {visibleStatus === "loaded" && settings && (
          <>
            <section className={designStyles.settingsCard}>
              <div className={designStyles.cardHeading}>
                <div>
                  <p className={designStyles.eyebrow}>{"Your household"}</p>
                  <h2 className={undefined}>{settings.name}</h2>
                </div>
                <span className={designStyles.rolePill}>{settings.currentUserRole}</span>
              </div>

              <label className={designStyles.fieldLabel}>
                Household name
                <input
                  aria-label="Household name"
                  className={undefined}
                  disabled={!canEdit}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.target.value)
                    setSaved(false)
                  }}
                  value={name}
                />
              </label>

              <label className={designStyles.fieldLabel}>
                {"A little about this home"} <span className={undefined}>{"Optional"}</span>
                <textarea
                  aria-label="Household description"
                  className={undefined}
                  disabled={!canEdit}
                  maxLength={2000}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    setSaved(false)
                  }}
                  value={description}
                />
              </label>

              <div className={designStyles.detailGrid}>
                <div className={undefined}>
                  {
                    <>
                      <span>TIMEZONE</span>
                      <strong>{settings.timezone}</strong>
                    </>
                  }
                </div>
                <div className={undefined}>
                  {
                    <>
                      <span>STARTED</span>
                      <strong>{dateLabel(settings.createdAt)}</strong>
                    </>
                  }
                </div>
              </div>

              {canEdit ? (
                <button
                  className={designStyles.primaryButton}
                  disabled={busy || name.trim().length < 2}
                  onClick={() => void save()}
                  type="button"
                >
                  {busy ? "Saving…" : "Save household details"}
                </button>
              ) : (
                <p className={designStyles.permissionNote}>
                  Only the household owner can edit these details.
                </p>
              )}
              {saved && (
                <p role="status" className={designStyles.liveStatus}>
                  Household settings saved.
                </p>
              )}
              {error && (
                <p role="alert" className={designStyles.liveError}>
                  {error}
                </p>
              )}
            </section>

            <section className={designStyles.settingsCard}>
              <div className={designStyles.cardHeading}>
                <div>
                  <p className={designStyles.eyebrow}>{"A shared default"}</p>
                  <h2 className={undefined}>{"Notifications"}</h2>
                </div>
                {<Bell aria-hidden="true" className={designStyles.headingIcon} size={20} />}
              </div>

              <label className={designStyles.fieldLabel}>
                {"Household notification style"}
                <select
                  aria-label="Default notification style"
                  className={undefined}
                  disabled={!canEditNotificationStyle || busy}
                  onChange={(event) => {
                    if (isNotificationStyle(event.target.value)) {
                      if (householdId) {
                        notificationStyleDrafts.current.set(householdId, event.target.value)
                      }
                      setNotificationStyle(event.target.value)
                      setStyleSaved(false)
                      setStyleError("")
                    }
                  }}
                  value={notificationStyle}
                >
                  {notificationStyles.map(([style, label]) => (
                    <option key={style} value={style}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className={designStyles.helperText}>
                {
                  "This is the shared household default. Each member can choose a personal style in their own notification settings."
                }
              </p>
              {canEditNotificationStyle && (
                <button
                  className={designStyles.secondaryButton}
                  disabled={busy}
                  onClick={() => void saveNotificationStyle()}
                  type="button"
                >
                  {"Save default style"}
                </button>
              )}
              {styleSaved && (
                <p role="status" className={designStyles.liveStatus}>
                  Default style saved.
                </p>
              )}
              {styleError && (
                <p role="alert" className={designStyles.liveError}>
                  {styleError}
                </p>
              )}
            </section>

            {canManageCategories && householdId && <CategoryManager householdId={householdId} />}

            {canManageInvitations && (
              <section className={designStyles.settingsCard}>
                <div className={designStyles.cardHeading}>
                  <div>
                    <p className={designStyles.eyebrow}>{"Invitations"}</p>
                    <h2 className={undefined}>{"Who can join"}</h2>
                  </div>
                  {<span className={designStyles.countPill}>{invitations.length} active</span>}
                </div>

                <div className={undefined}>
                  {visibleInvitationStatus === "loading" && (
                    <p className={designStyles.helperText}>Loading invitations…</p>
                  )}
                  {visibleInvitationStatus === "error" && (
                    <div className={designStyles.statusBanner}>
                      <p role="alert">{invitationError}</p>
                      <button
                        className={designStyles.textButton}
                        onClick={() => void loadInvitations()}
                        type="button"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {visibleInvitationStatus === "loaded" && invitationError && (
                    <div className={designStyles.statusBanner}>
                      <p role="alert" className="flex-1">
                        {invitationError}
                      </p>
                      <button
                        className={designStyles.textButton}
                        onClick={() => void loadInvitations()}
                        type="button"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {visibleInvitationStatus === "loaded" && invitations.length === 0 && (
                    <p className={designStyles.permissionNote}>No active invitations.</p>
                  )}
                  {visibleInvitationStatus === "loaded" &&
                    invitations.map((invitation) => (
                      <div className={designStyles.invitationRow} key={invitation.id}>
                        {
                          <span className={designStyles.inviteMark}>
                            <UsersRound aria-hidden="true" size={17} />
                          </span>
                        }
                        <div className={designStyles.invitationDetails}>
                          {
                            <>
                              <div className={designStyles.invitationPrimaryLine}>
                                <strong>
                                  Created by{" "}
                                  {invitation.createdByDisplayName ?? "a household member"}
                                </strong>
                                <span className={designStyles.invitationStatus}>
                                  {invitation.status}
                                </span>
                              </div>
                              <small>Created {invitationCreatedLabel(invitation.createdAt)}</small>
                              <small>{invitationExpiryLabel(invitation.expiresAt)}</small>
                            </>
                          }
                        </div>
                        <div className={designStyles.invitationActions}>
                          <button
                            data-revoke-invitation-trigger={invitation.id}
                            className={designStyles.textDanger}
                            onClick={() => {
                              setRevokeError("")
                              setRevokeTargetId(invitation.id)
                            }}
                            type="button"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                {
                  <p className={designStyles.helperText}>
                    Only active invitations appear here. Revoking one prevents anyone from using its
                    code.
                  </p>
                }
              </section>
            )}

            {canEdit && (
              <section className={designStyles.dangerZone}>
                {
                  <div className={designStyles.cardHeading}>
                    <div>
                      <p className={designStyles.dangerEyebrow}>Irreversible</p>
                      <h2>Delete household</h2>
                    </div>
                    <LockKeyhole aria-hidden="true" size={20} />
                  </div>
                }
                <p className={undefined}>
                  {
                    "Deleting removes this household and its data for everyone. If you only want to stop managing the home, transfer ownership instead."
                  }
                </p>
                {continuingAccountDeletion && (
                  <p className={designStyles.helperText}>
                    This does not delete your account. After the household is deleted, you will
                    return to Account &amp; Privacy to continue.
                  </p>
                )}
                <button
                  data-household-delete-trigger
                  className={designStyles.dangerOutline}
                  onClick={() => setDeleteOpen(true)}
                  type="button"
                >
                  {"Review deletion steps"}
                </button>
              </section>
            )}
          </>
        )}
        {error && visibleStatus === "loaded" && (
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p role="alert" className="flex-1">
              {error}
            </p>
            <button
              className="shrink-0 font-bold underline"
              onClick={() => void loadSettings()}
              type="button"
            >
              Retry
            </button>
          </div>
        )}
      </main>

      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            aria-labelledby="revoke-invitation-title"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            role="dialog"
            ref={revokeDialogRef}
            tabIndex={-1}
          >
            <h2
              className="font-display text-lg font-black text-slate-900"
              id="revoke-invitation-title"
            >
              Revoke invitation?
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              This will immediately disable this invitation and no one will be able to use it again.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700"
                disabled={revokeBusy}
                onClick={() => setRevokeTargetId(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={revokeBusy}
                onClick={() => void revokeInvitation(revokeTarget.id)}
                type="button"
              >
                {revokeBusy ? "Revoking…" : revokeError ? "Try again" : "Confirm revoke"}
              </button>
            </div>
            {revokeError && (
              <p className="mt-3 text-sm text-rose-600" role="alert">
                {revokeError}
              </p>
            )}
          </section>
        </div>
      )}

      {deleteOpen && household && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            aria-labelledby="household-delete-dialog-title"
            aria-modal="true"
            className={designStyles.deletionDialog}
            role="dialog"
            ref={deleteDialogRef}
            tabIndex={-1}
          >
            {deleteStage === 1 && (
              <>
                <h2
                  className="font-display text-lg font-black text-slate-900"
                  id="household-delete-dialog-title"
                >
                  Delete {household.name}?
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  If you only want to stop managing this household, you can transfer ownership
                  instead.
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    className={designStyles.dialogNeutralAction}
                    onClick={() => navigate("household")}
                    type="button"
                  >
                    Transfer ownership
                  </button>
                  <button
                    className={`${designStyles.dangerButton} ${designStyles.deletionAction} w-full`}
                    onClick={() => setDeleteStage(2)}
                    type="button"
                  >
                    Continue to deletion
                  </button>
                  <button
                    className={designStyles.dialogCancelAction}
                    onClick={() => {
                      closeDeleteDialog()
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
            {deleteStage === 2 && (
              <>
                <h2
                  className="font-display text-lg font-black text-slate-900"
                  id="household-delete-dialog-title"
                >
                  Delete {household.name}?
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  This action permanently removes the household and its scoped data.
                </p>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <label className="flex items-start gap-2">
                    <input
                      checked={deleteConsent.one}
                      className="mt-1"
                      onChange={(event) =>
                        setDeleteConsent((state) => ({ ...state, one: event.target.checked }))
                      }
                      type="checkbox"
                    />{" "}
                    <span>All members will lose access.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      checked={deleteConsent.two}
                      className="mt-1"
                      onChange={(event) =>
                        setDeleteConsent((state) => ({ ...state, two: event.target.checked }))
                      }
                      type="checkbox"
                    />{" "}
                    <span>Household data and history will be permanently deleted.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      checked={deleteConsent.three}
                      className="mt-1"
                      onChange={(event) =>
                        setDeleteConsent((state) => ({ ...state, three: event.target.checked }))
                      }
                      type="checkbox"
                    />{" "}
                    <span>I understand this cannot be undone.</span>
                  </label>
                </div>
                <div className="mt-5 flex gap-2">
                  <button
                    className={`${designStyles.dialogNeutralAction} flex-1`}
                    onClick={() => setDeleteStage(1)}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className={`${designStyles.dangerButton} ${designStyles.deletionAction} flex-1`}
                    disabled={!deleteConsent.one || !deleteConsent.two || !deleteConsent.three}
                    onClick={() => setDeleteStage(3)}
                    type="button"
                  >
                    Continue
                  </button>
                </div>
              </>
            )}
            {deleteStage === 3 && (
              <>
                <h2
                  className="font-display text-lg font-black text-slate-900"
                  id="household-delete-dialog-title"
                >
                  Permanently delete {household.name}
                </h2>
                <div className="mt-4 space-y-3">
                  <label className="block text-sm font-medium text-slate-700">
                    Type “{household.name}” to confirm
                    <input
                      autoFocus
                      className={`${designStyles.dialogInput} mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal-400`}
                      onChange={(event) => setDeleteName(event.target.value)}
                      placeholder={household.name}
                      type="text"
                      value={deleteName}
                    />
                  </label>
                  {hasPassword ? (
                    <label className="block text-sm font-medium text-slate-700">
                      Password
                      <PasswordInput
                        autoComplete="current-password"
                        className={`${designStyles.dialogInput} mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal-400`}
                        id="delete-household-password"
                        name="password"
                        onChange={(event) => setDeletePassword(event.target.value)}
                        placeholder="Current password"
                        value={deletePassword}
                      />
                    </label>
                  ) : (
                    <div>
                      <p className="text-sm text-slate-600">
                        This Google-only account needs recent verification before deletion.
                      </p>
                      {hasGoogle && features.google && (
                        <button
                          className="mt-3 min-h-11 w-full rounded-xl border border-teal-200 bg-white px-3 py-2 text-sm font-bold text-teal-700"
                          onClick={() =>
                            window.location.assign(
                              apiUrl("/api/auth/google/reauthenticate?returnTo=household-settings"),
                            )
                          }
                          type="button"
                        >
                          Reauthenticate with Google, then retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {deleteError && (
                  <p role="alert" className="mt-3 text-sm text-rose-600">
                    {deleteError}
                  </p>
                )}
                <div className="mt-5 flex gap-2">
                  <button
                    className={`${designStyles.dialogNeutralAction} flex-1`}
                    onClick={() => setDeleteStage(2)}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className={`${designStyles.dangerButton} ${designStyles.deletionAction} flex-1`}
                    disabled={deleteBusy || !canContinueDelete}
                    onClick={() => void submitDeleteHousehold()}
                    type="button"
                  >
                    {deleteBusy ? "Deleting…" : `Permanently delete ${household.name}`}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
