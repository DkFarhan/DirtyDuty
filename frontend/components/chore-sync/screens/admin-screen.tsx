"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { cn } from "@/lib/utils"
import { BottomNav } from "../bottom-nav"
import { ChevronLeftIcon } from "../icons"
import { Avatar } from "../primitives"

type Tab = "members" | "chores"

export function AdminScreen() {
  const { state, navigate, removeChore } = useChoreSync()
  const [tab, setTab] = useState<Tab>("members")
  const [showInvite, setShowInvite] = useState(false)

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate("household")}
            aria-label="Back"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronLeftIcon className="w-5 h-5 text-slate-500" />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900 font-display">Admin Panel</h1>
            <p className="text-slate-400 text-xs">{state.household.name}</p>
          </div>
        </div>

        <div className="flex gap-2 mt-4 bg-slate-100 p-1 rounded-xl">
          {(["members", "chores"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-2 rounded-lg text-sm font-bold capitalize transition-all",
                tab === t ? "bg-white text-teal-600 shadow-sm" : "text-slate-500",
              )}
            >
              {t === "members" ? "👥 Members" : "📋 Chores"}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 pt-4">
        {tab === "members" && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setShowInvite((v) => !v)}
              className="w-full bg-teal-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-teal-100 hover:bg-teal-700 transition-colors"
            >
              <span>+</span> Invite Member
            </button>

            {showInvite && (
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4">
                <p className="font-semibold text-teal-900 text-sm mb-1">Share this invite code:</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-teal-700 tracking-widest flex-1 font-display">
                    {state.household.code}
                  </span>
                  <button className="text-xs bg-teal-600 text-white font-bold px-3 py-1.5 rounded-lg">Copy</button>
                </div>
              </div>
            )}

            {state.household.members.map((member) => (
              <div
                key={member.id}
                className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3"
              >
                <Avatar initial={member.avatar} colorClass="bg-teal-500" className="w-11 h-11" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-900">{member.name}</p>
                    {member.isAdmin && (
                      <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-1.5 py-0.5 rounded-full">
                        ADMIN
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-xs">Member since Sept 2026</p>
                </div>
                {member.id !== state.currentUser.id && (
                  <div className="flex flex-col gap-1">
                    <button className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-lg hover:bg-slate-200 transition-colors">
                      {member.isAdmin ? "Demote" : "Make Admin"}
                    </button>
                    <button className="text-xs bg-rose-50 text-rose-500 font-semibold px-2.5 py-1 rounded-lg hover:bg-rose-100 transition-colors">
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "chores" && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate("create-chore")}
              className="w-full bg-teal-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-teal-100 hover:bg-teal-700 transition-colors"
            >
              <span>+</span> Create Chore
            </button>

            {state.chores.map((chore) => (
              <div key={chore.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{chore.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-sm">{chore.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {chore.assigneeName} · {chore.frequency} · {chore.due}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 capitalize",
                      chore.status === "completed" ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600",
                    )}
                  >
                    {chore.status}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 text-xs border border-slate-200 text-slate-600 font-semibold py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                    Edit
                  </button>
                  <button
                    onClick={() => removeChore(chore.id)}
                    className="flex-1 text-xs bg-rose-50 text-rose-500 font-semibold py-1.5 rounded-lg hover:bg-rose-100 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="household" navigate={navigate} />
    </div>
  )
}
