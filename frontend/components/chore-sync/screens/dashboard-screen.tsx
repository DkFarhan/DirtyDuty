"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type HouseholdDashboard } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import type { Household } from "@/lib/household/api"
import { BottomNav } from "../bottom-nav"
import { BellIcon } from "../icons"
import { ServerAssignmentCard, ServerUpcomingAssignmentRow } from "../chore-card"
import { HouseGlyphIcon } from "../icons"
import { InviteHousemateDialog } from "../invite-housemate-dialog"
import { Avatar, ProgressBar } from "../primitives"
import { notificationApi } from "@/lib/notifications/api"
import {
  householdChoreResource,
  notificationResource,
  useDataSync,
} from "@/lib/data-sync/data-sync-context"
import {
  optimisticallyCompleteDashboardAssignment,
  rollbackDashboardAssignmentCompletion,
  updateDashboardAssignment,
} from "@/lib/household/assignment-state"
import { usePushSubscriptionHealth } from "@/lib/notifications/push-health"
import {
  formatUpcomingDateLabel,
  getLocalDateKey,
  getUpcomingAssignments,
  getWeekSummaryMessage,
  getWeekSummaryState,
  groupAssignmentsByDate,
} from "../week-summary"

function greetingForNow() {
  const hour = new Date().getHours()
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

export function DashboardScreen() {
  const { state, navigate, openNotifications } = useChoreSync()
  const {
    state: pushHealth,
    refresh: refreshPushHealth,
    restore: restorePush,
  } = usePushSubscriptionHealth()
  const {
    activeHousehold: household,
    createdHouseholdInvite,
    queueCreatedHouseholdInvite,
  } = useHouseholds()
  const [dashboard, setDashboard] = useState<HouseholdDashboard | null>(null)
  const [dashboardHouseholdId, setDashboardHouseholdId] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [notificationCountError, setNotificationCountError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set())
  const [inviteHousehold, setInviteHousehold] = useState<Household | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const dashboardRef = useRef<HouseholdDashboard | null>(null)
  const dashboardHouseholdIdRef = useRef<string | null>(null)
  const requestSequence = useRef(0)
  const unreadRequestSequence = useRef(0)
  const pendingCompletions = useRef(
    new Map<
      string,
      {
        householdId: string
        assignmentId: string
        previous: import("@/lib/household/chores").AssignmentDTO
        incrementedWeekSummary: boolean
        serverConfirmed: boolean
      }
    >(),
  )
  const pendingCompletionIds = useRef(new Set<string>())
  const choreResource = household
    ? householdChoreResource(household.id)
    : "household:none:chores-and-assignments"
  const {
    revision: choresRevision,
    invalidate: invalidateChores,
    claim: claimCompletion,
    release: releaseCompletion,
  } = useDataSync(choreResource)
  const { revision: notificationsRevision } = useDataSync(notificationResource)
  const canInvite = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  const loadDashboard = useCallback(async () => {
    if (!household) {
      requestSequence.current += 1
      dashboardRef.current = null
      dashboardHouseholdIdRef.current = null
      setDashboard(null)
      setDashboardHouseholdId(null)
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    const requestId = ++requestSequence.current
    const hasCurrentData =
      dashboardHouseholdIdRef.current === household.id && dashboardRef.current !== null
    if (!hasCurrentData) setStatus("loading")
    try {
      const nextDashboard = await choreApi.dashboard(household.id)
      if (requestId !== requestSequence.current) return
      let reconciledDashboard = nextDashboard
      for (const pending of pendingCompletions.current.values()) {
        if (pending.householdId !== household.id) continue
        const serverAssignment = [
          reconciledDashboard.today,
          reconciledDashboard.thisWeek,
          reconciledDashboard.overdue,
        ]
          .flat()
          .find((assignment) => assignment.id === pending.assignmentId)
        if (serverAssignment?.status === "COMPLETED") {
          pending.serverConfirmed = true
        } else {
          const optimistic = optimisticallyCompleteDashboardAssignment(
            reconciledDashboard,
            pending.assignmentId,
          )
          if (optimistic) reconciledDashboard = optimistic.dashboard
        }
      }
      dashboardRef.current = reconciledDashboard
      dashboardHouseholdIdRef.current = household.id
      setDashboard(reconciledDashboard)
      setDashboardHouseholdId(household.id)
      setError(null)
      setRefreshError(null)
      setStatus("loaded")
    } catch (cause) {
      if (requestId !== requestSequence.current) return
      const message =
        cause instanceof ApiError
          ? cause.message
          : hasCurrentData
            ? "Unable to refresh your dashboard. Please try again."
            : "Unable to load your dashboard. Please try again."
      if (hasCurrentData) {
        setRefreshError(message)
        return
      }
      setError(message)
      setStatus("error")
    }
  }, [household])

  useEffect(() => {
    void loadDashboard()
    return () => {
      requestSequence.current += 1
    }
  }, [choresRevision, loadDashboard])
  useEffect(() => {
    const requestId = ++unreadRequestSequence.current
    notificationApi
      .unreadCount()
      .then((result) => {
        if (requestId === unreadRequestSequence.current) {
          setUnreadCount(result.count)
          setNotificationCountError(null)
        }
      })
      .catch((cause) => {
        if (requestId !== unreadRequestSequence.current) return
        setNotificationCountError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to refresh notification count. Please try again.",
        )
      })
    return () => {
      unreadRequestSequence.current += 1
    }
  }, [notificationsRevision])

  useEffect(() => {
    if (!createdHouseholdInvite) return
    setInviteHousehold(createdHouseholdInvite)
    queueCreatedHouseholdInvite(null)
  }, [createdHouseholdInvite, queueCreatedHouseholdInvite])

  const completeAssignment = async (assignmentId: string) => {
    if (!household) return
    const operationKey = `${household.id}:${assignmentId}`
    if (pendingCompletionIds.current.has(operationKey) || !claimCompletion(assignmentId)) return
    const currentDashboard =
      dashboardHouseholdIdRef.current === household.id ? dashboardRef.current : null
    if (!currentDashboard) {
      releaseCompletion(assignmentId)
      return
    }
    const optimistic = optimisticallyCompleteDashboardAssignment(currentDashboard, assignmentId)
    if (!optimistic) {
      releaseCompletion(assignmentId)
      return
    }

    pendingCompletionIds.current.add(operationKey)
    pendingCompletions.current.set(operationKey, {
      householdId: household.id,
      assignmentId,
      previous: optimistic.previous,
      incrementedWeekSummary: optimistic.incrementedWeekSummary,
      serverConfirmed: false,
    })
    requestSequence.current += 1
    setCompletingIds((current) => new Set(current).add(operationKey))
    dashboardRef.current = optimistic.dashboard
    setDashboard(optimistic.dashboard)
    setActionError(null)
    try {
      const confirmed = await choreApi.complete(household.id, assignmentId)
      requestSequence.current += 1
      if (dashboardHouseholdIdRef.current === household.id && dashboardRef.current) {
        const reconciled = updateDashboardAssignment(dashboardRef.current, confirmed)
        dashboardRef.current = reconciled
        setDashboard(reconciled)
      }
      pendingCompletions.current.delete(operationKey)
      invalidateChores()
    } catch (cause) {
      requestSequence.current += 1
      const pending = pendingCompletions.current.get(operationKey)
      if (
        pending &&
        !pending.serverConfirmed &&
        dashboardHouseholdIdRef.current === household.id &&
        dashboardRef.current
      ) {
        const rolledBack = rollbackDashboardAssignmentCompletion(
          dashboardRef.current,
          pending.previous,
          pending.incrementedWeekSummary,
        )
        dashboardRef.current = rolledBack
        setDashboard(rolledBack)
      }
      pendingCompletions.current.delete(operationKey)
      if (dashboardHouseholdIdRef.current === household.id) {
        setActionError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to complete this chore. Please try again.",
        )
      }
      invalidateChores()
    } finally {
      pendingCompletionIds.current.delete(operationKey)
      releaseCompletion(assignmentId)
      setCompletingIds((current) => {
        const next = new Set(current)
        next.delete(operationKey)
        return next
      })
    }
  }

  const setInviteOpen = useCallback((open: boolean) => {
    if (!open) setInviteHousehold(null)
  }, [])
  const summary = dashboard?.weekSummary
  const householdCompleted = summary?.completedCount ?? 0
  const householdTotal = summary?.totalCount ?? 0
  const today = dashboard?.today ?? []
  const week = dashboard?.thisWeek ?? []
  const overdueAssignments = (dashboard?.overdue ?? []).filter(
    (assignment) =>
      assignment.overdue &&
      assignment.assignees.some((assignee) => assignee.userId === state.currentUser.id),
  )
  const overdueIds = new Set(overdueAssignments.map(({ id }) => id))
  const personalWeek = week.filter((assignment) =>
    assignment.assignees.some((assignee) => assignee.userId === state.currentUser.id),
  )
  const personalToday = today.filter((assignment) =>
    assignment.assignees.some((assignee) => assignee.userId === state.currentUser.id),
  )
  const personalCompleted = personalWeek.filter(
    (assignment) => assignment.status === "COMPLETED",
  ).length
  const personalDueToday = personalToday.filter(
    (assignment) => assignment.status === "PENDING" && !assignment.overdue,
  ).length
  const personalOverdue = overdueAssignments.length
  const personalCounts = {
    assigned: personalWeek.length,
    completed: personalCompleted,
    dueToday: personalDueToday,
    overdue: personalOverdue,
  }
  const personalState = getWeekSummaryState(personalCounts)
  const visibleStatus = household && dashboardHouseholdId !== household.id ? "loading" : status
  const dateKey = getLocalDateKey(new Date(), household?.timezone)
  const personalMessage = getWeekSummaryMessage(
    personalState,
    personalCounts,
    state.currentUser.id,
    dateKey,
  )
  const todayForDisplay = today
    .filter((assignment) => !overdueIds.has(assignment.id))
    .sort((left, right) => {
      const priority = (status: (typeof today)[number]["status"]) =>
        status === "PENDING" ? 0 : status === "COMPLETED" ? 2 : 1
      return priority(left.status) - priority(right.status)
    })
  const upcoming = getUpcomingAssignments(week, today, dateKey)
  const upcomingGroups = groupAssignmentsByDate(upcoming)
  const summaryAccent =
    personalState === "OVERDUE"
      ? {
          border: "border-l-rose-400 dark:border-l-rose-500",
          icon: "text-rose-800 dark:text-rose-300",
        }
      : personalState === "DUE_TODAY"
        ? {
            border: "border-l-amber-400 dark:border-l-amber-500",
            icon: "text-amber-800 dark:text-amber-300",
          }
        : personalState === "ALL_COMPLETE"
          ? {
              border: "border-l-teal-500 dark:border-l-teal-400",
              icon: "text-teal-800 dark:text-teal-300",
            }
          : {
              border: "border-l-slate-300 dark:border-l-slate-600",
              icon: "text-slate-700 dark:text-slate-300",
            }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 pb-20 dark:bg-slate-950">
      <header className="bg-white px-5 pt-12 pb-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-slate-500 text-sm font-medium">{greetingForNow()},</p>
            <h1 className="truncate text-2xl font-black text-slate-900 font-display">
              {state.currentUser.name} 👋
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label={
                unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
              }
              className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-600 hover:bg-teal-50 hover:text-teal-700"
              onClick={() => openNotifications("dashboard")}
              type="button"
            >
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && (
                <span
                  aria-label={`${unreadCount} unread`}
                  className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <Avatar initial={state.currentUser.avatar} className="w-10 h-10 text-sm" />
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          <HouseGlyphIcon className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
          <span className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
            {household?.name ?? "Your household"}
          </span>
        </div>
      </header>

      {household && canInvite && (
        <InviteHousemateDialog
          household={inviteHousehold ?? household}
          onOpenChange={setInviteOpen}
          open={inviteHousehold !== null}
        />
      )}

      <main className="flex flex-col gap-5 px-4 pb-4 pt-5">
        {pushHealth.status === "attention" && pushHealth.reason !== "unsupported" && (
          <section
            aria-label="Push notification status"
            aria-live="polite"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <h2 className="font-bold">
              {pushHealth.reason === "permission-denied"
                ? "Notification permission is blocked"
                : pushHealth.reason === "check-failed"
                  ? "Push status could not be checked"
                  : "Notifications need attention"}
            </h2>
            <p className="mt-1 text-xs leading-relaxed">{pushHealth.message}</p>
            <button
              className="mt-2 rounded-lg border border-amber-300 bg-white/70 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:border-amber-700 dark:bg-slate-900/50 dark:text-amber-100 dark:hover:bg-slate-900"
              onClick={() => {
                if (pushHealth.reason === "check-failed") {
                  void refreshPushHealth(true)
                } else if (pushHealth.reason === "permission-denied") {
                  openNotifications("dashboard")
                } else {
                  void restorePush()
                }
              }}
              type="button"
            >
              {pushHealth.reason === "sync-required"
                ? "Sync this browser"
                : pushHealth.reason === "check-failed"
                  ? "Retry check"
                  : pushHealth.reason === "permission-denied"
                    ? "View permission help"
                    : "Restore notifications"}
            </button>
          </section>
        )}
        {visibleStatus === "loading" && (
          <div aria-label="Loading dashboard" className="space-y-4">
            {[0, 1, 2].map((item) => (
              <div className="h-28 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />
            ))}
          </div>
        )}
        {visibleStatus === "error" && (
          <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center">
            <p role="alert" className="text-sm text-slate-600">
              {error}
            </p>
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              onClick={() => void loadDashboard()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {visibleStatus === "loaded" && (actionError || refreshError || error) && (
          <p
            role="alert"
            className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {actionError ?? refreshError ?? error}
          </p>
        )}
        {notificationCountError && (
          <p
            role="alert"
            className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {notificationCountError}
          </p>
        )}
        {visibleStatus === "loaded" && dashboard && (
          <>
            <section className="rounded-2xl bg-gradient-to-br from-teal-600 to-teal-500 p-4 text-white shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-100">
                    Household · This Week
                  </p>
                  <p className="mt-1 font-display text-xl font-black">
                    {summary?.completionPercentage ?? 0}% done
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-medium text-teal-100">Completed</p>
                  <p className="font-display text-lg font-bold">
                    {summary?.completedCount ?? 0}/{summary?.totalCount ?? 0}
                  </p>
                </div>
              </div>
              <ProgressBar
                value={summary?.completionPercentage ?? 0}
                trackClass="bg-teal-700/50"
                barClass="bg-white"
                className="h-1.5"
              />
              {householdTotal > 0 && (
                <p className="mt-1.5 text-[11px] font-medium text-teal-100">
                  {householdCompleted} down, {Math.max(0, householdTotal - householdCompleted)} to
                  go.
                </p>
              )}
            </section>

            <section
              aria-labelledby="personal-week-heading"
              className={`overflow-hidden rounded-2xl border border-l-4 border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${summaryAccent.border}`}
            >
              <div className="p-4">
                <h2
                  className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  id="personal-week-heading"
                >
                  Your Week
                </h2>
                <div className="mt-3">
                  <p className={`font-display text-base font-bold ${summaryAccent.icon}`}>
                    {personalMessage.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {personalMessage.body}
                  </p>
                </div>
                {personalWeek.length > 0 && (
                  <div
                    aria-label={`${personalCompleted} of ${personalWeek.length} assigned chores completed`}
                    className="mt-4"
                    role="img"
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        {personalCompleted} of {personalWeek.length} completed
                      </span>
                      <span>{Math.round((personalCompleted / personalWeek.length) * 100)}%</span>
                    </div>
                    <ProgressBar
                      value={(personalCompleted / personalWeek.length) * 100}
                      className="h-1"
                      trackClass="bg-slate-100 dark:bg-slate-700"
                      barClass="bg-teal-600 dark:bg-teal-400"
                    />
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Assigned
                  </dt>
                  <dd className="mt-0.5 font-display text-base font-bold text-slate-800 dark:text-slate-200">
                    {personalWeek.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Completed
                  </dt>
                  <dd
                    className={`mt-0.5 font-display text-base font-bold ${
                      personalCompleted > 0
                        ? "text-teal-800 dark:text-teal-300"
                        : "text-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {personalCompleted}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Due today
                  </dt>
                  <dd
                    className={`mt-0.5 font-display text-base font-bold ${
                      personalDueToday > 0
                        ? "text-amber-800 dark:text-amber-300"
                        : "text-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {personalDueToday}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Overdue
                  </dt>
                  <dd
                    className={`mt-0.5 font-display text-base font-bold ${
                      personalOverdue > 0
                        ? "text-rose-800 dark:text-rose-300"
                        : "text-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {personalOverdue}
                  </dd>
                </div>
              </dl>
            </section>

            {overdueAssignments.length > 0 && (
              <section aria-labelledby="needs-attention-heading">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <h2
                    className="font-display text-sm font-bold text-slate-700 dark:text-slate-200"
                    id="needs-attention-heading"
                  >
                    Needs Attention
                  </h2>
                  <span className="text-[11px] font-semibold text-rose-800 dark:text-rose-300">
                    {overdueAssignments.length} overdue
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {overdueAssignments.map((assignment) => (
                    <ServerAssignmentCard
                      assignment={assignment}
                      completing={completingIds.has(`${household?.id}:${assignment.id}`)}
                      currentUserId={state.currentUser.id}
                      householdTimezone={household?.timezone ?? "UTC"}
                      key={assignment.id}
                      onComplete={(id) => void completeAssignment(id)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="today-heading">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <h2
                  className="font-display text-sm font-bold text-slate-700 dark:text-slate-200"
                  id="today-heading"
                >
                  Today
                </h2>
                {todayForDisplay.length > 0 && (
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {todayForDisplay.filter((item) => item.status === "PENDING").length} pending
                  </span>
                )}
              </div>
              {todayForDisplay.length === 0 ? (
                <div className="rounded-2xl bg-white px-5 py-4 text-center dark:bg-slate-900">
                  {overdueAssignments.length > 0 && today.length > 0 ? (
                    <>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        No other chores due today.
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Overdue work is listed above.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mb-1.5 text-3xl">🎉</div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        No chores due today!
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Enjoy your free time
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {todayForDisplay.map((assignment) => (
                    <ServerAssignmentCard
                      assignment={assignment}
                      completing={completingIds.has(`${household?.id}:${assignment.id}`)}
                      currentUserId={state.currentUser.id}
                      householdTimezone={household?.timezone ?? "UTC"}
                      key={assignment.id}
                      onComplete={(id) => void completeAssignment(id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="up-next-heading">
              <h2
                className="mb-3 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300"
                id="up-next-heading"
              >
                Up Next
              </h2>
              {upcomingGroups.length === 0 ? (
                <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  Nothing else coming up this week.
                </p>
              ) : (
                <div className="rounded-2xl bg-white px-4 dark:bg-slate-900">
                  {upcomingGroups.map((group) => (
                    <div key={group.dateKey}>
                      <h3 className="pt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {formatUpcomingDateLabel(group.dateKey, dateKey)}
                      </h3>
                      {group.assignments.map((assignment) => (
                        <ServerUpcomingAssignmentRow
                          assignment={assignment}
                          currentUserId={state.currentUser.id}
                          householdTimezone={household?.timezone ?? "UTC"}
                          key={assignment.id}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <BottomNav active="dashboard" navigate={navigate} />
    </div>
  )
}
