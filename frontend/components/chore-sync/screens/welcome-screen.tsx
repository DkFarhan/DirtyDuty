"use client"

import { useChoreSync } from "@/lib/chore-sync/store"
import { useAuth } from "@/lib/auth/auth-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronRight, ShieldCheck } from "lucide-react"
import { useState } from "react"

export function WelcomeScreen() {
  const { navigate, clearAccountDeletion } = useChoreSync()
  const { logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    setLoggingOut(true)
    setError(null)
    try {
      await logout()
      clearAccountDeletion()
      navigate("login")
    } catch {
      setError("Unable to sign out. Please try again.")
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] dark:bg-slate-950">
      <header className="flex min-h-10 justify-end">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          disabled={loggingOut}
          onClick={handleLogout}
          type="button"
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </header>
      {error && (
        <p role="alert" className="mb-4 mt-2 text-center text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="mx-auto mb-9 mt-5 flex w-full max-w-md flex-col items-center text-center sm:mb-10 sm:mt-8">
        <ProductLogo className="mb-5 h-auto w-48 max-w-full" />
        <h1 className="mb-3 font-display text-3xl font-black text-slate-900 dark:text-white">
          Welcome!
        </h1>
        <p className="max-w-xs text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
          {
            "Let's set up your household. You can create a new one or join an existing one with an invite code."
          }
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3.5">
        <button
          onClick={() => navigate("create-household")}
          className="w-full rounded-2xl bg-teal-600 p-5 text-left text-white shadow-md shadow-teal-900/10 transition-colors hover:bg-teal-700"
        >
          <div className="mb-2 text-2xl">🏡</div>
          <div className="mb-0.5 text-[17px] font-bold">Create a Household</div>
          <div className="text-teal-100 text-sm">Start fresh and invite your housemates</div>
        </button>

        <button
          onClick={() => navigate("join-household")}
          className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left text-slate-900 transition-colors hover:border-teal-300 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-700 dark:hover:bg-slate-800"
        >
          <div className="mb-2 text-2xl">🔗</div>
          <div className="mb-0.5 text-[17px] font-bold">Join a Household</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Use an invite code from a housemate
          </div>
        </button>

        <button
          onClick={() => navigate("privacy-security")}
          className="mt-1 flex min-h-12 items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50 px-4 text-left text-sm font-semibold text-slate-700 transition-colors hover:border-teal-200 hover:bg-teal-50 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-teal-900 dark:hover:bg-slate-900"
          type="button"
        >
          <ShieldCheck aria-hidden="true" className="h-5 w-5 text-teal-700 dark:text-teal-400" />
          <span className="flex-1">Account &amp; Privacy</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" />
        </button>
      </div>
    </div>
  )
}
