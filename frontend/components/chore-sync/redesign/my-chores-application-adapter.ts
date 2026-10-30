import { categoryIcon as categoryEmoji, type AssignmentDTO } from "@/lib/household/chores"
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
  status: MyChoresViewStatus
  errorMessage: string | null
  refreshError: string | null
  actionError: string | null
}

function categoryIconFor(icon: string | null): MyChoreUpcomingViewModel["categoryIcon"] {
  switch (categoryEmoji(icon)) {
    case "🗑️":
    case "♻️":
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
    case "🛒":
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
    category: assignment.categoryName ?? "Chore",
    dateLabel: assignmentDate(assignment, input.householdTimezone),
    durationLabel: durationLabel(assignment),
    assignedTo: assignmentAssigneeNames(assignment, input.currentUserId),
    categoryIcon: categoryIconFor(assignment.categoryIcon),
    priority: assignment.priority === "HIGH" || assignment.priority === "URGENT",
    overdue: assignment.status === "PENDING" && assignment.overdue,
    status: assignment.status,
    canComplete:
      assignment.status === "PENDING" &&
      assignment.canComplete &&
      assignment.assignees.some((assignee) => assignee.userId === input.currentUserId),
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
  const overdue = input.upcoming.filter(
    (assignment) => assignment.status === "PENDING" && assignment.overdue,
  )
  const attentionAssignment = overdue[0]
  const upcoming = input.upcoming.filter((assignment) => assignment.id !== attentionAssignment?.id)
  const completingIds = [...input.completingIds]
    .filter((key) => key.startsWith(`${input.householdId}:`))
    .map((key) => key.slice(`${input.householdId}:`.length))

  return {
    status: input.status,
    errorMessage: input.errorMessage ?? undefined,
    refreshError: input.refreshError ?? undefined,
    actionError: input.actionError ?? undefined,
    attentionChore: attentionAssignment ? mapUpcoming(attentionAssignment, input) : null,
    upcomingChores: upcoming.map((assignment) => mapUpcoming(assignment, input)),
    completedChores: input.completed.map((assignment) => mapCompleted(assignment, input)),
    completedHeading: `${input.completed.length} ${
      input.completed.length === 1 ? "thing" : "things"
    }, taken care of.`,
    completingIds,
  }
}
