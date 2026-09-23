"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { cn } from "@/lib/utils"
import { ChevronLeftIcon } from "../icons"

export function JoinHouseholdScreen() {
  const { navigate } = useChoreSync()
  const [code, setCode] = useState("")

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
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. ABC123"
          maxLength={6}
          className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-2xl font-black text-center tracking-[0.3em] transition-all"
        />
      </div>

      {code.length === 6 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-emerald-800 font-semibold text-sm">Household found!</p>
            <p className="text-emerald-600 text-xs">Apartment 305 · 3 members</p>
          </div>
        </div>
      )}

      <button
        onClick={() => navigate("dashboard")}
        disabled={code.length < 3}
        className={cn(
          "w-full font-bold text-[15px] py-4 rounded-xl transition-all",
          code.length >= 3
            ? "bg-teal-600 text-white shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98]"
            : "bg-slate-100 text-slate-400 cursor-not-allowed",
        )}
      >
        Join Household
      </button>
    </div>
  )
}
