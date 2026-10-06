"use client"

import { useMemo, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import type { Household } from "@/lib/household/api"
import { removeBrowserPushSubscription } from "@/lib/notifications/push"
import { SubpageHeader } from "./subpage-header"

type OwnedHousehold = Pick<Household, "id" | "name">

function ownedHouseholdsFromError(error: ApiError): OwnedHousehold[] {
  if (!error.details || typeof error.details !== "object" || !("ownedHouseholds" in error.details)) return []
  const households = error.details.ownedHouseholds
  if (!Array.isArray(households)) return []
  return households.filter((item): item is OwnedHousehold =>
    typeof item === "object"
    && item !== null
    && "id" in item
    && typeof item.id === "string"
    && "name" in item
    && typeof item.name === "string")
}

export function PrivacySecurityScreen() {
  const { navigate, resetUserData } = useChoreSync()
  const { user, logout, changePassword, deleteAccount } = useAuth()
  const { households, refresh, selectHousehold } = useHouseholds()
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [error, setError] = useState("")
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" })
  const [deleteStage, setDeleteStage] = useState<1 | 2 | null>(null)
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false)
  const [deleteForm, setDeleteForm] = useState({ password: "", email: "" })
  const [serverOwnedHouseholds, setServerOwnedHouseholds] = useState<OwnedHousehold[]>([])
  const activeOwnedHouseholds = useMemo(
    () => households.filter((household) => household.currentUserRole === "OWNER"),
    [households],
  )
  const ownedHouseholds = serverOwnedHouseholds.length > 0
    ? serverOwnedHouseholds
    : activeOwnedHouseholds

  const signOut = async () => {
    if (signOutBusy) return
    setSignOutBusy(true)
    setError("")
    try {
      await logout()
      resetUserData()
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
      setError(cause instanceof ApiError ? cause.message : "Unable to update your password. Please try again.")
    } finally {
      setPasswordBusy(false)
    }
  }

  const openDeleteFlow = () => {
    setError("")
    setDeleteAcknowledged(false)
    setDeleteForm({ password: "", email: "" })
    setServerOwnedHouseholds([])
    setDeleteStage(1)
  }

  const closeDeleteFlow = () => {
    if (deleteBusy) return
    setDeleteStage(null)
    setDeleteAcknowledged(false)
    setDeleteForm({ password: "", email: "" })
    setError("")
  }

  const moveToConfirmation = () => {
    if (!deleteAcknowledged) return
    setError("")
    setDeleteStage(2)
  }

  const handleDeleteAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (deleteBusy || !user) return
    if (deleteForm.email !== user.email) {
      setError("Enter the exact email address for this account.")
      return
    }
    if (ownedHouseholds.length > 0) {
      setError("You still own households.")
      return
    }

    setDeleteBusy(true)
    setError("")
    try {
      await deleteAccount(deleteForm.password, deleteForm.email)
      await removeBrowserPushSubscription().catch((cause: unknown) => {
        console.warn("Unable to remove the browser push subscription after account deletion.", cause)
      })
      resetUserData()
      setDeleteStage(null)
      navigate("login")
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setServerOwnedHouseholds(ownedHouseholdsFromError(cause))
        await refresh().catch(() => undefined)
        setError("You still own households.")
        setDeleteStage(1)
      } else {
        setError(cause instanceof ApiError ? cause.message : "Unable to delete your account. Please try again.")
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  const manageHousehold = (household: OwnedHousehold, screen: "household" | "household-settings") => {
    selectHousehold(household.id)
    setDeleteStage(null)
    navigate(screen)
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader title="Privacy & Security" back={() => navigate("profile")} />
      <main className="flex flex-col gap-4 px-4 pt-4">
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Account Security</h2>
          <p className="mt-1 text-sm text-slate-500">Signed in as</p>
          <p className="mt-0.5 break-all text-sm font-semibold text-slate-800">{user?.email ?? "—"}</p>
          <button className="mt-4 w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={signOutBusy} onClick={() => void signOut()} type="button">
            {signOutBusy ? "Signing out…" : "Sign out"}
          </button>
        </section>

        <form className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" onSubmit={(event) => void handlePasswordChange(event)}>
          <h2 className="font-bold text-slate-900">Password & Sign-In</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Use your current password to set a new one. Changing it signs you out everywhere, including this session.</p>

          <div className="mt-3 space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Current password
              <input
                autoComplete="current-password"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
                onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                required
                type="password"
                value={passwordForm.currentPassword}
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              New password
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
                maxLength={128}
                onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                required
                type="password"
                value={passwordForm.newPassword}
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Confirm new password
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
                maxLength={128}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                required
                type="password"
                value={passwordForm.confirmPassword}
              />
            </label>
          </div>

          {error && deleteStage === null && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
          <button className="mt-4 w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50" disabled={passwordBusy} type="submit">
            {passwordBusy ? "Updating…" : "Change password"}
          </button>
        </form>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Personal Data</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Deleting your account removes your personal sign-in and notification data. Household history needed by other members is retained.</p>
          {deleteStage === null && (
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              onClick={openDeleteFlow}
              type="button"
            >
              Delete account
            </button>
          )}

          {deleteStage === 1 && (
            <div aria-labelledby="delete-account-title" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" role="region">
              <h3 className="font-bold text-slate-900" id="delete-account-title">Before you continue</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Account deletion is permanent. Your profile and notification data will be removed, and your membership in households will end. Household chore and completion history will remain for other members.
              </p>
              <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
                <input
                  checked={deleteAcknowledged}
                  className="mt-0.5"
                  onChange={(event) => setDeleteAcknowledged(event.target.checked)}
                  type="checkbox"
                />
                <span>I understand that deleting my account is permanent.</span>
              </label>

              {ownedHouseholds.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <h4 className="font-bold text-amber-900">You still own households.</h4>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">Transfer ownership or delete each household before deleting your account.</p>
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
              {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
              <div className="mt-4 flex gap-2">
                <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={closeDeleteFlow} type="button">Cancel</button>
                {ownedHouseholds.length === 0 && (
                  <button
                    className="flex-1 rounded-xl bg-slate-700 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!deleteAcknowledged}
                    onClick={moveToConfirmation}
                    type="button"
                  >
                    Continue
                  </button>
                )}
              </div>
            </div>
          )}

          {deleteStage === 2 && (
            <form className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={(event) => void handleDeleteAccount(event)}>
              <h3 className="font-bold text-slate-900">Confirm account deletion</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">Enter your account email and current password to permanently delete the account.</p>
              <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Account email
                <input
                  autoComplete="email"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-rose-400"
                  onChange={(event) => setDeleteForm((current) => ({ ...current, email: event.target.value }))}
                  required
                  type="email"
                  value={deleteForm.email}
                />
              </label>
              <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Current password
                <input
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-rose-400"
                  onChange={(event) => setDeleteForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  type="password"
                  value={deleteForm.password}
                />
              </label>
              {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
              <div className="mt-4 flex gap-2">
                <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" disabled={deleteBusy} onClick={closeDeleteFlow} type="button">Cancel</button>
                <button
                  className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={deleteBusy || deleteForm.email !== user?.email || !deleteForm.password || ownedHouseholds.length > 0}
                  type="submit"
                >
                  {deleteBusy ? "Deleting…" : "Permanently delete my account"}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}
