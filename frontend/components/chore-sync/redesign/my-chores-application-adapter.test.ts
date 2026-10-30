import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "@/lib/household/chores"
import { createMyChoresApplicationViewModel } from "./my-chores-application-adapter"

function assignment(id: string, overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return {
    id,
    householdId: "household-1",
    choreId: `chore-${id}`,
    categoryName: "Kitchen",
    categoryIcon: "🍽️",
    title: `Chore ${id}`,
    scheduledFor: "2026-10-28T18:00:00Z",
    dueAt: "2026-10-28T18:00:00Z",
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 2,
    estimatedMinutes: 20,
    assignees: [
      { userId: "user-1", displayName: "Alex" },
      { userId: "user-2", displayName: "Sam" },
    ],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    ...overrides,
  }
}

describe("My Chores application adapter", () => {
  it("maps server assignments, category data, real metadata, permissions, and pending completion", () => {
    const overdue = assignment("overdue", { overdue: true, categoryIcon: "Bathroom" })
    const denied = assignment("denied", {
      canComplete: false,
      categoryIcon: "Laundry",
      priority: "URGENT",
    })
    const cancelled = assignment("cancelled", {
      status: "CANCELLED",
      canComplete: true,
    })
    const completed = assignment("completed", {
      status: "COMPLETED",
      canComplete: false,
      completedByDisplayName: "Sam",
    })

    const viewModel = createMyChoresApplicationViewModel({
      upcoming: [overdue, denied, cancelled],
      completed: [completed],
      currentUserId: "user-1",
      householdTimezone: "America/Sao_Paulo",
      householdId: "household-1",
      completingIds: new Set(["household-1:completed"]),
      status: "loaded",
      errorMessage: null,
      refreshError: null,
      actionError: "Unable to complete.",
    })

    expect(viewModel.attentionChore).toMatchObject({
      id: "overdue",
      overdue: true,
      categoryIcon: 6,
      canComplete: true,
    })
    expect(viewModel.upcomingChores).toMatchObject([
      { id: "denied", categoryIcon: 3, priority: true, canComplete: false },
      { id: "cancelled", status: "CANCELLED", canComplete: false },
    ])
    expect(viewModel.completedChores[0]).toMatchObject({
      id: "completed",
      assignedTo: "You, Sam",
      completedBy: "Sam",
      completing: true,
    })
    expect(viewModel.completedHeading).toBe("1 thing, taken care of.")
    expect(viewModel.actionError).toBe("Unable to complete.")
    expect(viewModel.completingIds).toEqual(["completed"])
  })
})
