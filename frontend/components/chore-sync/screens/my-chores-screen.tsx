"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { choresForMember } from "@/lib/chore-sync/selectors"
import { cn } from "@/lib/utils"
import { BottomNav } from "../bottom-nav"
import { ListChoreCard } from "../chore-card"

type Tab = "upcoming" | "completed"

export function MyChoresScreen() {
  const { state, navigate, markComplete } = useChoreSync()
  const [tab, setTab] = useState<Tab>("upcoming")

  const myChores = choresForMember(state, state.currentUser.id)
  const upcoming = myChores.filter((c) => c.status === "pending")
  const completed = myChores.filter((c) => c.status === "completed")
  const displayed = tab === "upcoming" ? upcoming : completed

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-4">
        <h1 className="text-2xl font-black text-slate-900 font-display">My Chores</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {upcoming.length} upcoming · {completed.length} completed
        </p>

        <div className="flex gap-2 mt-4 bg-slate-100 p-1 rounded-xl">
          {(["upcoming", "completed"] as const).map((t) => {
            const isActive = tab === t
            const count = t === "upcoming" ? upcoming.length : completed.length
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-bold capitalize transition-all",
                  isActive ? "bg-white text-teal-600 shadow-sm" : "text-slate-500",
                )}
              >
                {t}
                <span
                  className={cn(
                    "ml-1.5 text-xs px-1.5 py-0.5 rounded-full",
                    isActive ? "bg-teal-50 text-teal-600" : "bg-slate-200 text-slate-500",
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-3">
        {displayed.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
            <div className="text-4xl mb-3">{tab === "upcoming" ? "🎉" : "📋"}</div>
            <p className="font-bold text-slate-900">
              {tab === "upcoming" ? "All caught up!" : "Nothing completed yet"}
            </p>
            <p className="text-slate-400 text-sm mt-1">
              {tab === "upcoming" ? "No upcoming chores assigned to you" : "Completed chores will appear here"}
            </p>
          </div>
        ) : (
          displayed.map((chore) => <ListChoreCard key={chore.id} chore={chore} onComplete={markComplete} />)
        )}
      </div>

      <BottomNav active="my-chores" navigate={navigate} />
    </div>
  )
}
