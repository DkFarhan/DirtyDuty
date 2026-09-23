"use client"

import { useChoreSync } from "@/lib/chore-sync/store"
import { memberStats } from "@/lib/chore-sync/selectors"
import { BottomNav } from "../bottom-nav"
import { ChevronRightIcon } from "../icons"
import { Avatar } from "../primitives"

const accountItems = [
  { icon: "👤", label: "Edit Profile" },
  { icon: "🔔", label: "Notifications" },
  { icon: "🔒", label: "Privacy & Security" },
  { icon: "❓", label: "Help & Support" },
]

/**
 * The "Rewards & Streaks" card below is a deliberate teaser for the upcoming
 * gamification features (points, badges, achievements, leaderboards, stats).
 * When those ship, this card becomes the entry point — the data contracts
 * already live in `lib/chore-sync/types.ts`.
 */
const rewardChips = ["⚡ Streaks", "🏅 Badges", "📊 Stats"]

export function ProfileScreen() {
  const { state, navigate } = useChoreSync()
  const { currentUser, household } = state
  const stats = memberStats(state, currentUser.id)

  const statTiles = [
    { value: stats.assigned, label: "Assigned" },
    { value: stats.completed, label: "Completed" },
    { value: `${stats.completionRate}%`, label: "Rate" },
  ]

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-6">
        <div className="flex items-center gap-4">
          <Avatar initial={currentUser.avatar} className="w-16 h-16 rounded-2xl text-3xl shadow-lg shadow-teal-100" />
          <div>
            <h1 className="text-xl font-black text-slate-900 font-display">{currentUser.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-slate-400 text-sm">{household.name}</span>
              {currentUser.isAdmin && (
                <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          {statTiles.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-center">
              <p className="text-2xl font-black text-slate-900 font-display">{s.value}</p>
              <p className="text-slate-400 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        <section className="bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl p-5 text-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-violet-200 text-xs font-semibold uppercase tracking-wider">Coming Soon</p>
              <p className="text-xl font-black mt-0.5 font-display">Rewards &amp; Streaks</p>
            </div>
            <span className="text-4xl">🏆</span>
          </div>
          <p className="text-violet-200 text-sm leading-relaxed">
            Earn points, unlock badges, and compete on household leaderboards. Keep completing chores to be ready!
          </p>
          <div className="flex gap-2 mt-4">
            {rewardChips.map((t) => (
              <span key={t} className="text-xs bg-white/20 text-white font-medium px-2.5 py-1 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </section>

        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <p className="px-4 pt-4 pb-2 text-xs font-black text-slate-500 uppercase tracking-wider font-display">
            Account
          </p>
          {accountItems.map((item) => (
            <button
              key={item.label}
              className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition-colors border-t border-slate-50"
            >
              <span className="text-lg w-7 text-center">{item.icon}</span>
              <span className="flex-1 text-left font-medium text-slate-800 text-sm">{item.label}</span>
              <ChevronRightIcon className="w-4 h-4 text-slate-300" />
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate("login")}
          className="w-full border border-rose-200 text-rose-500 font-bold py-3.5 rounded-xl hover:bg-rose-50 transition-colors"
        >
          Sign Out
        </button>
      </div>

      <BottomNav active="profile" navigate={navigate} />
    </div>
  )
}
