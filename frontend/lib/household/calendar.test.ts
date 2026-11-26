import { describe, expect, it } from "vitest"
import {
  addState,
  calendarTitle,
  dayDots,
  filterUndated,
  householdToday,
  isCurrentRange,
  itemTime,
  itemsByDay,
  memberColor,
  monthGrid,
  personCounts,
  quickCreateDraft,
  rangeFor,
  rangeLabel,
  stepAnchor,
  undatedSubtitle,
  weekDates,
  weekStart,
  type CalendarDTO,
  type CalendarItem,
  type CalendarMember,
} from "./calendar"

const members: CalendarMember[] = [
  { userId: "farhan", displayName: "Farhan", role: "OWNER", colorIndex: 0 },
  { userId: "rubayet", displayName: "Rubayet", role: "MEMBER", colorIndex: 1 },
  { userId: "abubakar", displayName: "Abubakar", role: "ADMIN", colorIndex: 2 },
  { userId: "sam", displayName: "Sam", role: "MEMBER", colorIndex: 3 },
  { userId: "lee", displayName: "Lee", role: "MEMBER", colorIndex: 4 },
]

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "a-1",
    choreId: "c-1",
    title: "Wash dishes",
    categoryName: null,
    categoryIcon: null,
    kind: "CALENDAR",
    status: "PENDING",
    date: "2026-11-26",
    dueAt: "2026-11-27T02:00:00Z",
    assignees: [{ userId: "farhan", displayName: "Farhan" }],
    projected: false,
    toBeDecided: false,
    ...overrides,
  }
}

describe("weeks, Monday to Sunday in the household's time zone", () => {
  it("starts every week on Monday, including from a Sunday and a Monday", () => {
    expect(weekStart("2026-11-26")).toBe("2026-11-23")
    expect(weekStart("2026-11-29")).toBe("2026-11-23")
    expect(weekStart("2026-11-30")).toBe("2026-11-30")
    expect(weekDates("2026-11-23")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ])
    expect(rangeFor("week", "2026-11-26")).toEqual({ from: "2026-11-23", to: "2026-11-29" })
  })

  it("keeps seven whole days across a daylight-saving change", () => {
    // Clocks go back in Halifax on Sunday, November 1, 2026, and forward on March 14, 2027.
    expect(weekDates(weekStart("2026-11-01"))).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ])
    expect(rangeFor("week", "2027-03-14")).toEqual({ from: "2027-03-08", to: "2027-03-14" })
    expect(stepAnchor("week", "2027-03-10", 1)).toBe("2027-03-15")
  })

  it("takes today from the household's zone, not the device's", () => {
    // 02:30 UTC on Monday is still Sunday evening in Halifax and already Monday in Tokyo.
    const instant = new Date("2027-03-15T02:30:00Z")
    expect(householdToday("America/Halifax", instant)).toBe("2027-03-14")
    expect(householdToday("Asia/Tokyo", instant)).toBe("2027-03-15")
    expect(weekStart(householdToday("America/Halifax", instant))).toBe("2027-03-08")
  })

  it("shows due times in the household's zone on both sides of the change", () => {
    // 9 PM in Halifax: UTC-3 after March 14, UTC-4 before.
    expect(itemTime(item({ dueAt: "2027-03-14T01:00:00Z" }), "America/Halifax")).toBe("9 PM")
    expect(itemTime(item({ dueAt: "2027-03-16T00:00:00Z" }), "America/Halifax")).toBe("9 PM")
    expect(itemTime(item({ dueAt: "2027-03-16T00:30:00Z" }), "America/Halifax")).toBe("9:30 PM")
  })

  it("labels the range and the title", () => {
    expect(rangeLabel("week", "2026-11-26")).toBe("Nov 23 – 29")
    expect(rangeLabel("week", "2026-12-01")).toBe("Nov 30 – Dec 6")
    expect(rangeLabel("month", "2026-11-26")).toBe("November 2026")
    expect(calendarTitle("week", "2026-11-26", "2026-11-26")).toBe("This week")
    expect(calendarTitle("week", "2026-12-01", "2026-11-26")).toBe("Next week")
    expect(calendarTitle("week", "2026-12-08", "2026-11-26")).toBe("Week of Dec 7")
    expect(calendarTitle("month", "2026-11-26", "2026-11-26")).toBe("November")
    expect(isCurrentRange("week", "2026-11-29", "2026-11-26")).toBe(true)
    expect(isCurrentRange("week", "2026-11-30", "2026-11-26")).toBe(false)
  })
})

describe("the month grid", () => {
  it("is Monday-first with blank days outside the month", () => {
    // November 2026 starts on a Sunday: six blanks, then the 1st in the last column.
    const weeks = monthGrid("2026-11-10")
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"])
    expect(weeks[1][0]).toBe("2026-11-02")
    expect(weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null])
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    // February 2027 starts on a Monday and fills four rows exactly.
    expect(monthGrid("2027-02-01")).toHaveLength(4)
    expect(rangeFor("month", "2027-02-14")).toEqual({ from: "2027-02-01", to: "2027-02-28" })
    expect(stepAnchor("month", "2027-01-31", 1)).toBe("2027-02-01")
  })

  it("shows up to three people's dots, then +N, hollow when projected", () => {
    const three = [
      item(),
      item({ assignees: [{ userId: "rubayet", displayName: "Rubayet" }], projected: true }),
      item({
        assignees: [
          { userId: "sam", displayName: "Sam" },
          { userId: "lee", displayName: "Lee" },
        ],
      }),
    ]
    const { dots, more } = dayDots(three, members)
    expect(dots).toEqual([
      { color: "teal", projected: false },
      { color: "amber", projected: true },
      { color: "coral", projected: false },
    ])
    expect(more).toBe(1)
    expect(
      dayDots([item({ assignees: [], toBeDecided: true, projected: true })], members).dots,
    ).toEqual([{ color: "neutral", projected: true }])
  })
})

describe("people", () => {
  it("gives each member a stable colour from join order", () => {
    expect(memberColor(members, "farhan")).toBe("teal")
    expect(memberColor(members, "rubayet")).toBe("amber")
    expect(memberColor(members, "abubakar")).toBe("blue")
    expect(memberColor(members, "sam")).toBe("coral")
    // The same answer whatever order the list arrives in.
    expect(memberColor([...members].reverse(), "sam")).toBe("coral")
    expect(memberColor(members, "someone-who-left")).toBe("neutral")
  })

  it("filters days, the by-person pills and the undated list to one member", () => {
    const calendar: CalendarDTO = {
      from: "2026-11-23",
      to: "2026-11-29",
      today: "2026-11-26",
      timezone: "America/Halifax",
      viewerRole: "OWNER",
      members,
      days: [
        {
          date: "2026-11-26",
          items: [item(), item({ id: "a-2", assignees: [{ userId: "sam", displayName: "Sam" }] })],
        },
      ],
      undated: [
        { id: "u-1", choreId: "c-9", title: "Paper", kind: "AS_NEEDED", flagged: true, turn: [] },
        {
          id: "u-2",
          choreId: "c-8",
          title: "Plants",
          kind: "AS_NEEDED",
          flagged: false,
          turn: [{ userId: "farhan", displayName: "Farhan Habib" }],
        },
      ],
      counts: [
        { userId: "farhan", count: 3 },
        { userId: "rubayet", count: 5 },
        { userId: "abubakar", count: 3 },
        { userId: "sam", count: 1 },
        { userId: "lee", count: 0 },
      ],
    }
    expect(itemsByDay(calendar, "everyone").get("2026-11-26")).toHaveLength(2)
    expect(
      itemsByDay(calendar, "sam")
        .get("2026-11-26")
        ?.map((i) => i.id),
    ).toEqual(["a-2"])
    expect(personCounts(calendar, "everyone").map((p) => p.member.userId)).toEqual([
      "rubayet",
      "farhan",
      "abubakar",
      "sam",
      "lee",
    ])
    expect(personCounts(calendar, "sam")).toEqual([{ member: members[3], count: 1 }])
    expect(filterUndated(calendar.undated, "sam").map((u) => u.id)).toEqual(["u-1"])
    expect(filterUndated(calendar.undated, "farhan").map((u) => u.id)).toEqual(["u-1", "u-2"])
    expect(calendar.undated.map(undatedSubtitle)).toEqual(["Anyone · needs doing", "Farhan's turn"])
  })
})

describe("adding from a day", () => {
  it("is for owners and admins, and not on past days", () => {
    expect(addState("OWNER", "2026-11-26", "2026-11-26")).toBe("enabled")
    expect(addState("ADMIN", "2026-11-30", "2026-11-26")).toBe("enabled")
    expect(addState("ADMIN", "2026-11-25", "2026-11-26")).toBe("disabled")
    expect(addState("MEMBER", "2026-11-30", "2026-11-26")).toBe("hidden")
  })

  it("starts quick create as Just once on that date, back to the calendar", () => {
    expect(quickCreateDraft("2026-11-28")).toEqual({
      title: "",
      once: { date: "2026-11-28" },
      returnTo: "calendar",
    })
  })

  it("shows a tick, not a time, once a chore is done", () => {
    expect(itemTime(item({ status: "COMPLETED" }), "America/Halifax")).toBeNull()
    expect(itemTime(item({ dueAt: null }), "America/Halifax")).toBeNull()
  })
})
