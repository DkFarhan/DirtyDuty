import type { AssignmentDTO, AssignmentStepItem } from "./chores"

/**
 * Checklists (E12) on cards: the "2 of 5 steps" chip, the tick sheet's rows, and the
 * "Mark done anyway?" check. Steps are a guide: they never block completing a chore.
 */

export type StepsChipView = {
  text: string
  /** Every step is ticked: the chip turns accent. */
  complete: boolean
  /** A to-do occurrence opens the tick sheet; a done one only shows its counts. */
  interactive: boolean
}

function stepWord(total: number) {
  return total === 1 ? "step" : "steps"
}

/** "2 of 5 steps" for a chore with a checklist, or null. */
export function stepsChip(assignment: AssignmentDTO): StepsChipView | null {
  const steps = assignment.steps
  if (!steps || steps.total <= 0) return null
  return {
    text: `${steps.ticked} of ${steps.total} ${stepWord(steps.total)}`,
    complete: steps.ticked >= steps.total,
    interactive: assignment.status === "PENDING" && steps.items !== null,
  }
}

/** How many steps are still unticked on an open occurrence (0 without a checklist). */
export function untickedSteps(assignment: AssignmentDTO): number {
  const steps = assignment.steps
  if (!steps || assignment.status !== "PENDING") return 0
  return Math.max(0, steps.total - steps.ticked)
}

/** "2 steps not ticked. Mark done anyway?" */
export function markDoneAnywayText(unticked: number) {
  return `${unticked} ${stepWord(unticked)} not ticked. Mark done anyway?`
}

/** The tick shown at once, before the server answers. */
export function optimisticTick(
  assignment: AssignmentDTO,
  stepId: string,
  ticked: boolean,
  viewer: { userId: string; displayName: string },
  now: Date = new Date(),
): AssignmentDTO {
  const steps = assignment.steps
  if (!steps?.items) return assignment
  const items = steps.items.map((item): AssignmentStepItem => {
    if (item.id !== stepId || item.ticked === ticked) return item
    return ticked
      ? { ...item, ticked: true, tickedBy: viewer, tickedAt: now.toISOString() }
      : { ...item, ticked: false, tickedBy: null, tickedAt: null }
  })
  return {
    ...assignment,
    steps: { ...steps, items, ticked: items.filter((item) => item.ticked).length },
  }
}

/** A step put back as it was before a failed tick, leaving the other steps as they are now. */
export function revertTick(
  current: AssignmentDTO,
  previous: AssignmentDTO,
  stepId: string,
): AssignmentDTO {
  const before = previous.steps?.items?.find((item) => item.id === stepId)
  const steps = current.steps
  if (!before || !steps?.items) return current
  const items = steps.items.map((item) => (item.id === stepId ? before : item))
  return {
    ...current,
    steps: { ...steps, items, ticked: items.filter((item) => item.ticked).length },
  }
}

/** Who ticked a step on a group chore and when: "Rubayet · 2:14 PM" ("You" for the viewer). */
export function tickedByLabel(
  item: AssignmentStepItem,
  viewerId: string,
  timeZone: string,
): string | null {
  if (!item.ticked || !item.tickedBy) return null
  const who = item.tickedBy.userId === viewerId ? "You" : item.tickedBy.displayName
  if (!item.tickedAt) return who
  let time: string
  try {
    time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(item.tickedAt))
  } catch {
    time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
      new Date(item.tickedAt),
    )
  }
  return `${who} · ${time}`
}

/** Who ticked shows wherever more than one person can tick: group chores and When needed. */
export function showsWhoTicked(assignment: AssignmentDTO) {
  return assignment.assignees.length > 1 || assignment.kind === "AS_NEEDED"
}
