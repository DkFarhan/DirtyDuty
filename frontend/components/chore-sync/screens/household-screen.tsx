"use client"

import { useChoreSync } from "@/lib/chore-sync/store"
import { memberStats } from "@/lib/chore-sync/selectors"
import { BottomNav } from "../bottom-nav"
import { MemberCard, memberColor } from "../member-card"
import { ChevronRightIcon } from "../icons"
import { SectionHeader } from "../primitives"

const adminActions = [
  { icon: "➕", label: "Invite Member", sub: "Share an invite code", target: null },
  { icon: "📋", label: "Manage Chores", sub: "Create, edit, assign chores", target: "admin" as const },
  { icon: "⚙️", label: "Household Settings", sub: "Name, description, preferences", target: null },
]

export function HouseholdScreen() {
  const { state, navigate } = useChoreSync()
  const { household, currentUser } = state

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-slate-500 text-sm font-medium">Your household</p>
            <h1 className="text-2xl font-black text-slate-900 font-display">{household.name}</h1>
          </div>
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 text-right">
            <p className="text-[10px] text-teal-500 font-semibold uppercase tracking-wider">Invite Code</p>
            <p className="text-teal-700 font-black text-lg tracking-widest font-display">{household.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
            {household.members.length} members
          </span>
          {currentUser.isAdmin && (
            <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-2.5 py-1 rounded-full">
              You are Admin
            </span>
          )}
        </div>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-4">
        <section>
          <SectionHeader title="Members" />
          <div className="flex flex-col gap-3">
            {household.members.map((member, i) => {
              const stats = memberStats(state, member.id)
              return (
                <MemberCard
                  key={member.id}
                  member={member}
                  colorClass={memberColor(i)}
                  done={stats.completed}
                  total={stats.assigned}
                  rate={stats.completionRate}
                  isCurrentUser={member.id === currentUser.id}
                />
              )
            })}
          </div>
        </section>

        {currentUser.isAdmin && (
          <section>
            <SectionHeader title="Admin Actions" />
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
              {adminActions.map((item) => (
                <button
                  key={item.label}
                  onClick={() => item.target && navigate(item.target)}
                  className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                >
                  <span className="text-xl w-8 text-center">{item.icon}</span>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-900 text-sm">{item.label}</p>
                    <p className="text-slate-400 text-xs">{item.sub}</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <BottomNav active="household" navigate={navigate} />
    </div>
  )
}
