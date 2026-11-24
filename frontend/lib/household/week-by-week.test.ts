import { describe, expect, it } from "vitest"
import { myWeeksLine, weekChip } from "./week-by-week"

const week = (userId: string, displayName: string) => ({
  status: "PENDING" as const,
  week: { owner: { userId, displayName }, until: "2026-12-06" },
})

describe("weekChip", () => {
  it("says it's your week, or whose week it is, and until when", () => {
    expect(weekChip(week("farhan", "Farhan"), "farhan")).toEqual({
      text: "Your week · until Sun, Dec 6",
      mine: true,
      initial: null,
    })
    expect(weekChip(week("rubayet", "Rubayet"), "farhan")).toEqual({
      text: "Rubayet's week · until Sun, Dec 6",
      mine: false,
      initial: "R",
    })
  })

  it("shows nothing for other chores or occurrences that aren't waiting", () => {
    expect(weekChip({ status: "PENDING", week: null }, "farhan")).toBeNull()
    expect(weekChip({ ...week("farhan", "Farhan"), status: "COMPLETED" }, "farhan")).toBeNull()
  })
})

describe("myWeeksLine", () => {
  const dishes = {
    choreId: "c1",
    title: "Wash dishes",
    categoryName: "Kitchen",
    until: "2026-12-06",
    next: { userId: "rubayet", displayName: "Rubayet" },
  }

  it("names the chore, or the category they share, and who takes over", () => {
    expect(myWeeksLine([dishes])).toEqual({
      title: "Your weeks: Wash dishes",
      detail: "Until Sun, Dec 6 · then Rubayet takes over",
    })
    expect(myWeeksLine([dishes, { ...dishes, choreId: "c2", title: "Wipe counters" }])?.title).toBe(
      "Your weeks: Kitchen chores",
    )
    expect(
      myWeeksLine([dishes, { ...dishes, choreId: "c3", title: "Vacuum", categoryName: "Cleaning" }])
        ?.title,
    ).toBe("Your weeks: Wash dishes +1")
    expect(myWeeksLine([{ ...dishes, next: null }])?.detail).toBe("Until Sun, Dec 6")
  })

  it("is absent when the viewer has no weeks", () => {
    expect(myWeeksLine([])).toBeNull()
    expect(myWeeksLine(undefined)).toBeNull()
  })
})
