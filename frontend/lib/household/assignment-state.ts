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
  }
}

export function optimisticallyCompleteDashboardAssignment(
  dashboard: HouseholdDashboard,
  assignmentId: string,
): {
  dashboard: HouseholdDashboard
  previous: AssignmentDTO
  incrementedWeekSummary: boolean
} | null {
  const previous = [dashboard.today, dashboard.thisWeek, dashboard.overdue]
    .flat()
    .find((assignment) => assignment.id === assignmentId)
  if (!previous || previous.status !== "PENDING" || !previous.canComplete) return null

  const incrementedWeekSummary =
    dashboard.weekSummary.completedCount < dashboard.weekSummary.totalCount &&
    dashboard.thisWeek.some((assignment) => assignment.id === assignmentId)
  const optimistic = optimisticAssignmentCompletion(previous)
  const next = updateDashboardAssignment(dashboard, optimistic)
  if (!incrementedWeekSummary) return { dashboard: next, previous, incrementedWeekSummary }

  const completedCount = Math.min(
    dashboard.weekSummary.totalCount,
    dashboard.weekSummary.completedCount + 1,
  )
  return {
    dashboard: {
      ...next,
      weekSummary: {
        ...dashboard.weekSummary,
        completedCount,
        completionPercentage:
          dashboard.weekSummary.totalCount === 0
            ? 0
            : Math.round((completedCount / dashboard.weekSummary.totalCount) * 100),
      },
    },
    previous,
    incrementedWeekSummary,
  }
}

export function rollbackDashboardAssignmentCompletion(
  dashboard: HouseholdDashboard,
  previous: AssignmentDTO,
  incrementedWeekSummary: boolean,
): HouseholdDashboard {
  const next = updateDashboardAssignment(dashboard, previous)
  if (!incrementedWeekSummary) return next

  const completedCount = Math.max(0, dashboard.weekSummary.completedCount - 1)
  return {
    ...next,
    weekSummary: {
      ...dashboard.weekSummary,
      completedCount,
      completionPercentage:
        dashboard.weekSummary.totalCount === 0
          ? 0
          : Math.round((completedCount / dashboard.weekSummary.totalCount) * 100),
    },
  }
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
  return {
    ...replaced,
    weekSummary: {
      totalCount,
      completedCount,
      completionPercentage: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    },
  }
}

/** Finds an occurrence anywhere on the dashboard. */
export function findDashboardAssignment(dashboard: HouseholdDashboard | null, id: string) {
  if (!dashboard) return null
  return (
    [dashboard.today, dashboard.thisWeek, dashboard.overdue]
      .flat()
      .find((assignment) => assignment.id === id) ?? null
  )
}
