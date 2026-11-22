import type { AssignmentDTO, HouseholdDashboard } from "./chores"

export function optimisticAssignmentCompletion(assignment: AssignmentDTO): AssignmentDTO {
  return {
    ...assignment,
    status: "COMPLETED",
    canComplete: false,
    overdue: false,
  }
}

export function updateDashboardAssignment(
  dashboard: HouseholdDashboard,
  assignment: AssignmentDTO,
): HouseholdDashboard {
  const replace = (items: AssignmentDTO[]) =>
    items.map((item) => (item.id === assignment.id ? assignment : item))
  return {
    ...dashboard,
    today: replace(dashboard.today),
    thisWeek: replace(dashboard.thisWeek),
    overdue: replace(dashboard.overdue),
    ...(dashboard.householdJobs ? { householdJobs: replace(dashboard.householdJobs) } : {}),
  }
}

/** Every occurrence on the dashboard, household jobs included. */
function allDashboardAssignments(dashboard: HouseholdDashboard) {
  return [
    dashboard.today,
    dashboard.thisWeek,
    dashboard.overdue,
    dashboard.householdJobs ?? [],
  ].flat()
}

function withWeekCounts(
  dashboard: HouseholdDashboard,
  completedDelta: number,
  totalDelta: number,
): HouseholdDashboard {
  const totalCount = Math.max(0, dashboard.weekSummary.totalCount + totalDelta)
  const completedCount = Math.min(
    totalCount,
    Math.max(0, dashboard.weekSummary.completedCount + completedDelta),
  )
  const personal = dashboard.personalWeek
  const personalAssigned = personal ? Math.max(0, personal.assignedCount + totalDelta) : 0
  return {
    ...dashboard,
    weekSummary: {
      ...dashboard.weekSummary,
      completedCount,
      totalCount,
      completionPercentage: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    },
    ...(personal
      ? {
          personalWeek: {
            assignedCount: personalAssigned,
            completedCount: Math.min(
              personalAssigned,
              Math.max(0, personal.completedCount + completedDelta),
            ),
          },
        }
      : {}),
  }
}

/**
 * Completes an occurrence on the dashboard before the server answers. The viewer is the one
 * completing it, and credit goes to the week it is done in: completed goes up by one for the
 * household and the viewer, and an occurrence not already in this week's list (a household job, or
 * one overdue from an earlier week) also joins the week's total and the viewer's assigned count.
 * The server's numbers replace these on the next load.
 */
export function optimisticallyCompleteDashboardAssignment(
  dashboard: HouseholdDashboard,
  assignmentId: string,
): {
  dashboard: HouseholdDashboard
  previous: AssignmentDTO
  incrementedWeekSummary: boolean
  addedToWeek: boolean
} | null {
  const previous = allDashboardAssignments(dashboard).find(
    (assignment) => assignment.id === assignmentId,
  )
  if (!previous || previous.status !== "PENDING" || !previous.canComplete) return null

  const addedToWeek = !dashboard.thisWeek.some((assignment) => assignment.id === assignmentId)
  const optimistic = optimisticAssignmentCompletion(previous)
  const next = updateDashboardAssignment(dashboard, optimistic)
  return {
    dashboard: withWeekCounts(next, 1, Number(addedToWeek)),
    previous,
    incrementedWeekSummary: true,
    addedToWeek,
  }
}

export function rollbackDashboardAssignmentCompletion(
  dashboard: HouseholdDashboard,
  previous: AssignmentDTO,
  incrementedWeekSummary: boolean,
  addedToWeek = false,
): HouseholdDashboard {
  const next = updateDashboardAssignment(dashboard, previous)
  if (!incrementedWeekSummary) return next
  return withWeekCounts(next, -1, -Number(addedToWeek))
}

function countsInWeekTotal(assignment: AssignmentDTO) {
  return assignment.status !== "CANCELLED" && assignment.status !== "SKIPPED"
}

/**
 * Swaps one occurrence in the dashboard (an optimistic change, the server's answer, or a rollback
 * when `next` is the previous value) and keeps the week totals in step: skipped work does not count.
 */
export function replaceDashboardOccurrence(
  dashboard: HouseholdDashboard,
  next: AssignmentDTO,
  current: AssignmentDTO,
  todayKey?: string,
  viewerId?: string,
): HouseholdDashboard {
  let replaced = updateDashboardAssignment(dashboard, next)
  if (todayKey) {
    // A move can bring an occurrence onto today or take it off; keep the Today list in step.
    const isToday = next.scheduledFor.slice(0, 10) === todayKey
    const listed = replaced.today.some((assignment) => assignment.id === next.id)
    if (isToday && !listed) replaced = { ...replaced, today: [...replaced.today, next] }
    if (!isToday && listed) {
      replaced = {
        ...replaced,
        today: replaced.today.filter((assignment) => assignment.id !== next.id),
      }
    }
  }
  if (!dashboard.thisWeek.some((assignment) => assignment.id === next.id)) return replaced
  const totalCount = Math.max(
    0,
    dashboard.weekSummary.totalCount +
      Number(countsInWeekTotal(next)) -
      Number(countsInWeekTotal(current)),
  )
  const completedCount = Math.min(
    totalCount,
    Math.max(
      0,
      dashboard.weekSummary.completedCount +
        Number(next.status === "COMPLETED") -
        Number(current.status === "COMPLETED"),
    ),
  )
  // The viewer's own assigned count follows a skip or restore of their occurrence.
  const personal = replaced.personalWeek
  const counts = (assignment: AssignmentDTO) =>
    countsInWeekTotal(assignment) &&
    assignment.assignees.some((assignee) => assignee.userId === viewerId)
  const personalAssigned =
    personal && viewerId
      ? Math.max(
          personal.completedCount,
          personal.assignedCount + Number(counts(next)) - Number(counts(current)),
        )
      : null
  return {
    ...replaced,
    weekSummary: {
      totalCount,
      completedCount,
      completionPercentage: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    },
    ...(personal && personalAssigned !== null
      ? { personalWeek: { ...personal, assignedCount: personalAssigned } }
      : {}),
  }
}

/** Finds an occurrence anywhere on the dashboard. */
export function findDashboardAssignment(dashboard: HouseholdDashboard | null, id: string) {
  if (!dashboard) return null
  return allDashboardAssignments(dashboard).find((assignment) => assignment.id === id) ?? null
}
