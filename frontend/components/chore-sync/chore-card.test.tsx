// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "@/lib/household/chores"
import { assignmentAssigneeNames } from "./chore-card"

const assignment: AssignmentDTO = {
  id: "assignment-1",
  householdId: "household-1",
  choreId: "chore-1",
  categoryName: null,
  categoryIcon: null,
  title: "Clean kitchen",
  scheduledFor: "2026-10-25",
  dueAt: null,
  status: "PENDING",
  priority: "NORMAL",
  difficulty: 2,
  estimatedMinutes: null,
  assignees: [
    { userId: "member-1", displayName: "Farhan Habib" },
    { userId: "current-user", displayName: "Farhan Habib" },
    { userId: "member-2", displayName: "Alex" },
  ],
  canComplete: false,
  completedAt: null,
  completedByDisplayName: null,
  overdue: false,
}

describe("assignment assignee formatting", () => {
  it("shows the current user first by user ID while preserving other members' order", () => {
    expect(assignmentAssigneeNames(assignment, "current-user")).toBe("You, Farhan Habib, Alex")
  })

  it("describes assignments with no assignees", () => {
    expect(assignmentAssigneeNames({ ...assignment, assignees: [] }, "current-user")).toBe(
      "No assignee",
    )
  })
})
