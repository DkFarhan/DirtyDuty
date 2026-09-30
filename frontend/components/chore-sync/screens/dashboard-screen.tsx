"use client"

import { useCallback, useEffect, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type HouseholdDashboard } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import type { Household } from "@/lib/household/api"
import { BottomNav } from "../bottom-nav"
import { BellIcon } from "../icons"
import { ServerAssignmentCard, ServerWeekAssignmentCard } from "../chore-card"
import { HouseGlyphIcon } from "../icons"
import { InviteHousemateDialog } from "../invite-housemate-dialog"
import { Avatar, ProgressBar, SectionHeader } from "../primitives"
import { notificationApi } from "@/lib/notifications/api"

function greetingForNow() {
  const hour = new Date().getHours()
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

export function DashboardScreen() {
  const { state, navigate, openNotifications } = useChoreSync()
  const { households, createdHouseholdInvite, queueCreatedHouseholdInvite } = useHouseholds()
  const [dashboard, setDashboard] = useState<HouseholdDashboard | null>(null)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [inviteHousehold, setInviteHousehold] = useState<Household | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const household = households[0]
  const canInvite = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  const loadDashboard = useCallback(async () => {
    if (!household) {
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    setStatus("loading")
    setError(null)
    try {
      setDashboard(await choreApi.dashboard(household.id))
      setStatus("loaded")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load your dashboard. Please try again.")
      setStatus("error")
    }
  }, [household])

  useEffect(() => { void loadDashboard() }, [loadDashboard])
  useEffect(() => {
    notificationApi.unreadCount().then((result) => setUnreadCount(result.count)).catch(() => setUnreadCount(0))
  }, [])

  useEffect(() => {
    if (!createdHouseholdInvite) return
    setInviteHousehold(createdHouseholdInvite)
    queueCreatedHouseholdInvite(null)
  }, [createdHouseholdInvite, queueCreatedHouseholdInvite])

  const completeAssignment = async (assignmentId: string) => {
    if (!household || completingId) return
    setCompletingId(assignmentId)
    setError(null)
    try {
      await choreApi.complete(household.id, assignmentId)
      await loadDashboard()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to complete this chore. Please try again.")
    } finally {
      setCompletingId(null)
    }
  }

  const setInviteOpen = useCallback((open: boolean) => {
    if (!open) setInviteHousehold(null)
  }, [])
  const summary = dashboard?.weekSummary
  const today = dashboard?.today ?? []
  const week = dashboard?.thisWeek ?? []

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-slate-500 text-sm font-medium">{greetingForNow()},</p>
            <h1 className="truncate text-2xl font-black text-slate-900 font-display">{state.currentUser.name} 👋</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-600 hover:bg-teal-50 hover:text-teal-700" onClick={() => openNotifications("dashboard")} type="button">
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && <span aria-label={`${unreadCount} unread`} className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
            </button>
            <Avatar initial={state.currentUser.avatar} className="w-10 h-10 text-sm" />
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          <HouseGlyphIcon className="h-3.5 w-3.5 shrink-0 text-teal-600" />
          <span className="truncate text-xs font-semibold text-teal-600">{household?.name ?? "Your household"}</span>
        </div>
      </header>

      {household && canInvite && (
        <InviteHousemateDialog
          household={inviteHousehold ?? household}
          onOpenChange={setInviteOpen}
          open={inviteHousehold !== null}
        />
      )}

      <div className="px-4 pt-4 flex flex-col gap-4">
        {status === "loading" && (
          <div aria-label="Loading dashboard" className="space-y-4">
            {[0, 1, 2].map((item) => <div className="h-28 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />)}
          </div>
        )}
        {status === "error" && (
          <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center">
            <p role="alert" className="text-sm text-slate-600">{error}</p>
            <button className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => void loadDashboard()} type="button">Try again</button>
          </div>
        )}
        {status === "loaded" && error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {status === "loaded" && dashboard && (
          <>
            <section className="bg-gradient-to-br from-teal-600 to-teal-500 rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-teal-100 text-xs font-medium uppercase tracking-wider">This Week</p>
                  <p className="text-2xl font-black mt-0.5 font-display">{summary?.completionPercentage ?? 0}% done</p>
                </div>
                <div className="text-right">
                  <p className="text-teal-100 text-xs">Completed</p>
                  <p className="text-xl font-black font-display">{summary?.completedCount ?? 0}/{summary?.totalCount ?? 0}</p>
                </div>
              </div>
              <ProgressBar value={summary?.completionPercentage ?? 0} trackClass="bg-teal-700/50" barClass="bg-white" className="h-2" />
              <p className="text-teal-100 text-xs mt-2">Household completion rate</p>
            </section>

            <section>
              <SectionHeader
                title="Today"
                action={today.length > 0 ? (
                  <span className="text-xs bg-rose-100 text-rose-600 font-semibold px-2 py-0.5 rounded-full">
                    {today.filter((item) => item.status === "PENDING").length} pending
                  </span>
                ) : null}
              />
              {today.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 text-center border border-slate-100">
                  <div className="text-4xl mb-2">🎉</div>
                  <p className="font-bold text-slate-900">No chores due today!</p>
                  <p className="text-slate-400 text-sm mt-1">Enjoy your free time</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {today.map((assignment) => (
                    <ServerAssignmentCard
                      assignment={assignment}
                      completing={completingId === assignment.id}
                      currentUserId={state.currentUser.id}
                      householdTimezone={household?.timezone ?? "UTC"}
                      key={assignment.id}
                      onComplete={(id) => void completeAssignment(id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeader title="This Week" />
              {week.length === 0 ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center text-sm text-slate-400">No chores scheduled this week.</div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {week.slice(0, 10).map((assignment) => (
                    <ServerWeekAssignmentCard assignment={assignment} currentUserId={state.currentUser.id} householdTimezone={household?.timezone ?? "UTC"} key={assignment.id} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <BottomNav active="dashboard" navigate={navigate} />
    </div>
  )
}
