import { describe, expect, it } from "vitest"
import type { AssignmentDTO } from "@/lib/household/chores"
import {
  WEEK_SUMMARY_TEMPLATES,
  formatUpcomingDateLabel,
  getDailyMessageIndex,
  getLocalDateKey,
  getUpcomingAssignments,
  getWeekSummaryMessage,
  getWeekSummaryState,
  groupAssignmentsByDate,
  type WeekSummaryState,
} from "./week-summary"

const baseCounts = { assigned: 4, completed: 2, dueToday: 0, overdue: 0 }

function dateForIndex(state: WeekSummaryState, targetIndex: number) {
  for (let day = 1; day <= 31; day += 1) {
    const dateKey = `2026-10-${String(day).padStart(2, "0")}`
    if (getDailyMessageIndex("user-1", dateKey, state) === targetIndex) return dateKey
  }
  throw new Error(`No deterministic date found for ${state} template ${targetIndex}`)
}

function assignment(
  id: string,
  scheduledFor: string,
  status: AssignmentDTO["status"] = "PENDING",
): AssignmentDTO {
  return {
    id,
    householdId: "home-1",
    choreId: `chore-${id}`,
    categoryName: "Kitchen",
    categoryIcon: "🍽️",
    title: id,
    scheduledFor,
    dueAt: `${scheduledFor.slice(0, 10)}T18:00:00Z`,
    status,
    priority: "NORMAL",
    difficulty: 2,
    estimatedMinutes: null,
    assignees: [{ userId: "user-1", displayName: "Jahid" }],
    canComplete: status === "PENDING",
    completedAt: status === "COMPLETED" ? "2026-10-17T18:00:00Z" : null,
    completedByDisplayName: null,
    overdue: false,
  }
}

describe("YOUR WEEK summary", () => {
  it("applies the requested state priority and derives every state", () => {
    expect(getWeekSummaryState({ assigned: 4, completed: 4, dueToday: 1, overdue: 1 })).toBe(
      "OVERDUE",
    )
    expect(getWeekSummaryState({ assigned: 4, completed: 4, dueToday: 1, overdue: 0 })).toBe(
      "DUE_TODAY",
    )
    expect(getWeekSummaryState({ assigned: 2, completed: 2, dueToday: 0, overdue: 0 })).toBe(
      "ALL_COMPLETE",
    )
    expect(getWeekSummaryState(baseCounts)).toBe("ON_TRACK")
    expect(getWeekSummaryState({ assigned: 0, completed: 0, dueToday: 0, overdue: 0 })).toBe(
      "NO_ASSIGNMENTS",
    )
  })

  it("keeps exactly five approved templates for each presentation state", () => {
    for (const state of [
      "OVERDUE",
      "DUE_TODAY",
      "ALL_COMPLETE",
      "ON_TRACK",
      "NO_ASSIGNMENTS",
    ] as const) {
      expect(WEEK_SUMMARY_TEMPLATES[state]).toHaveLength(5)
    }
    expect(WEEK_SUMMARY_TEMPLATES.OVERDUE[0].title).toBe("You've got unfinished business 👀")
    expect(WEEK_SUMMARY_TEMPLATES.DUE_TODAY[0].body).toBe("Then you're clear.")
    expect(WEEK_SUMMARY_TEMPLATES.ALL_COMPLETE[3].title).toBe("Chore zero achieved.")
    expect(WEEK_SUMMARY_TEMPLATES.ON_TRACK[0].body).toBe(
      "You've finished {completed} of {assigned} chores.",
    )
    expect(WEEK_SUMMARY_TEMPLATES.NO_ASSIGNMENTS[4].title).toBe("Suspiciously peaceful.")
  })

  it("selects stable daily messages from the user, local date, and state", () => {
    const selected = getDailyMessageIndex("user-1", "2026-10-18", "ON_TRACK")
    expect(selected).toBe(getDailyMessageIndex("user-1", "2026-10-18", "ON_TRACK"))
    expect(getDailyMessageIndex("user-1", "2026-10-19", "ON_TRACK")).not.toBe(selected)
    expect(getDailyMessageIndex("user-1", "2026-10-18", "DUE_TODAY")).not.toBe(selected)
    expect(getDailyMessageIndex("user-3", "2026-10-18", "DUE_TODAY")).not.toBe(
      getDailyMessageIndex("user-1", "2026-10-18", "DUE_TODAY"),
    )
    for (let index = 0; index < 5; index += 1) {
      expect(getDailyMessageIndex("user-1", dateForIndex("OVERDUE", index), "OVERDUE")).toBe(index)
    }
  })

  it("formats interpolated counts with singular and plural wording", () => {
    const overdueDate = dateForIndex("OVERDUE", 0)
    const overdueSingular = getWeekSummaryMessage(
      "OVERDUE",
      { ...baseCounts, assigned: 1, overdue: 1 },
      "user-1",
      overdueDate,
    )
    expect(overdueSingular.body).toBe("1 chore slipped past the deadline.")
    const overduePlural = getWeekSummaryMessage(
      "OVERDUE",
      { ...baseCounts, overdue: 2 },
      "user-1",
      overdueDate,
    )
    expect(overduePlural.body).toBe("2 chores slipped past the deadline.")

    const dueToday = getWeekSummaryMessage(
      "DUE_TODAY",
      { ...baseCounts, dueToday: 1 },
      "user-1",
      dateForIndex("DUE_TODAY", 0),
    )
    expect(dueToday.title).toBe("Today's mission: 1 chore.")
    const dueTomorrow = getWeekSummaryMessage(
      "DUE_TODAY",
      { ...baseCounts, dueToday: 2 },
      "user-1",
      dateForIndex("DUE_TODAY", 4),
    )
    expect(dueTomorrow.body).toBe("You've got 2 things due today.")

    const onTrack = getWeekSummaryMessage(
      "ON_TRACK",
      { ...baseCounts, assigned: 3, completed: 2 },
      "user-1",
      dateForIndex("ON_TRACK", 1),
    )
    expect(onTrack.body).toBe("1 chore left this week.")
  })

  it("uses the household-local date for the daily key", () => {
    expect(getLocalDateKey(new Date("2026-01-01T01:00:00Z"), "America/Sao_Paulo")).toBe(
      "2025-12-31",
    )
  })
})

describe("UP NEXT assignment selection", () => {
  it("keeps only future pending assignments and excludes TODAY items", () => {
    const todayItem = assignment("today", "2026-10-18T12:00:00Z")
    const tomorrow = assignment("tomorrow", "2026-10-19T12:00:00Z")
    const later = assignment("later", "2026-10-20T12:00:00Z")
    const overdueFuture = {
      ...assignment("overdue-future", "2026-10-21T12:00:00Z"),
      overdue: true,
    }
    const completed = assignment("completed", "2026-10-21T12:00:00Z", "COMPLETED")
    expect(
      getUpcomingAssignments(
        [later, todayItem, completed, overdueFuture, tomorrow],
        [todayItem],
        "2026-10-18",
      ).map(({ id }) => id),
    ).toEqual(["tomorrow", "later"])
  })

  it("groups upcoming items by scheduled date and labels tomorrow naturally", () => {
    const grouped = groupAssignmentsByDate([
      assignment("tomorrow-one", "2026-10-19T12:00:00Z"),
      assignment("tomorrow-two", "2026-10-19T18:00:00Z"),
      assignment("tuesday", "2026-10-20T18:00:00Z"),
    ])
    expect(grouped.map(({ dateKey, assignments }) => [dateKey, assignments.length])).toEqual([
      ["2026-10-19", 2],
      ["2026-10-20", 1],
    ])
    expect(formatUpcomingDateLabel("2026-10-19", "2026-10-18")).toBe("Tomorrow")
  })
})
