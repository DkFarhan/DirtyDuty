import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "./chores"
import {
  hasOccurrenceActions,
  localTime,
  movedFromLabel,
  optimisticOccurrence,
  zonedInstant,
} from "./occurrence-actions"

const base: AssignmentDTO = {
  id: "a",
  householdId: "h",
  choreId: "c",
  categoryName: null,
  categoryIcon: null,
  title: "Bins out",
  scheduledFor: "2026-11-18",
  dueAt: "2026-11-18T18:00:00Z",
  status: "PENDING",
  priority: "NORMAL",
  difficulty: 1,
  estimatedMinutes: null,
  assignees: [{ userId: "ana", displayName: "Ana" }],
  canComplete: true,
  completedAt: null,
  completedByDisplayName: null,
  overdue: false,
  originalDate: null,
  moved: false,
  reassigned: false,
  actions: {
    canMove: true,
    canSkip: true,
    canUnskip: false,
    canReassign: true,
    moveEarliest: "2026-11-11",
    moveLatest: null,
    maxAssignees: 1,
  },
}

describe("occurrence actions", () => {
  it("knows when there is nothing the viewer may do", () => {
    expect(hasOccurrenceActions(base)).toBe(true)
    expect(hasOccurrenceActions({ ...base, actions: undefined })).toBe(false)
    expect(
      hasOccurrenceActions({
        ...base,
        actions: { ...base.actions!, canMove: false, canSkip: false, canReassign: false },
      }),
    ).toBe(false)
  })

  it("predicts a move, keeping the time and the original day", () => {
    const moved = optimisticOccurrence(
      base,
      { kind: "move", date: "2026-11-20", time: null },
      "UTC",
      "ana",
    )
    expect(moved.scheduledFor).toBe("2026-11-20")
    expect(moved.dueAt).toBe("2026-11-20T18:00:00.000Z")
    expect(moved.originalDate).toBe("2026-11-18")
    expect(movedFromLabel(moved)).toBe("Moved from Wed")
    const back = optimisticOccurrence(
      moved,
      { kind: "move", date: "2026-11-18", time: null },
      "UTC",
      "ana",
    )
    expect(back.originalDate).toBeNull()
    expect(movedFromLabel(back)).toBeNull()
  })

  it("adds the date to the moved hint once a move spans a week", () => {
    expect(movedFromLabel({ originalDate: "2026-11-13", scheduledFor: "2026-11-20" })).toBe(
      "Moved from Fri, Nov 13",
    )
    expect(movedFromLabel({ originalDate: "2026-11-13", scheduledFor: "2026-11-15" })).toBe(
      "Moved from Fri",
    )
  })

  it("predicts skip, undo and reassign", () => {
    const skipped = optimisticOccurrence(base, { kind: "skip" }, "UTC", "ana")
    expect(skipped.status).toBe("SKIPPED")
    expect(skipped.canComplete).toBe(false)
    expect(skipped.actions?.canUnskip).toBe(true)
    expect(optimisticOccurrence(skipped, { kind: "unskip" }, "UTC", "ana").status).toBe("PENDING")
    const reassigned = optimisticOccurrence(
      base,
      { kind: "reassign", assignees: [{ userId: "ben", displayName: "Ben" }] },
      "UTC",
      "ana",
    )
    expect(reassigned.assignees).toEqual([{ userId: "ben", displayName: "Ben" }])
    expect(reassigned.canComplete).toBe(false)
  })

  it("converts local due times across a daylight-saving change", () => {
    // Halifax moves its clocks back on Nov 1, 2026: 6 pm is 21:00Z before and 22:00Z after.
    expect(zonedInstant("2026-10-31", "18:00", "America/Halifax")).toBe("2026-10-31T21:00:00.000Z")
    expect(zonedInstant("2026-11-02", "18:00", "America/Halifax")).toBe("2026-11-02T22:00:00.000Z")
    expect(localTime("2026-11-02T22:00:00Z", "America/Halifax")).toBe("18:00")
  })
})
