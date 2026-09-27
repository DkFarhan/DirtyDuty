"use client"

import { useCallback, useEffect, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdStats, todayChores, upcomingWeekChores } from "@/lib/chore-sync/selectors"
import { useHouseholds } from "@/lib/household/household-context"
import type { Household } from "@/lib/household/api"
import { Button } from "@/components/ui/button"
import { BottomNav } from "../bottom-nav"
import { TodayChoreCard, WeekChoreCard } from "../chore-card"
import { BellIcon, HouseGlyphIcon } from "../icons"
import { InviteHousemateDialog } from "../invite-housemate-dialog"
import { Avatar, ProgressBar, SectionHeader } from "../primitives"
import { UserPlus } from "lucide-react"

function greetingForNow() {
  const hour = new Date().getHours()
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

const notifications = [
  { icon: "📋", text: "You have been assigned Bathroom Cleaning.", time: "2h ago" },
  { icon: "⏰", text: "Kitchen cleaning is due today at 6 PM.", time: "4h ago" },
  { icon: "✅", text: "Ahmed completed Garbage Duty.", time: "1d ago" },
]

export function DashboardScreen() {
  const { state, navigate, markComplete } = useChoreSync()
  const { households, createdHouseholdInvite, queueCreatedHouseholdInvite } = useHouseholds()
  const [showNotif, setShowNotif] = useState(false)
  const [inviteHousehold, setInviteHousehold] = useState<Household | null>(null)

  const today = todayChores(state)
  const week = upcomingWeekChores(state)
  const stats = householdStats(state)
  const greeting = greetingForNow()
  const household = households[0]
  const canInvite = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  useEffect(() => {
    if (!createdHouseholdInvite) return
    setInviteHousehold(createdHouseholdInvite)
    queueCreatedHouseholdInvite(null)
  }, [createdHouseholdInvite, queueCreatedHouseholdInvite])

  const openInvite = useCallback(() => {
    if (household && canInvite) setInviteHousehold(household)
  }, [canInvite, household])

  const setInviteOpen = useCallback((open: boolean) => {
    if (!open) setInviteHousehold(null)
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-slate-500 text-sm font-medium">{greeting},</p>
            <h1 className="text-2xl font-black text-slate-900 font-display">{state.currentUser.name} 👋</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNotif((v) => !v)}
              aria-label="Notifications"
              className="relative w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center"
            >
              <BellIcon className="w-5 h-5 text-slate-600" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full" />
            </button>
            <Avatar initial={state.currentUser.avatar} className="w-10 h-10 text-sm" />
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <HouseGlyphIcon className="h-3.5 w-3.5 shrink-0 text-teal-600" />
            <span className="truncate text-xs font-semibold text-teal-600">
              {household?.name ?? state.household.name}
            </span>
          </div>
          {household && canInvite && (
            <Button
              className="h-8 shrink-0 gap-1.5 rounded-lg border-teal-100 bg-teal-50 px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-100"
              onClick={openInvite}
              type="button"
              variant="outline"
            >
              <UserPlus aria-hidden="true" />
              Invite housemate
            </Button>
          )}
        </div>
      </header>

      {household && canInvite && (
        <InviteHousemateDialog
          household={inviteHousehold ?? household}
          onOpenChange={setInviteOpen}
          open={inviteHousehold !== null}
        />
      )}

      {showNotif && (
        <div className="mx-4 mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-10 relative">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-bold text-slate-900 text-sm">Notifications</span>
            <button onClick={() => setShowNotif(false)} className="text-slate-400 text-xs">
              Dismiss all
            </button>
          </div>
          {notifications.map((n, i) => (
            <div key={i} className="px-4 py-3 flex items-start gap-3 border-b border-slate-50 last:border-0">
              <span className="text-xl">{n.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 leading-snug">{n.text}</p>
                <p className="text-xs text-slate-400 mt-0.5">{n.time}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pt-4 flex flex-col gap-4">
        <section className="bg-gradient-to-br from-teal-600 to-teal-500 rounded-2xl p-5 text-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-teal-100 text-xs font-medium uppercase tracking-wider">This Week</p>
              <p className="text-2xl font-black mt-0.5 font-display">{stats.completionRate}% done</p>
            </div>
            <div className="text-right">
              <p className="text-teal-100 text-xs">Completed</p>
              <p className="text-xl font-black font-display">
                {stats.completedChores}/{stats.totalChores}
              </p>
            </div>
          </div>
          <ProgressBar value={stats.completionRate} trackClass="bg-teal-700/50" barClass="bg-white" className="h-2" />
          <p className="text-teal-100 text-xs mt-2">Household completion rate</p>
        </section>

        <section>
          <SectionHeader
            title="Today"
            action={
              today.length > 0 ? (
                <span className="text-xs bg-rose-100 text-rose-600 font-semibold px-2 py-0.5 rounded-full">
                  {today.length} pending
                </span>
              ) : null
            }
          />

          {today.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center border border-slate-100">
              <div className="text-4xl mb-2">🎉</div>
              <p className="font-bold text-slate-900">No chores due today!</p>
              <p className="text-slate-400 text-sm mt-1">Enjoy your free time</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {today.map((chore) => (
                <TodayChoreCard key={chore.id} chore={chore} onComplete={markComplete} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader title="This Week" />
          <div className="flex gap-3 overflow-x-auto pb-1">
            {week.slice(0, 5).map((chore) => (
              <WeekChoreCard key={chore.id} chore={chore} />
            ))}
          </div>
        </section>
      </div>

      <BottomNav active="dashboard" navigate={navigate} />
    </div>
  )
}
