"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle } from "lucide-react"
import { ApiError, apiUrl } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import type { Household } from "@/lib/household/api"
import { removeBrowserPushSubscription } from "@/lib/notifications/push"
import { PasswordInput } from "@/components/ui/password-input"
import { getLegalDocumentUrl } from "@/lib/chore-sync/legal-navigation"
import { SubpageHeader } from "./subpage-header"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileDestinationHeader, ProfileDestinationView } from "./profile-screen-view"
import profileStyles from "./profile-screen-view.module.css"

type OwnedHousehold = Pick<Household, "id" | "name">

function PrivacyAsset({
  name,
  theme,
  className,
}: {
  name: "lock" | "sign-out" | "chevron" | "delete" | "delete-chevron"
  theme: Exclude<Theme, "system">
  className: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className={className}
      src={`/profile-redesign/icons/privacy-${name}-${theme}.svg`}
    />
  )
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function ownedHouseholdsFromError(error: ApiError): OwnedHousehold[] {
  if (!error.details || typeof error.details !== "object" || !("ownedHouseholds" in error.details))
    return []
  const households = error.details.ownedHouseholds
  if (!Array.isArray(households)) return []
  return households.filter(
    (item): item is OwnedHousehold =>
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      typeof item.id === "string" &&
      "name" in item &&
      typeof item.name === "string",
  )
}

export function PrivacySecurityScreen({
  redesigned = false,
  theme = "light",
}: {
  redesigned?: boolean
  theme?: Exclude<Theme, "system">
}) {
  const {
    navigate,
    resetUserData,
    beginAccountDeletion,
    clearAccountDeletion,
    pendingAccountDeletionUserId,
  } = useChoreSync()
  const { user, logout, changePassword, deleteAccount, features } = useAuth()
  const { households, refresh, selectHousehold } = useHouseholds()
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [error, setError] = useState("")
  const [reauthMessage, setReauthMessage] = useState("")
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [deleteStage, setDeleteStage] = useState<1 | 2 | null>(null)
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false)
  const [deleteForm, setDeleteForm] = useState({ password: "", email: "" })
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const deleteBusyRef = useRef(false)
  const confirmationDialogRef = useRef<HTMLElement>(null)
  const cancelConfirmationRef = useRef<HTMLButtonElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const confirmationWasOpen = useRef(false)
  const [serverOwnedHouseholds, setServerOwnedHouseholds] = useState<OwnedHousehold[] | null>(null)
  const [ownershipStatus, setOwnershipStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  )
  const activeOwnedHouseholds = useMemo(
    () => households.filter((household) => household.currentUserRole === "OWNER"),
    [households],
  )
  const ownedHouseholds = serverOwnedHouseholds ?? activeOwnedHouseholds
  const hasPassword = user?.hasPassword ?? true
  const hasGoogle = user?.authProviders?.includes("GOOGLE") ?? false
  const emailConfirmationMatches = Boolean(
    user?.email && normalizeEmail(deleteForm.email) === normalizeEmail(user.email),
  )

  useEffect(() => {
    if (confirmationOpen) {
      confirmationWasOpen.current = true
      cancelConfirmationRef.current?.focus()
    } else if (confirmationWasOpen.current) {
      confirmationWasOpen.current = false
      reviewButtonRef.current?.focus()
    }
  }, [confirmationOpen])

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

  const reauthenticateWithGoogle = () => {
    window.location.assign(apiUrl("/api/auth/google/reauthenticate?returnTo=privacy-security"))
  }

  const signOut = async () => {
    if (signOutBusy) return
    setSignOutBusy(true)
    setError("")
    try {
      await logout()
      resetUserData()
      clearAccountDeletion()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setSignOutBusy(false)
    }
  }

  const handlePasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (passwordBusy) return

    if (passwordForm.newPassword.length < 12 || passwordForm.newPassword.length > 128) {
      setError("Password must be between 12 and 128 characters.")
      return
    }
    if (passwordForm.newPassword === passwordForm.currentPassword) {
      setError("New password must be different from your current password.")
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New passwords do not match.")
      return
    }

    setPasswordBusy(true)
    setError("")
    try {
      await changePassword(passwordForm.currentPassword, passwordForm.newPassword)
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
      resetUserData()
      navigate("login")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to update your password. Please try again.",
      )
    } finally {
      setPasswordBusy(false)
    }
  }

  const openDeleteFlow = useCallback(async () => {
    setError("")
    setDeleteAcknowledged(false)
    setDeleteForm({ password: "", email: "" })
    setConfirmationOpen(false)
    setDeleteStage(1)
    setServerOwnedHouseholds(null)
    setOwnershipStatus("loading")
    try {
      const latestHouseholds = await refresh()
      setServerOwnedHouseholds(
        latestHouseholds
          .filter((household) => household.currentUserRole === "OWNER")
          .map(({ id, name }) => ({ id, name })),
      )
      setOwnershipStatus("loaded")
    } catch {
      setOwnershipStatus("error")
      setError("Unable to refresh household ownership. Please try again.")
    }
  }, [refresh])

  useEffect(() => {
    if (user && pendingAccountDeletionUserId === user.userId) {
      void openDeleteFlow()
    }
  }, [openDeleteFlow, pendingAccountDeletionUserId, user])

  const closeDeleteFlow = () => {
    if (deleteBusy) return
    setConfirmationOpen(false)
    setDeleteStage(null)
    setDeleteAcknowledged(false)
    setDeleteForm({ password: "", email: "" })
    setError("")
    setServerOwnedHouseholds(null)
    setOwnershipStatus("idle")
    clearAccountDeletion()
  }

  const moveToConfirmation = () => {
    if (!deleteAcknowledged) return
    setError("")
    setDeleteStage(2)
  }

  const validateDeleteConfirmation = () => {
    if (!deleteAcknowledged) {
      setError("Acknowledge that account deletion is permanent before continuing.")
      return false
    }
    if (!user || !emailConfirmationMatches) {
      setError("Enter the full email address for this account.")
      return false
    }
    if (hasPassword && !deleteForm.password) {
      setError("Enter your current password.")
      return false
    }
    if (ownershipStatus !== "loaded") {
      setError("Check household ownership before deleting your account.")
      return false
    }
    if (ownedHouseholds.length > 0) {
      setError("You still own households.")
      return false
    }
    return true
  }

  const reviewAccountDeletion = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (deleteBusy || !user || !validateDeleteConfirmation()) return
    setError("")
    setConfirmationOpen(true)
  }

  const handleConfirmationKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !deleteBusy) {
      event.preventDefault()
      setConfirmationOpen(false)
      return
    }
    if (event.key !== "Tab") return

    const buttons =
      confirmationDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
    if (!buttons?.length) {
      event.preventDefault()
      confirmationDialogRef.current?.focus()
      return
    }
    const firstButton = buttons[0]
    const lastButton = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault()
      lastButton.focus()
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault()
      firstButton.focus()
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteBusyRef.current || !confirmationOpen || !user || !validateDeleteConfirmation()) return

    deleteBusyRef.current = true
    setDeleteBusy(true)
    setError("")
    try {
      await deleteAccount(deleteForm.password, normalizeEmail(deleteForm.email))
      await removeBrowserPushSubscription().catch((cause: unknown) => {
        console.warn(
          "Unable to remove the browser push subscription after account deletion.",
          cause,
        )
      })
      resetUserData()
      clearAccountDeletion()
      setDeleteStage(null)
      setConfirmationOpen(false)
      navigate("login")
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setConfirmationOpen(false)
        setServerOwnedHouseholds(ownedHouseholdsFromError(cause))
        setOwnershipStatus("loading")
        setDeleteStage(1)
        try {
          const latestHouseholds = await refresh()
          setServerOwnedHouseholds(
            latestHouseholds
              .filter((household) => household.currentUserRole === "OWNER")
              .map(({ id, name }) => ({ id, name })),
          )
          setOwnershipStatus("loaded")
          setError("You still own households.")
        } catch {
          setOwnershipStatus("error")
          setError("Unable to refresh household ownership. Please try again.")
        }
      } else {
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to delete your account. Please try again.",
        )
      }
    } finally {
      deleteBusyRef.current = false
      setDeleteBusy(false)
    }
  }

  const manageHousehold = (
    household: OwnedHousehold,
    screen: "household" | "household-settings",
  ) => {
    selectHousehold(household.id)
    setConfirmationOpen(false)
    setDeleteStage(null)
    if (user) beginAccountDeletion(user.userId)
    navigate(screen)
  }

  return (
    <ProfileDestinationView
      destination="privacy-security"
      legacyClassName="min-h-screen bg-slate-50 pb-8"
      redesigned={redesigned}
      theme={theme}
    >
      {redesigned ? (
        <ProfileDestinationHeader
          eyebrow="ACCOUNT CONTROL"
          title="Privacy & Security"
          back={() => navigate(households.length > 0 ? "profile" : "welcome")}
          theme={theme}
        />
      ) : (
        <SubpageHeader
          title="Privacy & Security"
          back={() => navigate(households.length > 0 ? "profile" : "welcome")}
        />
      )}
      <main className={redesigned ? profileStyles.privacyMain : "flex flex-col gap-4 px-4 pt-4"}>
        {redesigned && (
          <div className={profileStyles.privacySectionIntro}>
            <p>IDENTITY &amp; ACCESS</p>
            <h2 id="account-security-heading">Account security</h2>
          </div>
        )}
        {reauthMessage && (
          <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-800">
            {reauthMessage}
          </p>
        )}
        <section
          aria-labelledby={redesigned ? "account-security-heading" : undefined}
          className={
            redesigned
              ? profileStyles.privacyAccountCard
              : "rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          }
        >
          {redesigned ? (
            <>
              <div className={profileStyles.privacyAccountSummary}>
                <span className={profileStyles.privacyLockTile}>
                  <PrivacyAsset
                    className={profileStyles.privacyLockIcon}
                    name="lock"
                    theme={theme}
                  />
                </span>
                <div>
                  <p className={profileStyles.privacyAccountLabel}>SIGNED IN AS</p>
                  <p className={profileStyles.privacyAccountEmail}>{user?.email ?? "—"}</p>
                </div>
              </div>
              <div aria-hidden="true" className={profileStyles.privacyDivider} />
              <button
                className={profileStyles.privacySignOut}
                disabled={signOutBusy}
                onClick={() => void signOut()}
                type="button"
              >
                <PrivacyAsset
                  className={profileStyles.privacyActionIcon}
                  name="sign-out"
                  theme={theme}
                />
                <span>{signOutBusy ? "Signing out…" : "Sign out of this account"}</span>
                <PrivacyAsset
                  className={profileStyles.privacyChevron}
                  name="chevron"
                  theme={theme}
                />
              </button>
            </>
          ) : (
            <>
              <h2 className="font-bold text-slate-900">Account Security</h2>
              <p className="mt-1 text-sm text-slate-500">Signed in as</p>
              <p className="mt-0.5 break-all text-sm font-semibold text-slate-800">
                {user?.email ?? "—"}
              </p>
              <button
                className="mt-4 w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={signOutBusy}
                onClick={() => void signOut()}
                type="button"
              >
                {signOutBusy ? "Signing out…" : "Sign out"}
              </button>
            </>
          )}
          {!hasPassword && hasGoogle && features.google && (
            <button
              className="mt-3 w-full rounded-xl border border-teal-200 py-3 text-sm font-bold text-teal-700 hover:bg-teal-50"
              onClick={reauthenticateWithGoogle}
              type="button"
            >
              Reauthenticate with Google
            </button>
          )}
        </section>

        {redesigned && (
          <div className={profileStyles.privacySectionIntro}>
            <p>YOUR RIGHTS</p>
            <h2 id="legal-documents-heading">Legal documents</h2>
          </div>
        )}
        <section
          aria-labelledby="legal-documents-heading"
          className={
            redesigned
              ? profileStyles.privacyLegalCard
              : "rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          }
        >
          {!redesigned && (
            <h2
              className="font-bold text-slate-900 dark:text-slate-100"
              id="legal-documents-heading"
            >
              Legal documents
            </h2>
          )}
          <div
            className={
              redesigned
                ? profileStyles.privacyLegalRows
                : "mt-2 flex flex-col divide-y divide-slate-100 dark:divide-slate-800"
            }
          >
            <a
              className={
                redesigned
                  ? profileStyles.privacyLegalLink
                  : "flex min-h-11 items-center text-sm font-semibold text-teal-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300"
              }
              href={getLegalDocumentUrl("/terms", "privacy-security")}
            >
              Terms of Service
              {redesigned && (
                <PrivacyAsset
                  className={profileStyles.privacyChevron}
                  name="chevron"
                  theme={theme}
                />
              )}
            </a>
            <a
              className={
                redesigned
                  ? profileStyles.privacyLegalLink
                  : "flex min-h-11 items-center text-sm font-semibold text-teal-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300"
              }
              href={getLegalDocumentUrl("/privacy", "privacy-security")}
            >
              Privacy Policy
              {redesigned && (
                <PrivacyAsset
                  className={profileStyles.privacyChevron}
                  name="chevron"
                  theme={theme}
                />
              )}
            </a>
          </div>
        </section>

        {redesigned && (
          <div className={profileStyles.privacySectionIntro}>
            <p>SIGN-IN</p>
            <h2 id="password-sign-in-heading">Password &amp; sign-in</h2>
          </div>
        )}
        <form
          aria-labelledby={redesigned ? "password-sign-in-heading" : undefined}
          className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          onSubmit={(event) => void handlePasswordChange(event)}
        >
          {!redesigned && <h2 className="font-bold text-slate-900">Password &amp; Sign-In</h2>}
          {hasPassword ? (
            <>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Use your current password to set a new one. Changing it signs you out everywhere,
                including this session.
              </p>

              <div className="mt-3 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Current password
                  <PasswordInput
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
                    id="change-current-password"
                    name="currentPassword"
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        currentPassword: event.target.value,
                      }))
                    }
                    required
                    value={passwordForm.currentPassword}
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                  New password
                  <PasswordInput
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
                    id="change-new-password"
                    maxLength={128}
                    name="newPassword"
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        newPassword: event.target.value,
                      }))
                    }
                    required
                    value={passwordForm.newPassword}
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Confirm new password
                  <PasswordInput
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
                    id="change-confirm-password"
                    maxLength={128}
                    name="confirmPassword"
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        confirmPassword: event.target.value,
                      }))
                    }
                    required
                    value={passwordForm.confirmPassword}
                  />
                </label>
              </div>

              {error && deleteStage === null && (
                <p role="alert" className="mt-3 text-sm text-rose-600">
                  {error}
                </p>
              )}
              <button
                className="mt-4 w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
                disabled={passwordBusy}
                type="submit"
              >
                {passwordBusy ? "Updating…" : "Change password"}
              </button>
            </>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-slate-600">
                This account uses Google to sign in and doesn&apos;t have a local password yet.
              </p>
              {features.passwordReset && (
                <button
                  className="mt-3 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white"
                  onClick={() => navigate("forgot-password")}
                  type="button"
                >
                  Set a password by email
                </button>
              )}
              {hasGoogle && features.google && (
                <button
                  className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700"
                  onClick={reauthenticateWithGoogle}
                  type="button"
                >
                  Reauthenticate with Google
                </button>
              )}
            </div>
          )}
        </form>

        {redesigned && (
          <div className={profileStyles.privacyDataIntro}>
            <p>PERSONAL DATA</p>
            <h2 id="personal-data-heading">Your data, your choice</h2>
            <p className={profileStyles.privacyDataDescription}>
              Deleting your account removes sign-in and notification data. Shared household history
              needed by other members remains.
            </p>
          </div>
        )}
        <section
          data-expanded={deleteStage !== null}
          aria-labelledby={redesigned ? "personal-data-heading" : undefined}
          className={
            redesigned
              ? profileStyles.privacyDataCard
              : "rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          }
        >
          {!redesigned && (
            <>
              <h2 className="font-bold text-slate-900">Personal Data</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Deleting your account removes your personal sign-in and notification data. Household
                history needed by other members is retained.
              </p>
            </>
          )}
          {deleteStage === null && (
            <button
              className={
                redesigned
                  ? profileStyles.privacyDeleteAction
                  : "mt-3 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              }
              onClick={() => void openDeleteFlow()}
              type="button"
            >
              {redesigned && (
                <span className={profileStyles.privacyDeleteIconTile}>
                  <PrivacyAsset
                    className={profileStyles.privacyDeleteIcon}
                    name="delete"
                    theme={theme}
                  />
                </span>
              )}
              <span className={profileStyles.privacyDeleteCopy}>
                <span>{deleteBusy ? "Deleting…" : "Delete account"}</span>
                {redesigned && <small>Permanent · requires confirmation</small>}
              </span>
              {redesigned && (
                <PrivacyAsset
                  className={profileStyles.privacyChevron}
                  name="delete-chevron"
                  theme={theme}
                />
              )}
            </button>
          )}

          {deleteStage === 1 && (
            <div
              aria-labelledby="delete-account-title"
              className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
              role="region"
            >
              <h3 className="font-bold text-slate-900" id="delete-account-title">
                Before you continue
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Deleting your account permanently removes your account access and personal account
                data. This cannot be undone.
              </p>

              {ownedHouseholds.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <h4 className="font-bold text-amber-900">You still own households.</h4>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    Transfer ownership or delete each household before deleting your account.
                    Household deletion resolves ownership only; it does not delete your account.
                    Household history needed by other members remains available to them.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {ownedHouseholds.map((household) => (
                      <li className="rounded-lg bg-white p-3" key={household.id}>
                        <p className="text-sm font-semibold text-slate-900">{household.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() => manageHousehold(household, "household")}
                            type="button"
                          >
                            Transfer ownership
                          </button>
                          <button
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() => manageHousehold(household, "household-settings")}
                            type="button"
                          >
                            Delete household
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ownershipStatus === "loaded" && ownedHouseholds.length === 0 && (
                <label className="mt-4 flex min-h-11 items-start gap-2 rounded-lg text-sm text-slate-700 dark:text-slate-300">
                  <input
                    checked={deleteAcknowledged}
                    className="mt-0.5 h-4 w-4 accent-teal-600"
                    onChange={(event) => setDeleteAcknowledged(event.target.checked)}
                    type="checkbox"
                  />
                  <span>I understand that deleting my account is permanent.</span>
                </label>
              )}
              {error && (
                <div className="mt-3">
                  <p role="alert" className="text-sm text-rose-600">
                    {error}
                  </p>
                  {ownershipStatus === "error" && (
                    <button
                      className="mt-2 min-h-10 text-sm font-bold text-teal-700 underline dark:text-teal-300"
                      onClick={() => void openDeleteFlow()}
                      type="button"
                    >
                      Retry household check
                    </button>
                  )}
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700"
                  onClick={closeDeleteFlow}
                  type="button"
                >
                  Cancel
                </button>
                {ownedHouseholds.length === 0 && (
                  <button
                    className="flex-1 rounded-xl bg-slate-700 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!deleteAcknowledged || ownershipStatus !== "loaded"}
                    onClick={moveToConfirmation}
                    type="button"
                  >
                    {ownershipStatus === "loading" ? "Checking households…" : "Continue"}
                  </button>
                )}
              </div>
            </div>
          )}

          {deleteStage === 2 && (
            <form
              className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
              onSubmit={reviewAccountDeletion}
            >
              <h3 className="font-bold text-slate-900">Confirm account deletion</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Enter your account email
                {hasPassword ? " and current password" : ""} to permanently delete the account.
              </p>
              <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Account email
                <input
                  autoComplete="email"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-rose-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  onChange={(event) =>
                    setDeleteForm((current) => ({ ...current, email: event.target.value }))
                  }
                  required
                  type="email"
                  value={deleteForm.email}
                />
              </label>
              {deleteForm.email && !emailConfirmationMatches && (
                <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                  Enter the complete email address for this account. Capitalization does not matter.
                </p>
              )}
              {!user?.hasPassword && hasGoogle && features.google && (
                <button
                  className="mt-3 w-full rounded-xl border border-teal-200 bg-white py-3 text-sm font-bold text-teal-700"
                  onClick={reauthenticateWithGoogle}
                  type="button"
                >
                  Reauthenticate with Google, then retry
                </button>
              )}
              {hasPassword && (
                <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Current password
                  <PasswordInput
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-rose-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    id="delete-account-password"
                    name="password"
                    onChange={(event) =>
                      setDeleteForm((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                    value={deleteForm.password}
                  />
                </label>
              )}
              {error && !confirmationOpen && (
                <p role="alert" className="mt-3 text-sm text-rose-600">
                  {error}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700"
                  disabled={deleteBusy}
                  onClick={closeDeleteFlow}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  ref={reviewButtonRef}
                  className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    deleteBusy ||
                    ownershipStatus !== "loaded" ||
                    !deleteAcknowledged ||
                    !emailConfirmationMatches ||
                    (hasPassword && !deleteForm.password) ||
                    ownedHouseholds.length > 0
                  }
                  type="submit"
                >
                  {deleteBusy ? "Deleting…" : "Review account deletion"}
                </button>
              </div>
            </form>
          )}
        </section>
        {redesigned && (
          <p className={profileStyles.privacyDataHelper}>
            Account deletion checks household ownership first.
          </p>
        )}
      </main>
      {confirmationOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4">
            <section
              aria-describedby="account-deletion-dialog-description"
              aria-labelledby="account-deletion-dialog-title"
              aria-modal="true"
              className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:p-6 dark:border-slate-700 dark:bg-slate-900"
              onKeyDown={handleConfirmationKeyDown}
              ref={confirmationDialogRef}
              role="dialog"
              tabIndex={-1}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                  <AlertTriangle aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <h2
                    className="font-display text-lg font-black text-slate-900 dark:text-white"
                    id="account-deletion-dialog-title"
                  >
                    Permanently delete your account?
                  </h2>
                  <p
                    className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300"
                    id="account-deletion-dialog-description"
                  >
                    Your account will be permanently deleted and you will be signed out. This action
                    cannot be undone.
                  </p>
                </div>
              </div>
              {error && (
                <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              )}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  disabled={deleteBusy}
                  onClick={() => setConfirmationOpen(false)}
                  ref={cancelConfirmationRef}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  aria-busy={deleteBusy}
                  className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={deleteBusy}
                  onClick={() => void handleDeleteAccount()}
                  type="button"
                >
                  {deleteBusy ? "Deleting account…" : "Permanently delete account"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </ProfileDestinationView>
  )
}
