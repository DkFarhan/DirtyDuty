import { describe, expect, it } from "vitest"
import type { AssignmentDTO, HouseholdDashboard } from "./chores"
import {
  optimisticallyCompleteDashboardAssignment,
  replaceDashboardOccurrence,
  rollbackDashboardAssignmentCompletion,
  updateDashboardAssignment,
} from "./assignment-state"

function assignment(id: string): AssignmentDTO {
  return {
    id,
    householdId: "household-1",
    choreId: `chore-${id}`,
    categoryName: "Kitchen",
    categoryIcon: null,
    title: `Chore ${id}`,
    scheduledFor: "2026-10-22T18:00:00Z",
    dueAt: "2026-10-22T18:00:00Z",
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 2,
    estimatedMinutes: 15,
    assignees: [
      { userId: "user-1", displayName: "Member One" },
      { userId: "user-2", displayName: "Member Two" },
    ],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: true,
  }
}

function dashboard(assignments: AssignmentDTO[]): HouseholdDashboard {
  return {
    weekSummary: {
      completedCount: 0,
      totalCount: assignments.length,
      completionPercentage: 0,
    },
    today: assignments,
    thisWeek: assignments,
    overdue: assignments,
  }
}

describe("optimistic assignment state", () => {
  it("removes an overdue assignment from overdue counts and updates weekly progress", () => {
    const before = dashboard([assignment("one")])
    const result = optimisticallyCompleteDashboardAssignment(before, "one")

    expect(result).not.toBeNull()
    expect(result?.dashboard.today[0]).toMatchObject({
      status: "COMPLETED",
      canComplete: false,
      overdue: false,
    })
    expect(result?.dashboard.overdue[0].overdue).toBe(false)
    expect(result?.dashboard.weekSummary).toMatchObject({
      completedCount: 1,
      completionPercentage: 100,
    })
    expect(result?.previous.overdue).toBe(true)
  })

  it("rolls back one failed concurrent completion without restoring stale counts", () => {
    const before = dashboard([assignment("one"), assignment("two")])
    const first = optimisticallyCompleteDashboardAssignment(before, "one")
    if (!first) throw new Error("Expected the first assignment to be eligible.")
    const second = optimisticallyCompleteDashboardAssignment(first.dashboard, "two")
    if (!second) throw new Error("Expected the second assignment to be eligible.")

    const rolledBack = rollbackDashboardAssignmentCompletion(
      second.dashboard,
      first.previous,
      first.incrementedWeekSummary,
    )
    expect(rolledBack.today.find(({ id }) => id === "one")).toMatchObject({
      status: "PENDING",
      overdue: true,
    })
    expect(rolledBack.today.find(({ id }) => id === "two")).toMatchObject({
      status: "COMPLETED",
      overdue: false,
    })
    expect(rolledBack.weekSummary).toMatchObject({
      completedCount: 1,
      completionPercentage: 50,
    })
  })

  it("reconciles optimistic fields with the authoritative server assignment", () => {
    const before = dashboard([assignment("one")])
    const optimistic = optimisticallyCompleteDashboardAssignment(before, "one")
    if (!optimistic) throw new Error("Expected the assignment to be eligible.")
    const confirmed: AssignmentDTO = {
      ...assignment("one"),
      status: "COMPLETED",
      canComplete: false,
      overdue: false,
      completedAt: "2026-10-23T12:00:00Z",
      completedByDisplayName: "Member Two",
    }

    const reconciled = updateDashboardAssignment(optimistic.dashboard, confirmed)
    expect(reconciled.today[0]).toEqual(confirmed)
    expect(reconciled.overdue[0]).toEqual(confirmed)
    expect(reconciled.weekSummary).toEqual(optimistic.dashboard.weekSummary)
  })

  it("credits the week for work done outside this week's list and rolls it back", () => {
    // A household job (not in this week's list) completed today joins the week for the completer.
    const job: AssignmentDTO = { ...assignment("job"), overdue: false }
    const before: HouseholdDashboard = {
      weekSummary: { completedCount: 1, totalCount: 2, completionPercentage: 50 },
      personalWeek: { assignedCount: 2, completedCount: 1 },
      today: [],
      thisWeek: [],
      overdue: [],
      householdJobs: [job],
    }
    const result = optimisticallyCompleteDashboardAssignment(before, "job")
    if (!result) throw new Error("Expected the job to be eligible.")
    expect(result.addedToWeek).toBe(true)
    expect(result.dashboard.weekSummary).toMatchObject({ completedCount: 2, totalCount: 3 })
    expect(result.dashboard.personalWeek).toEqual({ assignedCount: 3, completedCount: 2 })

    const rolledBack = rollbackDashboardAssignmentCompletion(
      result.dashboard,
      result.previous,
      result.incrementedWeekSummary,
      result.addedToWeek,
    )
    expect(rolledBack.weekSummary).toMatchObject({ completedCount: 1, totalCount: 2 })
    expect(rolledBack.personalWeek).toEqual({ assignedCount: 2, completedCount: 1 })
  })

  it("keeps a planned occurrence's week total and the viewer's assigned count when completed", () => {
    const before: HouseholdDashboard = {
      ...dashboard([assignment("one")]),
      personalWeek: { assignedCount: 1, completedCount: 0 },
    }
    const result = optimisticallyCompleteDashboardAssignment(before, "one")
    expect(result?.addedToWeek).toBe(false)
    expect(result?.dashboard.weekSummary).toMatchObject({ completedCount: 1, totalCount: 1 })
    expect(result?.dashboard.personalWeek).toEqual({ assignedCount: 1, completedCount: 1 })
  })

  it("drops a skipped occurrence from the viewer's assigned count", () => {
    const one = { ...assignment("one"), overdue: false }
    const before: HouseholdDashboard = {
      ...dashboard([one]),
      personalWeek: { assignedCount: 1, completedCount: 0 },
    }
    const skipped: AssignmentDTO = { ...one, status: "SKIPPED" }
    const mine = replaceDashboardOccurrence(before, skipped, one, undefined, "user-1")
    expect(mine.personalWeek).toEqual({ assignedCount: 0, completedCount: 0 })
    const someoneElse = replaceDashboardOccurrence(before, skipped, one, undefined, "user-9")
    expect(someoneElse.personalWeek).toEqual({ assignedCount: 1, completedCount: 0 })
  })
})
