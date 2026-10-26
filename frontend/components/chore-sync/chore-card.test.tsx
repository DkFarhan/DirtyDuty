// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "@/lib/household/chores"
import { ServerAssignmentCard } from "./chore-card"

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

describe("assignment card assignees", () => {
  it("shows the current user first by user ID while preserving other members' order", () => {
    render(
      <ServerAssignmentCard
        assignment={assignment}
        currentUserId="current-user"
        householdTimezone="UTC"
      />,
    )

    expect(screen.getByText("Assigned to You, Farhan Habib, Alex")).toBeTruthy()
  })
})
