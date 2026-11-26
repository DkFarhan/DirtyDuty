"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import type { CardSurface } from "@/lib/household/card-feedback"
import { optimisticTick, revertTick, untickedSteps } from "@/lib/household/steps"
import { MarkDoneAnywayDialog, StepsSheet } from "./steps-sheet"

type Target = { id: string; surface: CardSurface }

/**
 * Checklists (E12) for a screen of chore cards: the tick sheet, optimistic ticks with an inline
 * error, and "I did it", which asks "N steps not ticked. Mark done anyway?" once when some steps
 * are unticked and completes straight away otherwise. The screen keeps its own list of
 * occurrences; {@link find} reads it and {@link apply} replaces one occurrence in it.
 */
export function useChoreSteps({
  householdId,
  householdTimezone,
  viewer,
  theme,
  find,
  apply,
  complete,
  isCompleting,
}: {
  householdId: string | null
  householdTimezone: string
  viewer: { userId: string; displayName: string }
  theme: "dark" | "light"
  find: (assignmentId: string) => AssignmentDTO | null
  apply: (next: AssignmentDTO) => void
  complete: (assignmentId: string, surface: CardSurface) => void
  isCompleting: (assignmentId: string) => boolean
}) {
  const [sheet, setSheet] = useState<Target | null>(null)
  const [confirm, setConfirm] = useState<(Target & { unticked: number }) | null>(null)
  const [error, setError] = useState<{ stepId: string; message: string } | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  /** Ticks in flight on the open sheet's occurrence: step id to the state asked for. */
  const pending = useRef(new Map<string, boolean>())

  const openSteps = useCallback((assignmentId: string, surface: CardSurface = "card") => {
    setError(null)
    setSheet({ id: assignmentId, surface })
  }, [])

  /** Every completion goes through here: it asks first only when steps are left unticked. */
  const requestComplete = useCallback(
    (assignmentId: string, surface: CardSurface = "card") => {
      const assignment = find(assignmentId)
      const unticked = assignment ? untickedSteps(assignment) : 0
      if (unticked > 0) {
        setConfirm({ id: assignmentId, surface, unticked })
        return
      }
      complete(assignmentId, surface)
    },
    [complete, find],
  )

  const tick = async (assignmentId: string, stepId: string, ticked: boolean) => {
    const previous = find(assignmentId)
    if (!householdId || !previous) return
    setError(null)
    pending.current.set(stepId, ticked)
    setPendingIds(new Set(pending.current.keys()))
    apply(optimisticTick(previous, stepId, ticked, viewer))
    try {
      let confirmed = await choreApi.tickStep(householdId, assignmentId, stepId, ticked)
      pending.current.delete(stepId)
      // Other ticks still on their way stay as the user left them.
      for (const [otherId, otherTicked] of pending.current) {
        confirmed = optimisticTick(confirmed, otherId, otherTicked, viewer)
      }
      apply(confirmed)
    } catch (cause) {
      pending.current.delete(stepId)
      const current = find(assignmentId)
      if (current) apply(revertTick(current, previous, stepId))
      setError({
        stepId,
        message:
          cause instanceof ApiError ? cause.message : "Couldn't save that tick. Please try again.",
      })
    } finally {
      setPendingIds(new Set(pending.current.keys()))
    }
  }

  const sheetAssignment = sheet ? find(sheet.id) : null
  let elements: ReactNode = null
  if (sheet && sheetAssignment) {
    elements = (
      <StepsSheet
        assignment={sheetAssignment}
        completing={isCompleting(sheet.id)}
        error={error}
        householdTimezone={householdTimezone}
        onClose={() => setSheet(null)}
        onComplete={() => {
          const target = sheet
          setSheet(null)
          requestComplete(target.id, target.surface)
        }}
        onTick={(stepId, ticked) => void tick(sheet.id, stepId, ticked)}
        pendingStepIds={pendingIds}
        theme={theme}
        viewerId={viewer.userId}
      />
    )
  }
  if (confirm) {
    elements = (
      <>
        {elements}
        <MarkDoneAnywayDialog
          assignmentId={confirm.id}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const target = confirm
            setConfirm(null)
            complete(target.id, target.surface)
          }}
          theme={theme}
          unticked={confirm.unticked}
        />
      </>
    )
  }
  return { openSteps, requestComplete, elements }
}
