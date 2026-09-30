"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { SubpageHeader } from "./subpage-header"

export function PrivacySecurityScreen() {
  const { navigate } = useChoreSync()
  const { user, logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await logout()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader title="Privacy & Security" back={() => navigate("profile")} />
      <main className="flex flex-col gap-4 px-4 pt-4">
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Account security</h2>
          <p className="mt-1 text-sm text-slate-500">Signed in as</p>
          <p className="mt-0.5 break-all text-sm font-semibold text-slate-800">{user?.email ?? "—"}</p>
          <button className="mt-4 w-full rounded-xl border border-rose-200 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50" disabled={busy} onClick={() => void signOut()} type="button">{busy ? "Signing out…" : "Sign out"}</button>
          {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Password and sign-in</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">DirtyDuty currently signs you in with your account credentials. Password changes and recovery settings are not available in this app yet.</p>
          <button aria-describedby="password-note" className="mt-3 cursor-not-allowed rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-400" disabled type="button">Change password</button>
          <p className="sr-only" id="password-note">Coming soon; this action is disabled.</p>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Personal data</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Your profile and household data are used to provide chore and household features. Account deletion and data export tools are not available yet.</p>
          <button aria-describedby="data-note" className="mt-3 cursor-not-allowed rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-400" disabled type="button">Delete account</button>
          <p className="sr-only" id="data-note">Coming soon; this action is disabled and no data will be deleted.</p>
        </section>
      </main>
    </div>
  )
}
