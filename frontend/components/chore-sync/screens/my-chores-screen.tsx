"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { optimisticAssignmentCompletion } from "@/lib/household/assignment-state"
import {
  optimisticOccurrence,
  runOccurrenceAction,
  type OccurrenceAction,
} from "@/lib/household/occurrence-actions"
import { OccurrenceActionSheet } from "../occurrence-action-sheet"
import { MyChoresScreenView, type MyChoresTab } from "../redesign/my-chores-screen-view"
import { createMyChoresApplicationViewModel } from "../redesign/my-chores-application-adapter"
import type { HomeNavigationDestination, HomeVisualTheme } from "../redesign/home-screen-view"

export function MyChoresScreen({ theme = "dark" }: { theme?: HomeVisualTheme } = {}) {
  const { state, navigate } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const [tab, setTab] = useState<MyChoresTab>("upcoming")
  const [upcoming, setUpcoming] = useState<AssignmentDTO[]>([])
  const [completed, setCompleted] = useState<AssignmentDTO[]>([])
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set())
  const [targetAssignmentId, setTargetAssignmentId] = useState<string | null>(null)
  const [actionTargetId, setActionTargetId] = useState<string | null>(null)
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

  /**
   * Moves, skips or reassigns one occurrence optimistically. A skipped day, or one given to
   * someone else, leaves this to-do list; a failure puts it back where it was with an error.
   */
  const performOccurrenceAction = async (assignmentId: string, action: OccurrenceAction) => {
    if (!household || loadedHouseholdId.current !== household.id) return
    const operation = `occurrence:${assignmentId}`
    const index = upcomingRef.current.findIndex((assignment) => assignment.id === assignmentId)
    const previous = upcomingRef.current[index]
    if (!previous || !claim(operation)) return
    const viewerId = state.currentUser.id
    const stillListed = (assignment: AssignmentDTO) =>
      assignment.status !== "SKIPPED" &&
      assignment.assignees.some((assignee) => assignee.userId === viewerId)
    const apply = (next: AssignmentDTO, fallbackIndex: number) => {
      if (loadedHouseholdId.current !== household.id) return
      const without = upcomingRef.current.filter((assignment) => assignment.id !== assignmentId)
      const list = stillListed(next)
        ? [
            ...without.slice(0, Math.min(fallbackIndex, without.length)),
            next,
            ...without.slice(Math.min(fallbackIndex, without.length)),
          ]
        : without
      upcomingRef.current = list
      setUpcoming(list)
    }
    requestSequence.current += 1
    apply(optimisticOccurrence(previous, action, household.timezone, viewerId), index)
    setActionError(null)
    try {
      const confirmed = await runOccurrenceAction(household.id, assignmentId, action)
      requestSequence.current += 1
      apply(confirmed, index)
      invalidate()
    } catch (cause) {
      requestSequence.current += 1
      apply(previous, index)
      if (loadedHouseholdId.current === household.id) {
        setActionError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to update this chore. Please try again.",
        )
      }
      invalidate()
    } finally {
      release(operation)
    }
  }
  const actionTarget = upcoming.find((assignment) => assignment.id === actionTargetId) ?? null

  const displayed = tab === "upcoming" ? upcoming : completed

  useEffect(() => {
    if (visibleStatus !== "loaded" || !targetAssignmentId) return
    document.getElementById(`assignment-${targetAssignmentId}`)?.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
    })
  }, [displayed, targetAssignmentId, visibleStatus])

  const viewModel = createMyChoresApplicationViewModel({
    upcoming,
    completed,
    currentUserId: state.currentUser.id,
    householdTimezone: household?.timezone ?? "UTC",
    householdId: household?.id ?? null,
    completingIds,
    status: visibleStatus,
    errorMessage: error,
    refreshError,
    actionError,
  })
  const onNavigate = (destination: HomeNavigationDestination) =>
    navigate(destination === "home" ? "dashboard" : destination)
  return (
    <>
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={(id) => void completeAssignment(id)}
        onOpenChoreActions={setActionTargetId}
        onNavigate={onNavigate}
        onRetry={() => void loadChores()}
        onSelectTab={setTab}
        tab={tab}
        theme={theme}
        viewModel={viewModel}
      />
      {household && actionTarget && (
        <OccurrenceActionSheet
          assignment={actionTarget}
          householdId={household.id}
          householdTimezone={household.timezone}
          viewerId={state.currentUser.id}
          onClose={() => setActionTargetId(null)}
          onSubmit={(action) => {
            const target = actionTarget.id
            setActionTargetId(null)
            void performOccurrenceAction(target, action)
          }}
          theme={theme}
        />
      )}
    </>
  )
}
