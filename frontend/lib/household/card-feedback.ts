import type { AssignmentDTO } from "./chores"

/**
 * The result of an action taken from one card (Done, I did it, Needs doing, move, skip, restore,
 * reassign), shown next to that card. An error stays until the next action; a confirmation
 * clears itself.
 */
/**
 * Which card an action came from. A flagged or overdue job is on Home twice (Needs attention and
 * Household jobs); its result shows only under the card that was pressed.
 */
export type CardSurface = "card" | "job"

export type CardFeedback = {
  surface: CardSurface
  assignmentId: string
  choreId: string
  message: string
  tone: "error" | "success"
}

export type CardFeedbackView = { message: string; tone: "error" | "success" }

/** How long a confirmation stays next to its card. */
export const CONFIRMATION_MS = 6_000

function isOpenCopy(assignment: Pick<AssignmentDTO, "kind">) {
  return assignment.kind === "AS_NEEDED" || assignment.kind === "AFTER_COMPLETION"
}

/**
 * Whether this card shows the feedback. "After it's done" and "When needed" chores replace their
 * open copy after a completion, so a message about the chore follows to its current open copy.
 */
export function cardFeedbackMatches(
  assignment: Pick<AssignmentDTO, "id" | "choreId" | "kind" | "status">,
  feedback: CardFeedback | null,
  surface: CardSurface,
) {
  if (!feedback || feedback.surface !== surface) return false
  if (assignment.id === feedback.assignmentId) return true
  return (
    isOpenCopy(assignment) &&
    assignment.status === "PENDING" &&
    assignment.choreId === feedback.choreId
  )
}

export function feedbackFor(
  assignment: Pick<AssignmentDTO, "id" | "choreId" | "kind" | "status">,
  feedback: CardFeedback | null,
  surface: CardSurface,
): CardFeedbackView | undefined {
  return feedback && cardFeedbackMatches(assignment, feedback, surface)
    ? { message: feedback.message, tone: feedback.tone }
    : undefined
}

/**
 * The page-level banner only carries an action error when no card on screen can show it (for
 * example, the card left the list).
 */
export function unplacedFeedbackError(
  shown: {
    surface: CardSurface
    assignments: Pick<AssignmentDTO, "id" | "choreId" | "kind" | "status">[]
  }[],
  feedback: CardFeedback | null,
) {
  if (!feedback || feedback.tone !== "error") return null
  return shown.some(({ surface, assignments }) =>
    assignments.some((assignment) => cardFeedbackMatches(assignment, feedback, surface)),
  )
    ? null
    : feedback.message
}

/** Feedback for the card of {@code assignment}. */
export function cardFeedback(
  assignment: Pick<AssignmentDTO, "id" | "choreId">,
  message: string,
  tone: CardFeedback["tone"] = "error",
  surface: CardSurface = "card",
): CardFeedback {
  return { surface, assignmentId: assignment.id, choreId: assignment.choreId, message, tone }
}

/** "Flagged. Sam has been told." after "Needs doing", or "Flagged." when it is the viewer's turn. */
export function flagConfirmation(flagged: AssignmentDTO, viewerId: string) {
  const turn = flagged.turn ?? flagged.assignees[0] ?? null
  return turn && turn.userId !== viewerId
    ? `Flagged. ${turn.displayName.trim() || "Whoever's turn it is"} has been told.`
    : "Flagged."
}
