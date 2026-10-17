"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { getLegalDocumentUrl } from "@/lib/chore-sync/legal-navigation"

export function LegalAcceptanceScreen() {
  const { completeLegalAcceptance, logout } = useAuth()
  const { navigate, resetUserData } = useChoreSync()
  const { refresh } = useHouseholds()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const continueToDirtyDuty = async () => {
    if (busy) return
    if (!accepted) {
      setError("Please accept the Terms of Service and acknowledge the Privacy Policy.")
      return
    }

    setBusy(true)
    setError("")
    try {
      await completeLegalAcceptance()
      await refresh()
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your acknowledgement. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await logout()
      resetUserData()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-white px-6 pb-10 pt-12">
      <div className="flex flex-col items-center">
        <ProductLogo className="mb-8 h-auto w-44 max-w-full" />
        <div className="w-full">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">
            Legal updates
          </p>
          <h1 className="mt-2 font-display text-3xl font-black leading-tight text-slate-900">
            Review our policies
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            DirtyDuty&apos;s Terms of Service and Privacy Policy have been updated or need your
            acknowledgement. Please review both to continue using your account.
          </p>

          <div className="mt-5 flex flex-col divide-y divide-slate-100 rounded-2xl border border-slate-100 px-4">
            <a
              className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-semibold text-teal-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300"
              href={getLegalDocumentUrl("/terms", "legal-acceptance")}
            >
              Terms of Service <span aria-hidden="true">↗</span>
            </a>
            <a
              className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-semibold text-teal-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300"
              href={getLegalDocumentUrl("/privacy", "legal-acceptance")}
            >
              Privacy Policy <span aria-hidden="true">↗</span>
            </a>
          </div>

          <label className="mt-5 flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm leading-relaxed text-slate-700">
            <input
              aria-describedby={error ? "legal-acceptance-error" : undefined}
              checked={accepted}
              className="mt-1 h-4 w-4 shrink-0 accent-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              onChange={(event) => {
                setAccepted(event.target.checked)
                if (event.target.checked) setError("")
              }}
              type="checkbox"
            />
            <span>I agree to the Terms of Service and acknowledge the Privacy Policy.</span>
          </label>

          {error && (
            <p className="mt-3 text-sm text-rose-600" id="legal-acceptance-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="mt-5 min-h-12 w-full rounded-xl bg-teal-600 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-teal-700 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={() => void continueToDirtyDuty()}
            type="button"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <button
            className="mt-3 min-h-10 w-full text-sm font-semibold text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-60"
            disabled={busy}
            onClick={() => void signOut()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  )
}
