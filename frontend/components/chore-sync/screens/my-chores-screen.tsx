"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { optimisticAssignmentCompletion } from "@/lib/household/assignment-state"
import { cn } from "@/lib/utils"
import { BottomNav } from "../bottom-nav"
import { ServerAssignmentCard } from "../chore-card"

type Tab = "upcoming" | "completed"

export function MyChoresScreen() {
  const { state, navigate } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const [tab, setTab] = useState<Tab>("upcoming")
  const [upcoming, setUpcoming] = useState<AssignmentDTO[]>([])
  const [completed, setCompleted] = useState<AssignmentDTO[]>([])
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set())
  const [targetAssignmentId, setTargetAssignmentId] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const loadedHouseholdId = useRef<string | null>(null)
  const upcomingRef = useRef<AssignmentDTO[]>([])
  const completedRef = useRef<AssignmentDTO[]>([])
  const pendingCompletionIds = useRef(new Set<string>())
  const pendingCompletions = useRef(
    new Map<
      string,
      {
        householdId: string
        assignmentId: string
        previous: AssignmentDTO
        serverConfirmed: boolean
      }
    >(),
  )
  const choreResource = household
    ? householdChoreResource(household.id)
    : "household:none:chores-and-assignments"
  const { revision, invalidate, claim, release } = useDataSync(choreResource)

  const loadChores = useCallback(async () => {
    if (!household) {
      requestSequence.current += 1
      loadedHouseholdId.current = null
      upcomingRef.current = []
      completedRef.current = []
      setUpcoming([])
      setCompleted([])
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    const requestId = ++requestSequence.current
    const hasCurrentData = loadedHouseholdId.current === household.id
    if (!hasCurrentData) setStatus("loading")
    try {
      const [nextUpcoming, nextCompleted] = await Promise.all([
        choreApi.myChores(household.id, "UPCOMING"),
        choreApi.myChores(household.id, "COMPLETED"),
      ])
      if (requestId !== requestSequence.current) return
      let reconciledUpcoming = nextUpcoming
      let reconciledCompleted = nextCompleted
      for (const pending of pendingCompletions.current.values()) {
        if (pending.householdId !== household.id) continue
        const confirmed = reconciledCompleted.find(
          (assignment) => assignment.id === pending.assignmentId,
        )
        if (confirmed?.status === "COMPLETED") {
          pending.serverConfirmed = true
          continue
        }
        const previous =
          reconciledUpcoming.find((assignment) => assignment.id === pending.assignmentId) ??
          pending.previous
        reconciledUpcoming = reconciledUpcoming.filter(
          (assignment) => assignment.id !== pending.assignmentId,
        )
        reconciledCompleted = [
          ...reconciledCompleted.filter((assignment) => assignment.id !== pending.assignmentId),
          optimisticAssignmentCompletion(previous),
        ]
      }
      upcomingRef.current = reconciledUpcoming
      completedRef.current = reconciledCompleted
      loadedHouseholdId.current = household.id
      setUpcoming(reconciledUpcoming)
      setCompleted(reconciledCompleted)
      setError(null)
      setRefreshError(null)
      setStatus("loaded")
    } catch (cause) {
      if (requestId !== requestSequence.current) return
      const message =
        cause instanceof ApiError ? cause.message : "Unable to load your chores. Please try again."
      if (hasCurrentData) {
        setRefreshError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to refresh your chores. Please try again.",
        )
        return
      }
      setError(message)
      setStatus("error")
    }
  }, [household])

  useEffect(() => {
    void loadChores()
    return () => {
      requestSequence.current += 1
    }
  }, [loadChores, revision])

  useEffect(() => {
    setTargetAssignmentId(new URLSearchParams(window.location.search).get("assignmentId"))
  }, [])

  const hasCurrentHouseholdData = !household || loadedHouseholdId.current === household.id
  const visibleStatus =
    household && !hasCurrentHouseholdData && status !== "error" ? "loading" : status

  useEffect(() => {
    if (visibleStatus !== "loaded" || !targetAssignmentId) return
    if (upcoming.some((assignment) => assignment.id === targetAssignmentId)) {
      setTab("upcoming")
    } else if (completed.some((assignment) => assignment.id === targetAssignmentId)) {
      setTab("completed")
    }
  }, [completed, targetAssignmentId, upcoming, visibleStatus])

  const completeAssignment = async (assignmentId: string) => {
    if (!household) return
    const operationKey = `${household.id}:${assignmentId}`
    if (pendingCompletionIds.current.has(operationKey) || !claim(assignmentId)) return
    const previous = upcomingRef.current.find((assignment) => assignment.id === assignmentId)
    if (!previous || previous.status !== "PENDING" || !previous.canComplete) {
      release(assignmentId)
      return
    }
    const optimistic = optimisticAssignmentCompletion(previous)
    pendingCompletionIds.current.add(operationKey)
    pendingCompletions.current.set(operationKey, {
      householdId: household.id,
      assignmentId,
      previous,
      serverConfirmed: false,
    })
    requestSequence.current += 1
    const nextUpcoming = upcomingRef.current.filter((assignment) => assignment.id !== assignmentId)
    const nextCompleted = [
      ...completedRef.current.filter((assignment) => assignment.id !== assignmentId),
      optimistic,
    ]
    upcomingRef.current = nextUpcoming
    completedRef.current = nextCompleted
    setUpcoming(nextUpcoming)
    setCompleted(nextCompleted)
    setCompletingIds((current) => new Set(current).add(operationKey))
    setActionError(null)
    try {
      const confirmed = await choreApi.complete(household.id, assignmentId)
      requestSequence.current += 1
      if (loadedHouseholdId.current === household.id) {
        const reconciledUpcoming = upcomingRef.current.filter(
          (assignment) => assignment.id !== assignmentId,
        )
        const reconciledCompleted = [
          ...completedRef.current.filter((assignment) => assignment.id !== assignmentId),
          confirmed,
        ]
        upcomingRef.current = reconciledUpcoming
        completedRef.current = reconciledCompleted
        setUpcoming(reconciledUpcoming)
        setCompleted(reconciledCompleted)
      }
      pendingCompletions.current.delete(operationKey)
      invalidate()
    } catch (cause) {
      requestSequence.current += 1
      const pending = pendingCompletions.current.get(operationKey)
      if (pending && !pending.serverConfirmed && loadedHouseholdId.current === household.id) {
        const rolledBackUpcoming = [
          ...upcomingRef.current.filter((assignment) => assignment.id !== assignmentId),
          pending.previous,
        ]
        const rolledBackCompleted = completedRef.current.filter(
          (assignment) => assignment.id !== assignmentId,
        )
        upcomingRef.current = rolledBackUpcoming
        completedRef.current = rolledBackCompleted
        setUpcoming(rolledBackUpcoming)
        setCompleted(rolledBackCompleted)
      }
      pendingCompletions.current.delete(operationKey)
      if (loadedHouseholdId.current === household.id) {
        setActionError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to complete this chore. Please try again.",
        )
      }
      invalidate()
    } finally {
      pendingCompletionIds.current.delete(operationKey)
      release(assignmentId)
      setCompletingIds((current) => {
        const next = new Set(current)
        next.delete(operationKey)
        return next
      })
    }
  }

  const displayed = tab === "upcoming" ? upcoming : completed

  useEffect(() => {
    if (visibleStatus !== "loaded" || !targetAssignmentId) return
    document.getElementById(`assignment-${targetAssignmentId}`)?.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
    })
  }, [displayed, targetAssignmentId, visibleStatus])

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-4">
        <h1 className="text-2xl font-black text-slate-900 font-display">My Chores</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {visibleStatus === "loaded"
            ? `${upcoming.length} upcoming · ${completed.length} completed`
            : status === "loading"
              ? "Loading your chores…"
              : "Chore counts unavailable"}
        </p>

        <div className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["upcoming", "completed"] as const).map((value) => {
            const isActive = tab === value
            const count =
              visibleStatus === "loaded"
                ? value === "upcoming"
                  ? upcoming.length
                  : completed.length
                : "—"
            return (
              <button
                key={value}
                onClick={() => setTab(value)}
                aria-pressed={isActive}
                className={cn(
                  "min-h-10 flex-1 rounded-lg py-2 text-sm font-bold capitalize transition-colors",
                  isActive ? "bg-white text-teal-600 shadow-sm" : "text-slate-500",
                )}
                type="button"
              >
                {value}
                <span
                  className={cn(
                    "ml-1.5 text-xs px-1.5 py-0.5 rounded-full",
                    isActive ? "bg-teal-50 text-teal-700" : "bg-slate-200 text-slate-600",
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </header>

      <main className="flex flex-col gap-3 px-4 pb-4 pt-5">
        {visibleStatus === "loading" && (
          <div aria-label="Loading my chores" className="space-y-3">
            {[0, 1, 2].map((item) => (
              <div className="h-28 animate-pulse rounded-2xl bg-white" key={item} />
            ))}
          </div>
        )}
        {visibleStatus === "error" && (
          <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center">
            <p role="alert" className="text-sm text-slate-600">
              {error}
            </p>
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              onClick={() => void loadChores()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {visibleStatus === "loaded" && (actionError || refreshError) && (
          <p
            role="alert"
            className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {actionError ?? refreshError}
          </p>
        )}
        {visibleStatus === "loaded" && displayed.length === 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white px-5 py-7 text-center">
            <div className="text-4xl mb-3">{tab === "upcoming" ? "🎉" : "📋"}</div>
            <p className="font-bold text-slate-900">
              {tab === "upcoming" ? "All caught up!" : "Nothing completed yet"}
            </p>
            <p className="text-slate-400 text-sm mt-1">
              {tab === "upcoming"
                ? "No upcoming chores assigned to you"
                : "Completed chores will appear here"}
            </p>
          </div>
        )}
        {visibleStatus === "loaded" &&
          displayed.map((assignment) => (
            <div id={`assignment-${assignment.id}`} key={assignment.id}>
              <ServerAssignmentCard
                assignment={assignment}
                completing={completingIds.has(`${household?.id}:${assignment.id}`)}
                currentUserId={state.currentUser.id}
                householdTimezone={household?.timezone ?? "UTC"}
                onComplete={(id) => void completeAssignment(id)}
              />
            </div>
          ))}
      </main>

      <BottomNav active="my-chores" navigate={navigate} />
    </div>
  )
}
