import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "./chores"
import { deadlineWords, householdJobView, optimisticFlag, timeAgo } from "./household-jobs"

const now = Date.parse("2026-11-14T15:00:00Z")

function job(overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return {
    id: "garbage",
    householdId: "home",
    choreId: "chore",
    categoryName: null,
    categoryIcon: null,
    title: "Garbage",
    scheduledFor: "2026-11-16",
    dueAt: "2026-11-16T20:00:00Z",
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 1,
    estimatedMinutes: null,
    assignees: [{ userId: "sam", displayName: "Sam" }],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    kind: "AS_NEEDED",
    turn: { userId: "sam", displayName: "Sam" },
    lastDone: null,
    flag: null,
    actions: {
      canMove: false,
      canSkip: false,
      canUnskip: false,
      canReassign: false,
      moveEarliest: null,
      moveLatest: null,
      maxAssignees: 1,
      canFlag: true,
    },
    ...overrides,
  }
}

describe("household job cards", () => {
  it("says whose turn it is and labels the complete button for that person", () => {
    expect(householdJobView(job(), "sam", "UTC", now)).toMatchObject({
      turnLabel: "Your turn",
      yourTurn: true,
      completeLabel: "Done",
      lastDoneLabel: "Not done yet",
      deadlineLabel: "Due Mon, Nov 16 by 8:00 PM",
      canFlag: true,
    })
    expect(householdJobView(job(), "ana", "UTC", now)).toMatchObject({
      turnLabel: "Sam's turn",
      yourTurn: false,
      completeLabel: "I did it",
    })
    expect(householdJobView(job({ canComplete: false }), "ben", "UTC", now).completeLabel).toBe(
      null,
    )
  })

  it("shows the last completion, the flag and no deadline line while flagged", () => {
    const view = householdJobView(
      job({
        lastDone: {
          at: "2026-11-12T15:00:00Z",
          byUserId: "abu",
          byDisplayName: "Abubakar",
        },
        flag: { at: "2026-11-14T14:50:00Z", byUserId: "rub", byDisplayName: "Rubayet" },
      }),
      "sam",
      "UTC",
      now,
    )
    expect(view.lastDoneLabel).toBe("Last done 2 days ago by Abubakar")
    expect(view.flagLabel).toBe("Flagged 10 min ago by Rubayet")
    expect(view.deadlineLabel).toBeNull()
  })

  it("has no deadline line without a backstop, and words overdue deadlines", () => {
    expect(householdJobView(job({ dueAt: null }), "sam", "UTC", now).deadlineLabel).toBeNull()
    expect(
      householdJobView(job({ dueAt: "2026-11-14T08:00:00Z", overdue: true }), "sam", "UTC", now)
        .deadlineLabel,
    ).toBe("Was due by 8:00 AM today")
  })

  it("words times in the household's time zone", () => {
    expect(deadlineWords("2026-11-15T01:00:00Z", "America/Halifax", now)).toBe("by 9:00 PM today")
    expect(timeAgo("2026-11-14T14:59:40Z", now)).toBe("just now")
    expect(timeAgo("2026-11-13T15:00:00Z", now)).toBe("yesterday")
  })

  it("pulls the deadline forward in the optimistic flag, but never pushes it later", () => {
    const flagged = optimisticFlag(job(), { userId: "ben", displayName: "Ben" }, now)
    expect(flagged.flag?.byUserId).toBe("ben")
    expect(flagged.dueAt).toBe(new Date(now).toISOString())
    const early = optimisticFlag(
      job({ dueAt: "2026-11-14T08:00:00Z" }),
      {
        userId: "ben",
        displayName: "Ben",
      },
      now,
    )
    expect(early.dueAt).toBe("2026-11-14T08:00:00Z")
  })
})

describe("categoryWithRepeat", () => {
  it("adds the interval summary to After it's done chores only", async () => {
    const { categoryWithRepeat } = await import("./household-jobs")
    expect(
      categoryWithRepeat(
        job({
          kind: "AFTER_COMPLETION",
          categoryName: "Floors",
          repeat: { intervalCount: 3, intervalUnit: "DAY", backstopDays: null, dueTime: null },
        }),
      ),
    ).toBe("Floors · Every 3 days after it's done")
    expect(categoryWithRepeat(job({ kind: "CALENDAR", categoryName: null }))).toBe("Chore")
  })
})
