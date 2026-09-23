"use client"

import { useChoreSync } from "@/lib/chore-sync/store"

export function WelcomeScreen() {
  const { navigate } = useChoreSync()

  return (
    <div className="flex flex-col min-h-screen bg-white px-6 pt-20 pb-10">
      <div className="flex flex-col items-center text-center mb-12">
        <div className="w-20 h-20 bg-teal-50 rounded-3xl flex items-center justify-center mb-6">
          <span className="text-5xl">🎉</span>
        </div>
        <h1 className="text-3xl font-black text-slate-900 mb-3 font-display">Welcome to ChoreSync!</h1>
        <p className="text-slate-500 text-[15px] leading-relaxed max-w-xs">
          {
            "Let's set up your household. You can create a new one or join an existing one with an invite code."
          }
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <button
          onClick={() => navigate("create-household")}
          className="w-full bg-teal-600 text-white rounded-2xl p-5 text-left hover:bg-teal-700 active:scale-[0.98] transition-all shadow-lg shadow-teal-100"
        >
          <div className="text-2xl mb-2">🏡</div>
          <div className="font-bold text-[17px] mb-0.5">Create a Household</div>
          <div className="text-teal-100 text-sm">Start fresh and invite your housemates</div>
        </button>

        <button
          onClick={() => navigate("join-household")}
          className="w-full border-2 border-slate-200 text-slate-900 rounded-2xl p-5 text-left hover:border-teal-300 hover:bg-teal-50 active:scale-[0.98] transition-all"
        >
          <div className="text-2xl mb-2">🔗</div>
          <div className="font-bold text-[17px] mb-0.5">Join a Household</div>
          <div className="text-slate-500 text-sm">Use an invite code from a housemate</div>
        </button>
      </div>
    </div>
  )
}
