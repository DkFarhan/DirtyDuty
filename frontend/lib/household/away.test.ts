import { describe, expect, it } from "vitest"
import {
  awayNote,
  awayRowValue,
  awaySummary,
  awayTag,
  effectLine,
  matchingQuickPick,
  quickPickDates,
  todayIn,
  validateAwayDates,
  type AwayEffect,
  type AwayPeriod,
} from "./away"

// A pinned "today": Thursday, Nov 26 2026.
const THURSDAY = "2026-11-26"

const chore = (title: string, effect: AwayEffect["effect"], extra: Partial<AwayEffect> = {}) =>
  ({
    choreId: title,
    title,
    categoryIcon: null,
    effect,
    resumesOn: null,
    coveredBy: null,
    ...extra,
  }) satisfies AwayEffect

describe("away mode dates", () => {
  it("reads today in the household's time zone", () => {
    const instant = new Date("2026-11-27T02:30:00Z")
    expect(todayIn("America/Halifax", instant)).toBe("2026-11-26")
    expect(todayIn("UTC", instant)).toBe("2026-11-27")
  })

  it("quick picks: this weekend, 1 week, 2 weeks and until I'm back", () => {
    expect(quickPickDates("weekend", THURSDAY)).toEqual({
      startsOn: "2026-11-28",
      endsOn: "2026-11-29",
      untilBack: false,
    })
    // On a weekend it's today to Sunday.
    expect(quickPickDates("weekend", "2026-11-28").startsOn).toBe("2026-11-28")
    expect(quickPickDates("weekend", "2026-11-29")).toEqual({
      startsOn: "2026-11-29",
      endsOn: "2026-11-29",
      untilBack: false,
    })
    expect(quickPickDates("week", THURSDAY).endsOn).toBe("2026-12-02")
    expect(quickPickDates("two-weeks", THURSDAY).endsOn).toBe("2026-12-09")
    expect(quickPickDates("until-back", THURSDAY)).toEqual({
      startsOn: THURSDAY,
      endsOn: null,
      untilBack: true,
    })
    expect(matchingQuickPick(quickPickDates("week", THURSDAY), THURSDAY)).toBe("week")
    expect(
      matchingQuickPick({ startsOn: THURSDAY, endsOn: "2026-11-30", untilBack: false }, THURSDAY),
    ).toBeNull()
  })

  it("rejects past starts, ends before the start and more than 90 days, inline", () => {
    expect(
      validateAwayDates(
        { startsOn: "2026-11-25", endsOn: "2026-11-27", untilBack: false },
        THURSDAY,
      ),
    ).toEqual({ field: "startsOn", message: "Away mode can't start in the past." })
    expect(
      validateAwayDates({ startsOn: THURSDAY, endsOn: "2027-02-25", untilBack: false }, THURSDAY),
    ).toEqual({ field: "endsOn", message: "Away mode can last up to 90 days." })
    expect(
      validateAwayDates({ startsOn: THURSDAY, endsOn: "2027-02-24", untilBack: false }, THURSDAY),
    ).toBeNull()
    expect(
      validateAwayDates(
        { startsOn: "2026-11-28", endsOn: "2026-11-27", untilBack: false },
        THURSDAY,
      ),
    ).toEqual({ field: "endsOn", message: "The end date can't be before the start date." })
    expect(
      validateAwayDates({ startsOn: THURSDAY, endsOn: null, untilBack: true }, THURSDAY),
    ).toBeNull()
    // A period that has started keeps its start.
    expect(
      validateAwayDates(
        { startsOn: "2026-11-20", endsOn: "2026-11-30", untilBack: false },
        THURSDAY,
        "2026-11-20",
      ),
    ).toBeNull()
  })
})

describe("away mode copy", () => {
  it("summarises the dates and what happens to the chores", () => {
    const text = (parts: { text: string }[]) => parts.map((part) => part.text).join("")
    const dates = { startsOn: "2026-11-28", endsOn: "2026-11-30", untilBack: false }
    const summary = awaySummary(dates, THURSDAY, [
      chore("Take out garbage", "SKIPS_YOU"),
      chore("Water plants", "PAUSED", { resumesOn: "2026-12-01" }),
    ])
    expect(text(summary)).toBe(
      "Away for 3 days. Your turns go to others, Water plants pauses, and you get no chore reminders.",
    )
    expect(summary.filter((part) => part.strong).map((part) => part.text)).toEqual([
      "3 days",
      "go to others",
      "pauses",
      "no chore reminders",
    ])
    expect(text(awaySummary(dates, THURSDAY, [], false))).toBe(
      "Away for 3 days. They get no chore reminders.",
    )
    expect(
      text(awaySummary({ startsOn: THURSDAY, endsOn: null, untilBack: true }, THURSDAY, [])),
    ).toBe("Away until you're back (up to 90 days). You get no chore reminders.")
  })

  it("names each paused chore once, at most three, then how many more", () => {
    const text = (parts: { text: string }[]) => parts.map((part) => part.text).join("")
    const dates = { startsOn: "2026-11-28", endsOn: "2026-11-30", untilBack: false }
    const paused = (title: string, id: string) =>
      chore(title, "PAUSED", { choreId: id, resumesOn: "2026-12-01" })
    expect(
      text(
        awaySummary(dates, THURSDAY, [
          paused("Towels", "t1"),
          paused("Towels", "t2"),
          paused("Plants", "p"),
        ]),
      ),
    ).toBe("Away for 3 days. Towels and Plants pause and you get no chore reminders.")
    expect(
      text(
        awaySummary(dates, THURSDAY, [
          paused("Towels", "t1"),
          paused("Towels", "t2"),
          paused("Plants", "p"),
          paused("Bins", "b"),
          paused("Fish", "f"),
          paused("Mop", "m"),
        ]),
      ),
    ).toBe("Away for 3 days. Towels, Plants, Bins and 2 more pause and you get no chore reminders.")
  })

  it("words each chore's effect", () => {
    expect(effectLine(chore("Bins", "SKIPS_YOU"))).toBe("Turns skip you while away")
    expect(effectLine(chore("Plants", "PAUSED", { resumesOn: "2026-12-01" }))).toBe(
      "Paused · resumes Tue, Dec 1",
    )
    expect(effectLine(chore("Dishes", "COVERED", { coveredBy: "Rubayet" }))).toBe(
      "Rubayet covers your slot",
    )
  })

  it("shows Off or the end date on Profile, and a tag on the member card", () => {
    const period: AwayPeriod = {
      id: "p",
      startsOn: "2026-11-28",
      endsOn: "2026-11-30",
      returnsOn: "2026-12-01",
      untilBack: false,
      status: "UPCOMING",
    }
    expect(awayRowValue(null)).toBe("Off")
    expect(awayRowValue(period)).toBe("Until Mon, Nov 30")
    expect(awayRowValue({ ...period, untilBack: true })).toBe("Until you're back")
    expect(awayTag("2026-11-26", "2026-11-29", THURSDAY)).toBe("Away until Sun")
    expect(awayTag("2026-11-28", "2026-11-30", THURSDAY)).toBe("Away from Sat")
    expect(awayTag("2026-11-20", "2026-11-25", THURSDAY)).toBeNull()
    expect(awayTag("2026-11-26", "2026-12-20", THURSDAY)).toBe("Away until Dec 20")
  })

  it("notes a turn that skipped someone away", () => {
    const assignment = {
      status: "PENDING",
      awayFrom: { userId: "r", displayName: "Rubayet" },
      assignees: [{ userId: "a", displayName: "Abubakar" }],
    }
    expect(awayNote(assignment, "x")).toBe("Rubayet is away, so it skipped to Abubakar")
    expect(awayNote(assignment, "a")).toBe("Rubayet is away, so it skipped to you")
    expect(awayNote({ ...assignment, status: "COMPLETED" }, "a")).toBeNull()
    expect(awayNote({ ...assignment, awayFrom: null }, "a")).toBeNull()
  })
})
