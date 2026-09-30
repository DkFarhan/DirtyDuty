"use client"

import { useCallback, useEffect, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { cn } from "@/lib/utils"
import { BottomNav } from "../bottom-nav"
import { ServerAssignmentCard } from "../chore-card"

type Tab = "upcoming" | "completed"

export function MyChoresScreen() {
  const { state, navigate } = useChoreSync()
  const { households } = useHouseholds()
  const [tab, setTab] = useState<Tab>("upcoming")
  const [upcoming, setUpcoming] = useState<AssignmentDTO[]>([])
  const [completed, setCompleted] = useState<AssignmentDTO[]>([])
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [targetAssignmentId, setTargetAssignmentId] = useState<string | null>(null)
  const household = households[0]

  const loadChores = useCallback(async () => {
    if (!household) {
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    setStatus("loading")
    setError(null)
    try {
      const [nextUpcoming, nextCompleted] = await Promise.all([
        choreApi.myChores(household.id, "UPCOMING"),
        choreApi.myChores(household.id, "COMPLETED"),
      ])
      setUpcoming(nextUpcoming)
      setCompleted(nextCompleted)
      setStatus("loaded")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load your chores. Please try again.")
      setStatus("error")
    }
  }, [household])

  useEffect(() => { void loadChores() }, [loadChores])

  useEffect(() => {
    setTargetAssignmentId(new URLSearchParams(window.location.search).get("assignmentId"))
  }, [])

  useEffect(() => {
    if (status !== "loaded" || !targetAssignmentId) return
    if (upcoming.some((assignment) => assignment.id === targetAssignmentId)) {
      setTab("upcoming")
    } else if (completed.some((assignment) => assignment.id === targetAssignmentId)) {
      setTab("completed")
    }
  }, [completed, status, targetAssignmentId, upcoming])

  const completeAssignment = async (assignmentId: string) => {
    if (!household || completingId) return
    setCompletingId(assignmentId)
    setActionError(null)
    try {
      await choreApi.complete(household.id, assignmentId)
      await loadChores()
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Unable to complete this chore. Please try again.")
    } finally {
      setCompletingId(null)
    }
  }

  const displayed = tab === "upcoming" ? upcoming : completed

  useEffect(() => {
    if (status !== "loaded" || !targetAssignmentId) return
    document.getElementById(`assignment-${targetAssignmentId}`)?.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
    })
  }, [displayed, status, targetAssignmentId])

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-4">
        <h1 className="text-2xl font-black text-slate-900 font-display">My Chores</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {status === "loaded" ? `${upcoming.length} upcoming · ${completed.length} completed` : status === "loading" ? "Loading your chores…" : "Chore counts unavailable"}
        </p>

        <div className="flex gap-2 mt-4 bg-slate-100 p-1 rounded-xl">
          {(["upcoming", "completed"] as const).map((value) => {
            const isActive = tab === value
            const count = status === "loaded" ? (value === "upcoming" ? upcoming.length : completed.length) : "—"
            return (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn("flex-1 py-2 rounded-lg text-sm font-bold capitalize transition-all", isActive ? "bg-white text-teal-600 shadow-sm" : "text-slate-500")}
                type="button"
              >
                {value}
                <span className={cn("ml-1.5 text-xs px-1.5 py-0.5 rounded-full", isActive ? "bg-teal-50 text-teal-600" : "bg-slate-200 text-slate-500")}>{count}</span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-3">
        {status === "loading" && (
          <div aria-label="Loading my chores" className="space-y-3">
            {[0, 1, 2].map((item) => <div className="h-28 animate-pulse rounded-2xl bg-white" key={item} />)}
          </div>
        )}
        {status === "error" && (
          <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center">
            <p role="alert" className="text-sm text-slate-600">{error}</p>
            <button className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => void loadChores()} type="button">Try again</button>
          </div>
        )}
        {status === "loaded" && actionError && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p>}
        {status === "loaded" && displayed.length === 0 && (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
            <div className="text-4xl mb-3">{tab === "upcoming" ? "🎉" : "📋"}</div>
            <p className="font-bold text-slate-900">{tab === "upcoming" ? "All caught up!" : "Nothing completed yet"}</p>
            <p className="text-slate-400 text-sm mt-1">
              {tab === "upcoming" ? "No upcoming chores assigned to you" : "Completed chores will appear here"}
            </p>
          </div>
        )}
        {status === "loaded" && displayed.map((assignment) => (
          <div id={`assignment-${assignment.id}`} key={assignment.id}>
            <ServerAssignmentCard
              assignment={assignment}
              completing={completingId === assignment.id}
              currentUserId={state.currentUser.id}
              householdTimezone={household?.timezone ?? "UTC"}
              onComplete={(id) => void completeAssignment(id)}
            />
          </div>
        ))}
      </div>

      <BottomNav active="my-chores" navigate={navigate} />
    </div>
  )
}
