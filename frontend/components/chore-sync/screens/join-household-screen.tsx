"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { cn } from "@/lib/utils"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"

export function JoinHouseholdScreen() {
  const { navigate } = useChoreSync()
  const { join } = useHouseholds()
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async () => {
    const inviteCode = code.trim()
    if (submitting || !inviteCode) return
    setSubmitting(true)
    setError(null)
    try {
      await join(inviteCode)
      setCode("")
      navigate("dashboard")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to join household. Please try again.",
      )
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] dark:bg-slate-950">
      <button
        onClick={() => navigate("welcome")}
        className="mb-8 -ml-1 flex min-h-10 w-fit items-center gap-1 text-slate-500 dark:text-slate-400"
      >
        <ChevronLeftIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>

      <div className="mb-8">
        <ProductLogo className="mb-4 h-auto w-36 max-w-full" />
        <h1 className="mb-1 font-display text-3xl font-black text-slate-900 dark:text-white">
          Join Household
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter the invite code your housemate shared with you
        </p>
      </div>

      <div className="mb-6">
        <label
          htmlFor="invite-code"
          className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300"
        >
          Invite Code
        </label>
        <input
          id="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. ABC123"
          className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-center text-2xl font-black tracking-[0.3em] text-slate-900 placeholder-slate-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      </div>

      {error && (
        <p role="alert" className="mb-6 text-sm text-rose-600">
          {error}
        </p>
      )}

      <button
        onClick={() => void handleJoin()}
        disabled={submitting || !code.trim()}
        className={cn(
          "w-full font-bold text-[15px] py-4 rounded-xl transition-all",
          code.trim()
            ? "bg-teal-600 text-white shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98] dark:shadow-none"
            : "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800",
        )}
      >
        {submitting ? "Joining..." : "Join Household"}
      </button>
    </div>
  )
}
