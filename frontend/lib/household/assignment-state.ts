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
