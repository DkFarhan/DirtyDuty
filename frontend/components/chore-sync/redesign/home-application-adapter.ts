import type { AssignmentDTO, HouseholdDashboard } from "@/lib/household/chores"
import type { PushHealthState } from "@/lib/notifications/push-health"
import { assignmentAssigneeNames, assignmentDate, assignmentTime } from "../chore-card"
import {
  formatUpcomingDateLabel,
  getLocalDateKey,
  getUpcomingAssignments,
  getWeekSummaryMessage,
  getWeekSummaryState,
  groupAssignmentsByDate,
} from "../week-summary"
import type {
  HomeChoreViewModel,
  HomeScreenViewModel,
  HomeUpcomingGroupViewModel,
  HomeViewStatus,
} from "./home-screen-view"

export interface HomeApplicationViewModelInput {
  dashboard: HouseholdDashboard | null
  householdId: string | null
  householdName: string
  householdTimezone: string
  currentUserId: string
  displayName: string
  notificationCount: number
  status: HomeViewStatus
  errorMessage: string | null
  refreshError: string | null
  actionError: string | null
  notificationCountError: string | null
  completingIds: ReadonlySet<string>
  pushHealth: PushHealthState
  now?: Date
}

function greetingFor(timeZone: string, date: Date) {
  let hour = date.getHours()
  try {
    hour = Number(
      new Intl.DateTimeFormat("en", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone,
      })
        .formatToParts(date)
        .find((part) => part.type === "hour")?.value ?? hour,
    )
  } catch {
    // Keep the device-local hour when the household timezone is invalid.
  }
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
  return `${greeting},`
}

function dateLabelFor(timeZone: string, date: Date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(date)
  }
}

function pushNoticeFor(state: PushHealthState) {
  if (state.status !== "attention" || state.reason === "unsupported") return null
  const actionLabel =
    state.reason === "sync-required"
      ? "Sync this browser"
      : state.reason === "check-failed"
        ? "Retry check"
        : state.reason === "permission-denied"
          ? "View permission help"
          : "Restore notifications"
  const heading =
    state.reason === "permission-denied"
      ? "Notification permission is blocked"
      : state.reason === "check-failed"
        ? "Push status could not be checked"
        : "Notifications need attention"
  return { heading, message: state.message, actionLabel }
}

function mapChore(
  assignment: AssignmentDTO,
  input: HomeApplicationViewModelInput,
): HomeChoreViewModel {
  const operationKey = `${input.householdId}:${assignment.id}`
  return {
    id: assignment.id,
    title: assignment.title,
    category: assignment.categoryName ?? "Chore",
    scheduledLabel: assignmentDate(assignment, input.householdTimezone),
    durationLabel:
      assignment.estimatedMinutes !== null && assignment.estimatedMinutes > 0
        ? `About ${assignment.estimatedMinutes} min`
        : undefined,
    assignedTo: assignmentAssigneeNames(assignment, input.currentUserId),
    status: assignment.status,
    completedBy: assignment.completedByDisplayName,
    overdue: assignment.overdue && assignment.status === "PENDING",
    canComplete:
      assignment.status === "PENDING" &&
      assignment.canComplete &&
      assignment.assignees.some((assignee) => assignee.userId === input.currentUserId),
    completing: input.completingIds.has(operationKey),
  }
}

export function createHomeApplicationViewModel(
  input: HomeApplicationViewModelInput,
): HomeScreenViewModel {
  const dashboard = input.dashboard
  const summary = dashboard?.weekSummary
  const date = input.now ?? new Date()
  const dateKey = getLocalDateKey(date, input.householdTimezone)
  const week = dashboard?.thisWeek ?? []
  const today = dashboard?.today ?? []
  const overdueAssignments = (dashboard?.overdue ?? []).filter(
    (assignment) =>
      assignment.overdue &&
      assignment.assignees.some((assignee) => assignee.userId === input.currentUserId),
  )
  const overdueIds = new Set(overdueAssignments.map((assignment) => assignment.id))
  const personalWeek = week.filter((assignment) =>
    assignment.assignees.some((assignee) => assignee.userId === input.currentUserId),
  )
  const personalToday = today.filter((assignment) =>
    assignment.assignees.some((assignee) => assignee.userId === input.currentUserId),
  )
  const personalCounts = {
    assigned: personalWeek.length,
    completed: personalWeek.filter((assignment) => assignment.status === "COMPLETED").length,
    dueToday: personalToday.filter(
      (assignment) => assignment.status === "PENDING" && !assignment.overdue,
    ).length,
    overdue: overdueAssignments.length,
  }
  const personalState = getWeekSummaryState(personalCounts)
  const personalMessage = getWeekSummaryMessage(
    personalState,
    personalCounts,
    input.currentUserId,
    dateKey,
  )
  const todayForDisplay = today
    .filter((assignment) => !overdueIds.has(assignment.id))
    .sort((left, right) => {
      const priority = (status: AssignmentDTO["status"]) =>
        status === "PENDING" ? 0 : status === "COMPLETED" ? 2 : 1
      return priority(left.status) - priority(right.status)
    })
  const upcomingGroups: HomeUpcomingGroupViewModel[] = groupAssignmentsByDate(
    getUpcomingAssignments(week, today, dateKey),
  ).map((group) => ({
    dateLabel: formatUpcomingDateLabel(group.dateKey, dateKey),
    chores: group.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      category: assignment.categoryName ?? "Chore",
      timeLabel: assignmentTime(assignment, input.householdTimezone) ?? "",
    })),
  }))
  const overdueChores = overdueAssignments.map((assignment) => mapChore(assignment, input))

  return {
    status: input.status,
    errorMessage: input.errorMessage ?? undefined,
    refreshError: input.refreshError ?? undefined,
    actionError: input.actionError ?? undefined,
    notificationCountError: input.notificationCountError ?? undefined,
    pushNotice: pushNoticeFor(input.pushHealth),
    displayName: input.displayName,
    greeting: greetingFor(input.householdTimezone, date),
    dateLabel: dateLabelFor(input.householdTimezone, date),
    householdName: input.householdName,
    notificationCount: input.notificationCount,
    householdWeek: {
      completedCount: summary?.completedCount ?? 0,
      totalCount: summary?.totalCount ?? 0,
    },
    personalWeek: {
      title: personalMessage.title,
      message: personalMessage.body,
      completedCount: personalCounts.completed,
      assignedCount: personalCounts.assigned,
      dueTodayCount: personalCounts.dueToday,
      overdueCount: personalCounts.overdue,
    },
    attentionChore: overdueChores[0] ?? null,
    additionalAttentionChores: overdueChores.slice(1),
    todayChores: todayForDisplay.map((assignment) => mapChore(assignment, input)),
    upcomingDateLabel: upcomingGroups[0]?.dateLabel ?? "COMING UP THIS WEEK",
    upcomingChores: upcomingGroups.flatMap((group) => group.chores),
    upcomingGroups,
  }
}
