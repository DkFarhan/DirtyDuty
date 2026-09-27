"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { cn } from "@/lib/utils"
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
      setError(cause instanceof Error ? cause.message : "Unable to join household. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-white px-6 pt-12 pb-10">
      <button onClick={() => navigate("welcome")} className="flex items-center gap-1 text-slate-500 mb-8 -ml-1 w-fit">
        <ChevronLeftIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>

      <div className="mb-8">
        <div className="text-4xl mb-4">🔗</div>
        <h1 className="text-3xl font-black text-slate-900 mb-1 font-display">Join Household</h1>
        <p className="text-slate-500 text-sm">Enter the invite code your housemate shared with you</p>
      </div>

      <div className="mb-6">
        <label htmlFor="invite-code" className="block text-sm font-semibold text-slate-700 mb-1.5">
          Invite Code
        </label>
        <input
          id="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. ABC123"
          className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-2xl font-black text-center tracking-[0.3em] transition-all"
        />
      </div>

      {error && <p role="alert" className="mb-6 text-sm text-rose-600">{error}</p>}

      <button
        onClick={() => void handleJoin()}
        disabled={submitting || !code.trim()}
        className={cn(
          "w-full font-bold text-[15px] py-4 rounded-xl transition-all",
          code.trim()
            ? "bg-teal-600 text-white shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98]"
            : "bg-slate-100 text-slate-400 cursor-not-allowed",
        )}
      >
        {submitting ? "Joining..." : "Join Household"}
      </button>
    </div>
  )
}
