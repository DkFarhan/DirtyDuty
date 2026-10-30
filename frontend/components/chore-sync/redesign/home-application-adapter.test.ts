import { describe, expect, it } from "vitest"
import type { AssignmentDTO, HouseholdDashboard } from "@/lib/household/chores"
import { createHomeApplicationViewModel } from "./home-application-adapter"

const userId = "user-1"

function assignment(
  id: string,
  scheduledFor: string,
  overrides: Partial<AssignmentDTO> = {},
): AssignmentDTO {
  return {
    id,
    householdId: "household-1",
    choreId: `chore-${id}`,
    categoryName: "Kitchen",
    categoryIcon: "🍽️",
    title: `Chore ${id}`,
    scheduledFor,
    dueAt: `${scheduledFor.slice(0, 10)}T18:00:00Z`,
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 2,
    estimatedMinutes: 20,
    assignees: [{ userId, displayName: "Alex" }],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    ...overrides,
  }
}

const pushHealth = { status: "disabled", reason: null, message: null } as const

describe("Home application adapter", () => {
  it("maps real summaries, every overdue item, today statuses, and grouped future assignments", () => {
    const today = assignment("today", "2026-10-28T18:00:00Z")
    const completed = assignment("done", "2026-10-26T18:00:00Z", {
      status: "COMPLETED",
      canComplete: false,
      completedByDisplayName: "Alex",
    })
    const overdueA = assignment("late-a", "2026-10-25T18:00:00Z", { overdue: true })
    const overdueB = assignment("late-b", "2026-10-26T18:00:00Z", { overdue: true })
    const tomorrow = assignment("tomorrow", "2026-10-29T18:00:00Z")
    const friday = assignment("friday", "2026-10-30T18:00:00Z", {
      categoryName: "Trash",
      categoryIcon: "🗑️",
    })
    const dashboard: HouseholdDashboard = {
      weekSummary: { completedCount: 4, totalCount: 8, completionPercentage: 50 },
      today: [completed, today],
      thisWeek: [today, completed, overdueA, overdueB, tomorrow, friday],
      overdue: [overdueA, overdueB],
    }

    const viewModel = createHomeApplicationViewModel({
      dashboard,
      householdId: "household-1",
      householdName: "The Common Room",
      householdTimezone: "America/Sao_Paulo",
      currentUserId: userId,
      displayName: "Alex",
      notificationCount: 7,
      status: "loaded",
      errorMessage: null,
      refreshError: null,
      actionError: null,
      notificationCountError: null,
      completingIds: new Set(["household-1:today"]),
      pushHealth,
      now: new Date("2026-10-28T15:00:00Z"),
    })

    expect(viewModel.householdWeek).toEqual({ completedCount: 4, totalCount: 8 })
    expect(viewModel.personalWeek).toMatchObject({
      assignedCount: 6,
      completedCount: 1,
      dueTodayCount: 1,
      overdueCount: 2,
    })
    expect(viewModel.greeting).toBe("Good afternoon,")
    expect(viewModel.dateLabel).toBe("Wednesday, October 28")
    expect(viewModel.attentionChore?.id).toBe("late-a")
    expect(viewModel.additionalAttentionChores?.map(({ id }) => id)).toEqual(["late-b"])
    expect(viewModel.todayChores.map(({ id }) => id)).toEqual(["today", "done"])
    expect(viewModel.todayChores[0]).toMatchObject({ canComplete: true, completing: true })
    expect(viewModel.todayChores[1]).toMatchObject({
      status: "COMPLETED",
      canComplete: false,
      completedBy: "Alex",
    })
    expect(viewModel.upcomingGroups?.map((group) => group.chores.map(({ id }) => id))).toEqual([
      ["tomorrow"],
      ["friday"],
    ])
    expect(viewModel.notificationCount).toBe(7)
  })

  it("keeps unavailable dashboards empty and maps push actions without changing API state", () => {
    const viewModel = createHomeApplicationViewModel({
      dashboard: null,
      householdId: null,
      householdName: "Your household",
      householdTimezone: "UTC",
      currentUserId: userId,
      displayName: "Alex",
      notificationCount: 0,
      status: "error",
      errorMessage: "Dashboard unavailable.",
      refreshError: null,
      actionError: null,
      notificationCountError: null,
      completingIds: new Set(),
      pushHealth: {
        status: "attention",
        reason: "sync-required",
        message: "Sync this browser to restore reminders.",
      },
      now: new Date("2026-10-28T15:00:00Z"),
    })

    expect(viewModel.status).toBe("error")
    expect(viewModel.errorMessage).toBe("Dashboard unavailable.")
    expect(viewModel.householdWeek).toEqual({ completedCount: 0, totalCount: 0 })
    expect(viewModel.pushNotice).toMatchObject({
      heading: "Notifications need attention",
      actionLabel: "Sync this browser",
    })
  })

  it.each([
    {
      reason: "permission-denied",
      message: "Allow notifications in your browser settings, then check again.",
      heading: "Notification permission is blocked",
      actionLabel: "View permission help",
    },
    {
      reason: "check-failed",
      message: "Push health could not be checked right now.",
      heading: "Push status could not be checked",
      actionLabel: "Retry check",
    },
    {
      reason: "sync-required",
      message: "Sync this browser to restore reminders.",
      heading: "Notifications need attention",
      actionLabel: "Sync this browser",
    },
  ] as const)(
    "maps the $reason notification warning",
    ({ reason, message, heading, actionLabel }) => {
      const viewModel = createHomeApplicationViewModel({
        dashboard: null,
        householdId: null,
        householdName: "Your household",
        householdTimezone: "UTC",
        currentUserId: userId,
        displayName: "Alex",
        notificationCount: 0,
        status: "loaded",
        errorMessage: null,
        refreshError: null,
        actionError: null,
        notificationCountError: null,
        completingIds: new Set(),
        pushHealth: { status: "attention", reason, message },
        now: new Date("2026-10-28T15:00:00Z"),
      })

      expect(viewModel.pushNotice).toEqual({ heading, message, actionLabel })
    },
  )
})
