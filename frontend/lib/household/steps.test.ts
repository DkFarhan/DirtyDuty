import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "./chores"
import {
  markDoneAnywayText,
  optimisticTick,
  revertTick,
  showsWhoTicked,
  stepsChip,
  tickedByLabel,
  untickedSteps,
} from "./steps"

const item = (id: string, ticked = false) => ({
  id,
  text: `Step ${id}`,
  ticked,
  tickedBy: ticked ? { userId: "user-2", displayName: "Rubayet" } : null,
  tickedAt: ticked ? "2026-11-14T18:14:00Z" : null,
})

function assignment(overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return {
    id: "a-1",
    householdId: "home-1",
    choreId: "chore-1",
    categoryName: "Bathroom",
    categoryIcon: null,
    title: "Clean bathroom",
    scheduledFor: "2026-11-14",
    dueAt: "2026-11-14T22:00:00Z",
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 3,
    estimatedMinutes: null,
    assignees: [{ userId: "user-1", displayName: "Farhan" }],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    steps: {
      total: 5,
      ticked: 2,
      canTick: true,
      items: [item("1", true), item("2", true), item("3"), item("4"), item("5")],
    },
    ...overrides,
  }
}

describe("steps chip", () => {
  it("counts ticked steps and turns accent when all are ticked", () => {
    expect(stepsChip(assignment())).toEqual({
      text: "2 of 5 steps",
      complete: false,
      interactive: true,
    })
    expect(
      stepsChip(
        assignment({ steps: { total: 1, ticked: 1, canTick: true, items: [item("1", true)] } }),
      ),
    ).toEqual({ text: "1 of 1 step", complete: true, interactive: true })
  })

  it("shows a done occurrence's snapshot quietly and nothing without steps", () => {
    expect(
      stepsChip(
        assignment({
          status: "COMPLETED",
          steps: { total: 5, ticked: 4, canTick: false, items: null },
        }),
      ),
    ).toEqual({ text: "4 of 5 steps", complete: false, interactive: false })
    expect(stepsChip(assignment({ steps: null }))).toBeNull()
    expect(stepsChip(assignment({ steps: undefined }))).toBeNull()
  })
})

describe("Mark done anyway", () => {
  it("asks only while steps are left unticked on an open occurrence", () => {
    expect(untickedSteps(assignment())).toBe(3)
    expect(markDoneAnywayText(3)).toBe("3 steps not ticked. Mark done anyway?")
    expect(markDoneAnywayText(1)).toBe("1 step not ticked. Mark done anyway?")
    expect(
      untickedSteps(
        assignment({ steps: { total: 1, ticked: 1, canTick: true, items: [item("1", true)] } }),
      ),
    ).toBe(0)
    expect(untickedSteps(assignment({ steps: null }))).toBe(0)
    expect(untickedSteps(assignment({ status: "COMPLETED" }))).toBe(0)
  })
})

describe("ticks", () => {
  const viewer = { userId: "user-1", displayName: "Farhan" }
  const now = new Date("2026-11-14T18:30:00Z")

  it("ticks and unticks at once and puts a failed tick back", () => {
    const ticked = optimisticTick(assignment(), "3", true, viewer, now)
    expect(ticked.steps?.ticked).toBe(3)
    expect(ticked.steps?.items?.[2]).toMatchObject({ ticked: true, tickedBy: viewer })
    const unticked = optimisticTick(ticked, "1", false, viewer, now)
    expect(unticked.steps?.ticked).toBe(2)
    expect(unticked.steps?.items?.[0]).toMatchObject({ ticked: false, tickedBy: null })
    // Step 3 failed: it goes back; step 1's untick stays.
    const reverted = revertTick(unticked, assignment(), "3")
    expect(reverted.steps?.items?.map((step) => step.ticked)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ])
    expect(reverted.steps?.ticked).toBe(1)
  })

  it("says who ticked and when on group chores and When needed", () => {
    expect(tickedByLabel(item("1", true), "user-1", "America/Halifax")).toBe("Rubayet · 2:14 PM")
    expect(tickedByLabel(item("1", true), "user-2", "America/Halifax")).toBe("You · 2:14 PM")
    expect(tickedByLabel(item("3"), "user-1", "America/Halifax")).toBeNull()
    expect(showsWhoTicked(assignment())).toBe(false)
    expect(
      showsWhoTicked(
        assignment({
          assignees: [
            { userId: "user-1", displayName: "Farhan" },
            { userId: "user-2", displayName: "Rubayet" },
          ],
        }),
      ),
    ).toBe(true)
    expect(showsWhoTicked(assignment({ kind: "AS_NEEDED" }))).toBe(true)
  })
})
