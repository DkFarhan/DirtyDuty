"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { optimisticAssignmentCompletion } from "@/lib/household/assignment-state"
import {
  cardFeedback,
  CONFIRMATION_MS,
  flagConfirmation,
  type CardFeedback,
  type CardSurface,
} from "@/lib/household/card-feedback"
import {
  flagErrorWording,
  isHouseholdJob,
  optimisticFlag,
  replaceJob,
} from "@/lib/household/household-jobs"
import {
  optimisticOccurrence,
  runOccurrenceAction,
  type OccurrenceAction,
} from "@/lib/household/occurrence-actions"
import { OccurrenceActionSheet } from "../occurrence-action-sheet"
import { useChoreSteps } from "../use-chore-steps"
import { useStartWithBasics } from "../use-start-with-basics"
import { RequestsCard } from "../requests/requests-card"
import { useChoreRequests } from "../requests/use-chore-requests"
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
  const [cardFeedbackState, setCardFeedback] = useState<CardFeedback | null>(null)
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set())
  const [flaggingIds, setFlaggingIds] = useState<Set<string>>(() => new Set())
  const [targetAssignmentId, setTargetAssignmentId] = useState<string | null>(null)
  const [actionTargetId, setActionTargetId] = useState<string | null>(null)
  const [actionSurface, setActionSurface] = useState<CardSurface>("card")
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
  const [hasChores, setHasChores] = useState<boolean | null>(null)
  const basics = useStartWithBasics("my-chores")

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
      const [nextUpcoming, nextCompleted, choreStatus] = await Promise.all([
        choreApi.myChores(household.id, "UPCOMING"),
        choreApi.myChores(household.id, "COMPLETED"),
        // Only decides whether "Start with the basics" shows; never blocks the list.
        choreApi.status(household.id).catch(() => null),
      ])
      if (requestId !== requestSequence.current) return
      setHasChores(choreStatus ? choreStatus.hasChores : null)
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

  const completeAssignment = async (assignmentId: string, surface: CardSurface = "card") => {
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
    setCardFeedback(null)
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
        setCardFeedback(
          cardFeedback(
            previous,
            cause instanceof ApiError
              ? cause.message
              : "Unable to complete this chore. Please try again.",
            "error",
            surface,
          ),
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
  const performOccurrenceAction = async (
    assignmentId: string,
    action: OccurrenceAction,
    surface: CardSurface = "card",
  ) => {
    if (!household || loadedHouseholdId.current !== household.id) return
    const operation = `occurrence:${assignmentId}`
    const index = upcomingRef.current.findIndex((assignment) => assignment.id === assignmentId)
    const previous = upcomingRef.current[index]
    if (!previous || !claim(operation)) return
    const viewerId = state.currentUser.id
    // A household job stays listed for everyone in its rotation, whoever's turn it is.
    const stillListed = (assignment: AssignmentDTO) =>
      assignment.status !== "SKIPPED" &&
      (isHouseholdJob(assignment) ||
        assignment.assignees.some((assignee) => assignee.userId === viewerId))
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
    setCardFeedback(null)
    try {
      const confirmed = await runOccurrenceAction(household.id, assignmentId, action)
      requestSequence.current += 1
      apply(confirmed, index)
      invalidate()
    } catch (cause) {
      requestSequence.current += 1
      apply(previous, index)
      if (loadedHouseholdId.current === household.id) {
        setCardFeedback(
          cardFeedback(
            previous,
            cause instanceof ApiError
              ? cause.message
              : "Unable to update this chore. Please try again.",
            "error",
            surface,
          ),
        )
      }
      invalidate()
    } finally {
      release(operation)
    }
  }
  /** "Needs doing": shows the flag at once, then the server's answer, or rolls back with its message. */
  const flagAssignment = async (assignmentId: string) => {
    if (!household || loadedHouseholdId.current !== household.id) return
    const operation = `flag:${assignmentId}`
    const previous = upcomingRef.current.find((assignment) => assignment.id === assignmentId)
    if (!previous || !claim(operation)) return
    const apply = (next: AssignmentDTO) => {
      if (loadedHouseholdId.current !== household.id) return
      upcomingRef.current = replaceJob(upcomingRef.current, next)
      setUpcoming(upcomingRef.current)
    }
    requestSequence.current += 1
    apply(
      optimisticFlag(previous, {
        userId: state.currentUser.id,
        displayName: state.currentUser.name,
      }),
    )
    setFlaggingIds((current) => new Set(current).add(assignmentId))
    setCardFeedback(null)
    try {
      const confirmed = await choreApi.flag(household.id, assignmentId)
      requestSequence.current += 1
      apply(confirmed)
      setCardFeedback(
        cardFeedback(
          confirmed,
          flagConfirmation(confirmed, state.currentUser.id),
          "success",
          "job",
        ),
      )
      invalidate()
    } catch (cause) {
      requestSequence.current += 1
      apply(previous)
      if (loadedHouseholdId.current === household.id) {
        setCardFeedback(
          cardFeedback(
            previous,
            cause instanceof ApiError
              ? flagErrorWording(cause.message)
              : "Unable to flag this job. Please try again.",
            "error",
            "job",
          ),
        )
      }
      invalidate()
    } finally {
      release(operation)
      setFlaggingIds((current) => {
        const next = new Set(current)
        next.delete(assignmentId)
        return next
      })
    }
  }
  // Confirmations clear themselves; errors stay until the next action.
  useEffect(() => {
    if (cardFeedbackState?.tone !== "success") return
    const timer = window.setTimeout(() => setCardFeedback(null), CONFIRMATION_MS)
    return () => window.clearTimeout(timer)
  }, [cardFeedbackState])

  const actionTarget = upcoming.find((assignment) => assignment.id === actionTargetId) ?? null

  // Checklists (E12): the tick sheet, and "Mark done anyway?" before completing with steps left.
  const choreSteps = useChoreSteps({
    householdId: household?.id ?? null,
    householdTimezone: household?.timezone ?? "UTC",
    viewer: { userId: state.currentUser.id, displayName: state.currentUser.name },
    theme: theme === "dark" ? "dark" : "light",
    find: (id) =>
      upcomingRef.current.find((assignment) => assignment.id === id) ??
      completedRef.current.find((assignment) => assignment.id === id) ??
      null,
    apply: (next) => {
      if (!upcomingRef.current.some((assignment) => assignment.id === next.id)) return
      requestSequence.current += 1
      upcomingRef.current = upcomingRef.current.map((assignment) =>
        assignment.id === next.id ? next : assignment,
      )
      setUpcoming(upcomingRef.current)
    },
    complete: (id, surface) => void completeAssignment(id, surface),
    isCompleting: (id) => (household ? completingIds.has(`${household.id}:${id}`) : false),
  })

  // Hand-off and swap requests (E11): the card at the top, and Cancel request on my own cards.
  const requests = useChoreRequests(household?.id ?? null, household?.timezone ?? "UTC")
  const cancelRequest = async (requestId: string, choreId: string, surface: CardSurface) => {
    const assignment = upcomingRef.current.find((item) => item.id === choreId)
    const failure = await requests.cancel(requestId)
    if (assignment) {
      setCardFeedback(
        cardFeedback(
          assignment,
          failure ?? "Request cancelled. It's still yours.",
          failure ? "error" : "success",
          surface,
        ),
      )
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

  const viewModel = createMyChoresApplicationViewModel({
    hasChores,
    basics: { canManage: basics.canManage, adding: basics.adding, error: basics.error },
    upcoming,
    completed,
    currentUserId: state.currentUser.id,
    householdTimezone: household?.timezone ?? "UTC",
    householdId: household?.id ?? null,
    completingIds,
    flaggingIds,
    status: visibleStatus,
    errorMessage: error,
    refreshError,
    actionError: null,
    cardFeedback: cardFeedbackState,
  })
  const onNavigate = (destination: HomeNavigationDestination) =>
    navigate(destination === "home" ? "dashboard" : destination)
  return (
    <>
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={(id, surface) => choreSteps.requestComplete(id, surface)}
        onOpenSteps={(id, surface) => choreSteps.openSteps(id, surface)}
        onOpenChoreActions={(id, surface = "card") => {
          setActionSurface(surface)
          setActionTargetId(id)
        }}
        onFlagJob={(id) => void flagAssignment(id)}
        onCancelRequest={(requestId, choreId) => void cancelRequest(requestId, choreId, "card")}
        requestsSection={
          <RequestsCard
            busyId={requests.busyId}
            feedback={requests.feedback}
            items={requests.items}
            onAccept={requests.accept}
            onDecline={requests.decline}
            theme={theme === "dark" ? "dark" : "light"}
          />
        }
        onNavigate={onNavigate}
        onRetry={() => void loadChores()}
        onAddBasics={() => void basics.add()}
        onMakeOwnChore={basics.makeOwn}
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
          onOpenSteps={() => {
            const target = actionTarget.id
            setActionTargetId(null)
            choreSteps.openSteps(target, actionSurface)
          }}
          onSubmit={(action) => {
            const target = actionTarget.id
            setActionTargetId(null)
            void performOccurrenceAction(target, action, actionSurface)
          }}
          onRequestSent={(_, message) => {
            setActionTargetId(null)
            setCardFeedback(cardFeedback(actionTarget, message, "success", actionSurface))
            requests.invalidate()
          }}
          onCancelRequest={(requestId) => {
            const target = actionTarget.id
            setActionTargetId(null)
            void cancelRequest(requestId, target, actionSurface)
          }}
          theme={theme}
        />
      )}
      {choreSteps.elements}
    </>
  )
}
