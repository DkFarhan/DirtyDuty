import { categoryIcon as categoryEmoji, type AssignmentDTO } from "@/lib/household/chores"
import { cardRequestView } from "@/lib/household/requests"
import {
  feedbackFor,
  unplacedFeedbackError,
  type CardFeedback,
} from "@/lib/household/card-feedback"
import {
  categoryWithRepeat,
  householdJobView,
  isHouseholdJob,
} from "@/lib/household/household-jobs"
import { hasOccurrenceActions, movedFromLabel } from "@/lib/household/occurrence-actions"
import { awayNote } from "@/lib/household/away"
import { assignmentAssigneeNames, assignmentDate } from "../chore-card"
import type {
  MyChoreCompletedViewModel,
  MyChoreUpcomingViewModel,
  MyChoresViewModel,
  MyChoresViewStatus,
} from "./my-chores-screen-view"

export interface MyChoresApplicationViewModelInput {
  upcoming: AssignmentDTO[]
  completed: AssignmentDTO[]
  currentUserId: string
  householdTimezone: string
  householdId: string | null
  completingIds: ReadonlySet<string>
  /** "Needs doing" requests in flight, by assignment id. */
  flaggingIds?: ReadonlySet<string>
  /** The result of the last card action, shown under that card. */
  cardFeedback?: CardFeedback | null
  status: MyChoresViewStatus
  errorMessage: string | null
  refreshError: string | null
  actionError: string | null
}

function categoryIconFor(icon: string | null): MyChoreUpcomingViewModel["categoryIcon"] {
  switch (categoryEmoji(icon)) {
    case "🗑️":
    case "♻️":
    case "🚮":
      return 2
    case "🧺":
    case "🌀":
      return 3
    case "🍽️":
    case "🧽":
    case "🪣":
      return 4
    case "🛁":
    case "🫧":
      return 6
    case "🪴":
    case "🌳":
    case "🛒":
    case "🥕":
    case "🐶":
    case "🧸":
    case "🚗":
    case "🏠":
      return 5
    default:
      return 1
  }
}

function durationLabel(assignment: AssignmentDTO) {
  return assignment.estimatedMinutes !== null && assignment.estimatedMinutes > 0
    ? `About ${assignment.estimatedMinutes} min`
    : undefined
}

function mapUpcoming(
  assignment: AssignmentDTO,
  input: MyChoresApplicationViewModelInput,
): MyChoreUpcomingViewModel {
  return {
    id: assignment.id,
    title: assignment.title,
    category: categoryWithRepeat(assignment),
    dateLabel: assignmentDate(assignment, input.householdTimezone),
    durationLabel: durationLabel(assignment),
    assignedTo: assignmentAssigneeNames(assignment, input.currentUserId),
    categoryIcon: categoryIconFor(assignment.categoryIcon),
    priority: assignment.priority === "HIGH" || assignment.priority === "URGENT",
    overdue: assignment.status === "PENDING" && assignment.overdue,
    status: assignment.status,
    movedFrom: movedFromLabel(assignment),
    awayNote: awayNote(assignment, input.currentUserId),
    request: cardRequestView(assignment, input.currentUserId),
    hasActions: hasOccurrenceActions(assignment),
    canComplete:
      assignment.status === "PENDING" &&
      assignment.canComplete &&
      assignment.assignees.some((assignee) => assignee.userId === input.currentUserId),
    feedback: feedbackFor(assignment, input.cardFeedback ?? null, "card"),
  }
}

function mapCompleted(
  assignment: AssignmentDTO,
  input: MyChoresApplicationViewModelInput,
): MyChoreCompletedViewModel {
  const completing = input.completingIds.has(`${input.householdId}:${assignment.id}`)
  return {
    id: assignment.id,
    title: assignment.title,
    category: assignment.categoryName ?? "Chore",
    dateLabel: assignmentDate(assignment, input.householdTimezone),
    durationLabel: durationLabel(assignment),
    assignedTo: assignmentAssigneeNames(assignment, input.currentUserId),
    completedBy: assignment.completedByDisplayName ?? (completing ? "You" : "Household member"),
    completing,
  }
}

export function createMyChoresApplicationViewModel(
  input: MyChoresApplicationViewModelInput,
): MyChoresViewModel {
  // "When needed" jobs have their own list: everyone in the rotation sees them, flagged and
  // overdue ones for whoever's turn it is first.
  const jobAssignments = input.upcoming.filter(
    (assignment) => isHouseholdJob(assignment) && assignment.status === "PENDING",
  )
  const jobs = jobAssignments
    .map((assignment) => ({
      ...householdJobView(assignment, input.currentUserId, input.householdTimezone),
      feedback: feedbackFor(assignment, input.cardFeedback ?? null, "job"),
    }))
    .sort(
      (left, right) =>
        Number(right.yourTurn && (right.flagged || right.overdue)) -
        Number(left.yourTurn && (left.flagged || left.overdue)),
    )
  // My Chores lists what is still to do; a skipped day is not.
  const toDo = input.upcoming.filter(
    (assignment) => assignment.status !== "SKIPPED" && !isHouseholdJob(assignment),
  )
  const overdue = toDo.filter((assignment) => assignment.status === "PENDING" && assignment.overdue)
  const attentionAssignment = overdue[0]
  const upcoming = toDo.filter((assignment) => assignment.id !== attentionAssignment?.id)
  const completingIds = [...input.completingIds]
    .filter((key) => key.startsWith(`${input.householdId}:`))
    .map((key) => key.slice(`${input.householdId}:`.length))

  return {
    status: input.status,
    errorMessage: input.errorMessage ?? undefined,
    refreshError: input.refreshError ?? undefined,
    // A card action's result goes under its card; the banner only takes one no card can show.
    actionError:
      input.actionError ??
      unplacedFeedbackError(
        [
          { surface: "card", assignments: toDo },
          { surface: "job", assignments: jobAssignments },
        ],
        input.cardFeedback ?? null,
      ) ??
      undefined,
    attentionChore: attentionAssignment ? mapUpcoming(attentionAssignment, input) : null,
    upcomingChores: upcoming.map((assignment) => mapUpcoming(assignment, input)),
    householdJobs: jobs,
    flaggingIds: [...(input.flaggingIds ?? [])],
    completedChores: input.completed.map((assignment) => mapCompleted(assignment, input)),
    completedHeading: `${input.completed.length} ${
      input.completed.length === 1 ? "thing" : "things"
    }, taken care of.`,
    completingIds,
  }
}
