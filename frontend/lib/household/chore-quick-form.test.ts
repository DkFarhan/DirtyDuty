import { describe, expect, it } from "vitest"
import type { Chore } from "./chores"
import { CHORE_SUGGESTIONS } from "./chore-suggestions"
import {
  addStep,
  allowsWeekByWeek,
  applySuggestion,
  buildQuickRequest,
  clearSuggestedSteps,
  copyValues,
  moveStep,
  removeStep,
  renameStep,
  stepsError,
  initialQuickValues,
  moreLabel,
  oftenLabel,
  summaryParts,
  todayIn,
  valuesFromChore,
  whoLabel,
  withField,
  withOften,
  withParticipants,
  withTitle,
  weeksExplanation,
  type QuickContext,
  type QuickValues,
} from "./chore-quick-form"

const members = [
  { userId: "farhan", displayName: "Farhan" },
  { userId: "rubayet", displayName: "Rubayet" },
  { userId: "abu", displayName: "Abubakar" },
]
// Saturday, November 14 2026.
const context: QuickContext = {
  viewerId: "farhan",
  members,
  timezone: "America/Halifax",
  today: "2026-11-14",
}
const categories = [
  { id: "cat-kitchen", name: "Kitchen" },
  { id: "cat-trash", name: "Trash" },
  { id: "cat-general", name: "General" },
]
const savedChore: Chore = {
  id: "chore-1",
  householdId: "home-1",
  categoryId: null,
  title: "Sweep porch",
  description: null,
  defaultPriority: "NORMAL",
  difficulty: 3,
  estimatedMinutes: null,
  requiresVerification: false,
  active: true,
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  schedule: null,
}
const suggestion = (title: string) => CHORE_SUGGESTIONS.find((item) => item.title === title)!

function named(title = "Sweep porch", values = initialQuickValues(context)) {
  return withTitle(values, title, categories)
}

function requestFor(values: QuickValues) {
  const result = buildQuickRequest(values, context)
  if ("error" in result) throw new Error(result.error.message)
  return result.request
}

function text(values: QuickValues, people = members) {
  return summaryParts(values, people, context.viewerId)
    .map((part) => part.text)
    .join("")
}

describe("todayIn", () => {
  it("uses the household timezone, not the device's", () => {
    const lateEveningInHalifax = new Date("2026-11-15T02:30:00Z")
    expect(todayIn("America/Halifax", lateEveningInHalifax)).toBe("2026-11-14")
    expect(todayIn("Asia/Dhaka", lateEveningInHalifax)).toBe("2026-11-15")
  })
})

describe("defaults", () => {
  it("starts weekly on today's weekday with turns between everyone", () => {
    const values = initialQuickValues(context)
    expect(values).toMatchObject({
      often: "WEEKLY",
      anchorWeekday: "SA",
      anchorMonthDay: 14,
      startsOn: "2026-11-14",
      who: "TURNS",
      participants: ["farhan", "rubayet", "abu"],
    })
    expect(oftenLabel(values)).toBe("Every week · Sat")
    expect(whoLabel(values, members, "farhan")).toBe("Take turns · everyone")
    expect(moreLabel(values, false)).toBe("Optional")
  })

  it("is just me in a single-member household", () => {
    const solo = { ...context, members: [members[0]] }
    const values = initialQuickValues(solo)
    expect(values.who).toBe("ME")
    expect(whoLabel(values, solo.members, "farhan")).toBe("Just me")
    const result = buildQuickRequest(withTitle(values, "Water plants", []), solo)
    expect("request" in result && result.request.schedule).toMatchObject({
      assignmentStrategy: "FIXED",
      fixedAssigneeUserId: "farhan",
      participantUserIds: [],
      peopleNeeded: 1,
    })
  })
})

describe("first date", () => {
  // Saturday, November 14 2026 in Halifax.
  const at = (now: string): QuickContext => ({ ...context, now })

  it("starts today while 6 PM is still ahead, and on the next matching date after it", () => {
    expect(initialQuickValues(at("17:59")).startsOn).toBe("2026-11-14")
    const late = initialQuickValues(at("18:00"))
    expect(late.startsOn).toBe("2026-11-15")
    const send = (values: QuickValues) =>
      buildQuickRequest(withTitle(values, "Sweep porch", categories), at("18:00"))
    const schedule = (values: QuickValues) => {
      const result = send(values)
      if ("error" in result) throw new Error(result.error.message)
      return result.request.schedule
    }
    // Every day: tomorrow. Every week and month keep Saturday and the 14th, so the first date the
    // rule produces from tomorrow is next week's or next month's.
    expect(schedule(withOften(late, "DAILY"))).toMatchObject({
      recurrenceRule: "FREQ=DAILY",
      startsOn: "2026-11-15",
    })
    expect(schedule(late)).toMatchObject({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
      startsOn: "2026-11-15",
    })
    expect(schedule(withOften(late, "MONTHLY")).recurrenceRule).toBe("FREQ=MONTHLY;BYMONTHDAY=14")
    expect(schedule(withOften(late, "ONCE")).startsOn).toBe("2026-11-15")
    expect(schedule(withOften(late, "AFTER_COMPLETION"))).toMatchObject({
      kind: "AFTER_COMPLETION",
      startsOn: "2026-11-15",
    })
  })

  it("uses a suggestion's own time", () => {
    const garbage = suggestion("Take out garbage")
    expect(garbage.dueTime).toBe("20:00")
    const evening = applySuggestion(
      initialQuickValues(at("19:00")),
      garbage,
      categories,
      at("19:00"),
    )
    expect(evening).toMatchObject({ dueTime: "20:00", startsOn: "2026-11-14" })
    const night = applySuggestion(initialQuickValues(at("21:00")), garbage, categories, at("21:00"))
    expect(night.startsOn).toBe("2026-11-15")
  })
})

describe("category guess", () => {
  it("follows the name until a category is picked, then never changes", () => {
    let values = named("Take out trash")
    expect(values.categoryId).toBe("cat-trash")
    values = withTitle(values, "Wash dishes", categories)
    expect(values.categoryId).toBe("cat-kitchen")
    values = withTitle(values, "Walk the dog", categories)
    expect(values.categoryId).toBeNull()
    values = withField(values, "category", { categoryId: "cat-general", categorySource: "set" })
    values = withTitle(values, "Take out trash", categories)
    expect(values.categoryId).toBe("cat-general")
  })

  it("leaves None when the guessed category isn't in this household", () => {
    expect(named("Fold clothes").categoryId).toBeNull()
  })
})

describe("suggestions", () => {
  it("fills every field from a suggestion", () => {
    const values = applySuggestion(
      initialQuickValues(context),
      suggestion("Take out garbage"),
      categories,
      context,
    )
    expect(values).toMatchObject({
      title: "Take out garbage",
      often: "AS_NEEDED",
      backstopEnabled: true,
      backstopDays: 2,
      dueTime: "20:00",
      who: "TURNS",
      categoryId: "cat-trash",
      categorySource: "set",
      difficulty: 2,
      estimatedMinutes: 5,
    })
  })

  it("keeps fields the user changed, and the setup when the name is edited afterwards", () => {
    let values = withField(initialQuickValues(context), "who", { who: "ME" })
    values = withField(values, "category", { categoryId: "cat-general", categorySource: "set" })
    values = applySuggestion(values, suggestion("Wash dishes"), categories, context)
    expect(values).toMatchObject({ who: "ME", categoryId: "cat-general", often: "DAILY" })
    values = withTitle(values, "Wash dishes and pans", categories)
    expect(values).toMatchObject({ title: "Wash dishes and pans", often: "DAILY", who: "ME" })
  })

  it("uses Just me for shared suggestions in a single-member household", () => {
    const solo = { ...context, members: [members[0]] }
    const values = applySuggestion(
      initialQuickValues(solo),
      suggestion("Walk the dog"),
      categories,
      solo,
    )
    expect(values.who).toBe("ME")
  })

  it("never pairs When it's needed with Mix it up", () => {
    let values = withField(initialQuickValues(context), "who", { who: "RANDOM" })
    values = withOften(values, "AS_NEEDED")
    expect(values.who).toBe("TURNS")
    values = withField(initialQuickValues(context), "who", { who: "RANDOM" })
    values = applySuggestion(values, suggestion("Take out garbage"), categories, context)
    expect(values.who).toBe("TURNS")
  })
})

describe("summary", () => {
  it("writes the When it's needed sentence with the key parts bold", () => {
    const values = applySuggestion(
      initialQuickValues(context),
      suggestion("Take out garbage"),
      categories,
      context,
    )
    const parts = summaryParts(values, members, "farhan")
    expect(text(values)).toBe(
      "When it's needed, at least 2 days after it was last done. Turns between you, Rubayet and Abubakar.",
    )
    // Deadlines after the first roll from each completion: no clock time.
    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      "When it's needed",
      "2 days",
      "you, Rubayet and Abubakar",
    ])
  })

  it("describes every kind of schedule and person", () => {
    const base = named()
    expect(text(base)).toBe(
      "Every week on Saturday by 6 PM. Turns between you, Rubayet and Abubakar.",
    )
    expect(text(withOften(base, "DAILY"))).toBe(
      "Every day by 6 PM. Turns between you, Rubayet and Abubakar.",
    )
    expect(text(withOften({ ...base, who: "ME" }, "MONTHLY"))).toBe(
      "Every month on the 14th by 6 PM. You do it.",
    )
    expect(
      text(withOften({ ...base, who: "SOMEONE", specificPeople: ["rubayet"] }, "AFTER_COMPLETION")),
    ).toBe("Every 3 days after it's done, by 6 PM. Rubayet always does it.")
    expect(text(withOften({ ...base, backstopEnabled: false }, "AS_NEEDED"))).toBe(
      "When it's needed, with no deadline. Turns between you, Rubayet and Abubakar.",
    )
    expect(text(withOften({ ...base, who: "RANDOM" }, "ONCE"))).toBe(
      "Once on Sat, Nov 14 by 6 PM. Picked at random from you, Rubayet and Abubakar.",
    )
  })
})

describe("group wording", () => {
  it("labels the Who row and writes the summary for more than one person", () => {
    const turns = withField(named(), "who", { peopleNeeded: 2 })
    expect(whoLabel(turns, members, "farhan")).toBe("Take turns · 2 at a time")
    expect(text(turns)).toBe(
      "Every week on Saturday by 6 PM. Two people each time, taking turns between you, Rubayet and Abubakar.",
    )
    const mix = withField(named(), "who", { who: "RANDOM", peopleNeeded: 2 })
    expect(whoLabel(mix, members, "farhan")).toBe("Mix it up · 2 at a time")
    const specific = (ids: string[]) =>
      withField(named(), "who", { who: "SOMEONE", specificPeople: ids })
    expect(whoLabel(specific(["rubayet"]), members, "farhan")).toBe("Rubayet")
    expect(whoLabel(specific(["farhan", "rubayet"]), members, "farhan")).toBe("Farhan & Rubayet")
    expect(text(specific(["rubayet", "abu"]))).toBe(
      "Every week on Saturday by 6 PM. Rubayet and Abubakar do it together.",
    )
    const four = [...members, { userId: "sam", displayName: "Sam" }]
    expect(whoLabel(specific(["farhan", "rubayet", "abu"]), four, "farhan")).toBe(
      "Farhan, Rubayet +1",
    )
    const all = specific(["farhan", "rubayet", "abu"])
    expect(whoLabel(all, members, "farhan")).toBe("Everyone together")
    expect(text(all)).toBe("Every week on Saturday by 6 PM. Everyone does it together.")
  })
})

describe("request mapping", () => {
  it.each([
    ["DAILY", "FREQ=DAILY"],
    ["WEEKLY", "FREQ=WEEKLY;BYDAY=SA"],
    ["BIWEEKLY", "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA"],
    ["MONTHLY", "FREQ=MONTHLY;BYMONTHDAY=14"],
    ["ONCE", "FREQ=ONCE"],
  ] as const)("maps %s to a calendar rule", (often, rule) => {
    expect(requestFor(withOften(named(), often)).schedule).toEqual({
      recurrenceRule: rule,
      timezone: "America/Halifax",
      startsOn: "2026-11-14",
      endsOn: null,
      dueTime: "18:00",
      assignmentStrategy: "ROUND_ROBIN",
      peopleNeeded: 1,
      fixedAssigneeUserId: null,
      participantUserIds: ["farhan", "rubayet", "abu"],
      everyone: true,
      rotationWeeks: null,
      kind: "CALENDAR",
      intervalCount: null,
      intervalUnit: null,
      backstopEnabled: null,
      backstopDays: null,
    })
  })

  it("maps After it's done to its interval with no rule", () => {
    const values = withOften(named(), "AFTER_COMPLETION", { afterCount: 2, afterUnit: "WEEK" })
    expect(requestFor(values).schedule).toMatchObject({
      recurrenceRule: null,
      kind: "AFTER_COMPLETION",
      intervalCount: 2,
      intervalUnit: "WEEK",
      startsOn: "2026-11-14",
      endsOn: null,
      dueTime: "18:00",
      backstopEnabled: null,
      backstopDays: null,
    })
  })

  it("maps When it's needed with a deadline, and with none", () => {
    const withDeadline = withOften(named(), "AS_NEEDED", { backstopDays: 3, dueTime: "20:00" })
    expect(requestFor(withDeadline).schedule).toMatchObject({
      recurrenceRule: null,
      kind: "AS_NEEDED",
      backstopEnabled: true,
      backstopDays: 3,
      dueTime: "20:00",
      intervalCount: null,
      intervalUnit: null,
      assignmentStrategy: "ROUND_ROBIN",
      peopleNeeded: 1,
    })
    const noDeadline = withOften(named(), "AS_NEEDED", { backstopEnabled: false })
    expect(requestFor(noDeadline).schedule).toMatchObject({
      backstopEnabled: false,
      backstopDays: null,
      dueTime: null,
    })
  })

  it("maps a custom rule with its season and count", () => {
    const base = named()
    const values = withOften(base, "CUSTOM", {
      custom: {
        recurrence: {
          ...base.custom.recurrence,
          interval: 2,
          weekdays: ["MO", "TH"],
          activeMonths: [11, 12, 1],
        },
        seasonal: true,
        endMode: "COUNT",
        count: 10,
        endsOn: "",
      },
    })
    expect(oftenLabel(values)).toBe("Custom · Every 2 weeks on Mon and Thu, Nov to Jan, 10 times")
    expect(requestFor(values).schedule).toMatchObject({
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;BYMONTH=1,11,12;COUNT=10",
      endsOn: null,
      kind: "CALENDAR",
    })
  })

  it.each([
    ["ME", { assignmentStrategy: "FIXED", fixedAssigneeUserId: "farhan", participantUserIds: [] }],
    [
      "SOMEONE",
      { assignmentStrategy: "FIXED", fixedAssigneeUserId: "rubayet", participantUserIds: [] },
    ],
    [
      "RANDOM",
      {
        assignmentStrategy: "RANDOM",
        fixedAssigneeUserId: null,
        participantUserIds: ["farhan", "rubayet", "abu"],
      },
    ],
  ] as const)("maps Who %s", (who, expected) => {
    const values = withField(named(), "who", { who, specificPeople: ["rubayet"] })
    expect(requestFor(values).schedule).toMatchObject({ ...expected, peopleNeeded: 1 })
  })

  it("maps two at a time for Take turns and Mix it up, both ways", () => {
    for (const [who, strategy] of [
      ["TURNS", "ROUND_ROBIN"],
      ["RANDOM", "RANDOM"],
    ] as const) {
      const values = withField(named(), "who", { who, peopleNeeded: 2 })
      const schedule = requestFor(values).schedule
      expect(schedule).toMatchObject({
        assignmentStrategy: strategy,
        peopleNeeded: 2,
        fixedAssigneeUserId: null,
        participantUserIds: ["farhan", "rubayet", "abu"],
      })
      const loaded = valuesFromChore(
        { ...savedChore, schedule: { ...savedChore.schedule!, ...schedule, active: true } },
        context,
      )
      expect(loaded.values).toMatchObject({ who, peopleNeeded: 2 })
      expect(loaded.shortfall).toBeNull()
      expect(requestFor(loaded.values).schedule).toMatchObject(schedule)
    }
  })

  it("maps Specific people with two ticked and with everyone, both ways", () => {
    const two = withField(named(), "who", { who: "SOMEONE", specificPeople: ["farhan", "rubayet"] })
    const all = withField(named(), "who", {
      who: "SOMEONE",
      specificPeople: ["farhan", "rubayet", "abu"],
    })
    for (const values of [two, all]) {
      const schedule = requestFor(values).schedule
      expect(schedule).toMatchObject({
        assignmentStrategy: "FIXED",
        peopleNeeded: values.specificPeople.length,
        fixedAssigneeUserId: null,
        participantUserIds: values.specificPeople,
      })
      // The backend stores the group's first person as fixedAssigneeUserId too.
      const stored = { ...schedule, fixedAssigneeUserId: values.specificPeople[0], active: true }
      const loaded = valuesFromChore(
        { ...savedChore, schedule: { ...savedChore.schedule!, ...stored } },
        context,
      ).values
      expect(loaded).toMatchObject({ who: "SOMEONE", specificPeople: values.specificPeople })
      expect(requestFor(loaded).schedule).toMatchObject(schedule)
    }
  })

  it("lowers Each time when people are unticked so the request stays valid", () => {
    const values = withField(named(), "who", { peopleNeeded: 2 })
    expect(withParticipants(values, ["farhan", "rubayet"], members).peopleNeeded).toBe(1)
    const four = [...members, { userId: "sam", displayName: "Sam" }]
    const three = withField(named(), "who", {
      participants: ["farhan", "rubayet", "abu", "sam"],
      peopleNeeded: 3,
    })
    expect(withParticipants(three, ["farhan", "rubayet", "abu"], four).peopleNeeded).toBe(2)
  })

  it("resets to one person when switching to After it's done or When it's needed", () => {
    const turns = withField(named(), "who", { peopleNeeded: 2 })
    expect(requestFor(withOften(turns, "AFTER_COMPLETION")).schedule.peopleNeeded).toBe(1)
    const pair = withField(named(), "who", { who: "SOMEONE", specificPeople: ["rubayet", "abu"] })
    const needed = withOften(pair, "AS_NEEDED")
    expect(needed.specificPeople).toEqual(["rubayet"])
    expect(requestFor(needed).schedule).toMatchObject({
      assignmentStrategy: "FIXED",
      peopleNeeded: 1,
      fixedAssigneeUserId: "rubayet",
    })
  })

  it("keeps the rotation order and drops people who left", () => {
    const values = withField(named(), "who", { participants: ["abu", "gone", "farhan"] })
    expect(requestFor(values).schedule.participantUserIds).toEqual(["abu", "farhan"])
  })

  it("reports the first problem next to its control", () => {
    const error = (values: QuickValues) => {
      const result = buildQuickRequest(values, context)
      return "error" in result ? result.error : null
    }
    expect(error(initialQuickValues(context))).toEqual({
      field: "title",
      message: "Enter a chore name.",
    })
    expect(error(named("   "))).toMatchObject({ field: "title" })
    expect(error(withField(named(), "who", { who: "SOMEONE", specificPeople: [] }))).toEqual({
      field: "who",
      message: "Choose who does it.",
    })
    expect(error(withField(named(), "who", { participants: [] }))).toEqual({
      field: "who",
      message: "Choose at least one person.",
    })
    expect(error({ ...named(), dueTime: "" })).toEqual({
      field: "often",
      message: "Choose a due time.",
    })
    expect(error(withOften(named(), "AS_NEEDED", { backstopDays: 31 }))).toMatchObject({
      field: "often",
    })
  })

  it("accepts a name at the backend's maximum length", () => {
    expect(requestFor(named("x".repeat(160))).title).toHaveLength(160)
  })
})

describe("editing", () => {
  const chore = (schedule: Partial<NonNullable<Chore["schedule"]>>): Chore => ({
    id: "chore-1",
    householdId: "home-1",
    categoryId: "cat-trash",
    title: "Take out garbage",
    description: "Bags under the sink",
    defaultPriority: "HIGH",
    difficulty: 2,
    estimatedMinutes: 5,
    requiresVerification: true,
    active: true,
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    schedule: {
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      timezone: "America/Halifax",
      startsOn: "2026-10-05",
      endsOn: null,
      dueTime: "19:30:00",
      assignmentStrategy: "ROUND_ROBIN",
      peopleNeeded: 1,
      fixedAssigneeUserId: null,
      participantUserIds: ["rubayet", "farhan"],
      active: true,
      ...schedule,
    },
  })

  it("prefills a simple weekly chore and sends it back unchanged", () => {
    const { values } = valuesFromChore(chore({}), context)
    expect(values).toMatchObject({ often: "WEEKLY", anchorWeekday: "MO", dueTime: "19:30" })
    expect(moreLabel(values, true)).toBe("High · Light · 5 min")
    expect(requestFor(values)).toMatchObject({
      title: "Take out garbage",
      description: "Bags under the sink",
      categoryId: "cat-trash",
      defaultPriority: "HIGH",
      requiresVerification: true,
      schedule: {
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
        startsOn: "2026-10-05",
        participantUserIds: ["rubayet", "farhan"],
      },
    })
  })

  it("shows a rule the simple options can't express as Custom and round-trips it", () => {
    const parsed = valuesFromChore(
      chore({ recurrenceRule: "FREQ=MONTHLY;BYDAY=-1FR", endsOn: "2027-06-30" }),
      context,
    ).values
    expect(oftenLabel(parsed)).toBe("Custom · Monthly on the last Friday, until Jun 30, 2027")
    expect(requestFor(parsed).schedule).toMatchObject({
      recurrenceRule: "FREQ=MONTHLY;BYDAY=-1FR",
      endsOn: "2027-06-30",
    })

    const unparseable = valuesFromChore(
      chore({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1", endsOn: "2027-01-01" }),
      context,
    ).values
    expect(oftenLabel(unparseable)).toBe("Custom")
    expect(requestFor(unparseable).schedule).toMatchObject({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1",
      endsOn: "2027-01-01",
    })
    // Picking anything else replaces it.
    expect(requestFor(withOften(unparseable, "DAILY")).schedule).toMatchObject({
      recurrenceRule: "FREQ=DAILY",
      endsOn: null,
    })
  })

  it("prefills open-copy kinds and drops members who left", () => {
    const { values, removedMembers } = valuesFromChore(
      chore({
        kind: "AS_NEEDED",
        recurrenceRule: null,
        backstopDays: null,
        dueTime: null,
        participantUserIds: ["gone", "abu", "farhan"],
      }),
      context,
    )
    expect(removedMembers).toBe(1)
    expect(values).toMatchObject({
      often: "AS_NEEDED",
      backstopEnabled: false,
      who: "TURNS",
      participants: ["abu", "farhan"],
    })
    expect(oftenLabel(values)).toBe("When needed · No deadline")
  })

  it("lowers a saved group to the people left and says so", () => {
    const rotation = valuesFromChore(
      chore({ peopleNeeded: 3, participantUserIds: ["farhan", "gone", "abu"] }),
      context,
    )
    expect(rotation.shortfall).toEqual({ needed: 3, left: 2 })
    expect(requestFor(rotation.values).schedule).toMatchObject({
      peopleNeeded: 2,
      participantUserIds: ["farhan", "abu"],
    })
    const group = valuesFromChore(
      chore({
        assignmentStrategy: "FIXED",
        peopleNeeded: 3,
        participantUserIds: ["farhan", "gone", "abu"],
      }),
      context,
    )
    expect(group.shortfall).toEqual({ needed: 3, left: 2 })
    expect(whoLabel(group.values, members, "farhan")).toBe("Farhan & Abubakar")
    expect(requestFor(group.values).schedule).toMatchObject({ peopleNeeded: 2 })
  })

  it("keeps a someone-specific person", () => {
    const someone = valuesFromChore(
      chore({
        assignmentStrategy: "FIXED",
        fixedAssigneeUserId: "rubayet",
        participantUserIds: [],
      }),
      context,
    ).values
    expect(whoLabel(someone, members, "farhan")).toBe("Rubayet")
  })
})

describe("Balanced", () => {
  const four = [...members, { userId: "sam", displayName: "Sam" }]

  it("labels the Who row and writes the summary", () => {
    const balanced = withField(named(), "who", {
      who: "BALANCED",
      participants: four.map((member) => member.userId),
    })
    expect(whoLabel(balanced, four, "farhan")).toBe("Balanced · everyone")
    expect(whoLabel(withParticipants(balanced, ["farhan", "rubayet"], four), four, "farhan")).toBe(
      "Balanced · 2 people",
    )
    expect(
      summaryParts(balanced, four, "guest")
        .map((part) => part.text)
        .join(""),
    ).toBe(
      "Every week on Saturday by 6 PM. Goes to whoever has done the least work lately, among Farhan, Rubayet, Abubakar and Sam.",
    )
    const two = withField(balanced, "who", { peopleNeeded: 2 })
    expect(whoLabel(two, four, "farhan")).toBe("Balanced · 2 at a time")
    expect(text(two, four)).toBe(
      "Every week on Saturday by 6 PM. Goes to the two who have done the least work lately, among you, Rubayet, Abubakar and Sam.",
    )
  })

  it("maps to BALANCED with one or two each time, both ways", () => {
    for (const peopleNeeded of [1, 2]) {
      const values = withField(named(), "who", { who: "BALANCED", peopleNeeded })
      const schedule = requestFor(values).schedule
      expect(schedule).toMatchObject({
        assignmentStrategy: "BALANCED",
        peopleNeeded,
        fixedAssigneeUserId: null,
        participantUserIds: ["farhan", "rubayet", "abu"],
      })
      const loaded = valuesFromChore(
        { ...savedChore, schedule: { ...savedChore.schedule!, ...schedule, active: true } },
        context,
      )
      expect(loaded.values).toMatchObject({ who: "BALANCED", peopleNeeded })
      expect(requestFor(loaded.values).schedule).toMatchObject(schedule)
    }
  })

  it("works with After it's done, one at a time", () => {
    let values = withField(named(), "who", { who: "BALANCED", peopleNeeded: 2 })
    values = withOften(values, "AFTER_COMPLETION")
    expect(values.who).toBe("BALANCED")
    expect(requestFor(values).schedule).toMatchObject({
      kind: "AFTER_COMPLETION",
      assignmentStrategy: "BALANCED",
      peopleNeeded: 1,
    })
  })

  it("is never paired with When it's needed, which keeps its turns", () => {
    const values = withOften(withField(named(), "who", { who: "BALANCED" }), "AS_NEEDED")
    expect(values.who).toBe("TURNS")
    expect(requestFor(values).schedule).toMatchObject({ assignmentStrategy: "ROUND_ROBIN" })
  })
})

describe("Week by week and everyone", () => {
  const weekly = (weeks = 2) =>
    withField(withOften(named("Wash dishes"), "DAILY", { dueTime: "21:00" }), "who", {
      who: "WEEKS",
      rotationWeeks: weeks,
    })

  it("maps Week by week to a Take turns rotation with a length, both ways", () => {
    const schedule = requestFor(weekly()).schedule
    expect(schedule).toMatchObject({
      assignmentStrategy: "ROUND_ROBIN",
      peopleNeeded: 1,
      participantUserIds: ["farhan", "rubayet", "abu"],
      everyone: true,
      rotationWeeks: 2,
    })
    const loaded = valuesFromChore(
      { ...savedChore, schedule: { ...schedule, active: true, everyone: true } },
      context,
    )
    expect(loaded.values).toMatchObject({ who: "WEEKS", rotationWeeks: 2, everyone: true })
    expect(requestFor(loaded.values).schedule).toMatchObject(schedule)
    expect(whoLabel(loaded.values, members, "farhan")).toBe("Week by week · 2 weeks")
    expect(whoLabel(weekly(1), members, "farhan")).toBe("Week by week · 1 week")
  })

  it("leaves Take turns as it was", () => {
    const loaded = valuesFromChore(
      {
        ...savedChore,
        schedule: { ...requestFor(named()).schedule, rotationWeeks: null, active: true },
      },
      context,
    )
    expect(loaded.values.who).toBe("TURNS")
    expect(requestFor(loaded.values).schedule).toMatchObject({
      assignmentStrategy: "ROUND_ROBIN",
      rotationWeeks: null,
    })
  })

  it("says who has it and for how long", () => {
    expect(text(weekly())).toBe(
      "Every day by 9 PM. Week by week: each person has it for 2 weeks, between you, Rubayet and Abubakar.",
    )
    expect(weeksExplanation(1)).toEqual({
      title: "One person all week, then the next",
      detail:
        "Good when someone should own it: dishes, the kitchen, the bathroom. Switches on Mondays.",
    })
    expect(weeksExplanation(3).title).toBe("One person for 3 weeks, then the next")
  })

  it("falls back to Take turns for chores that don't repeat on a schedule", () => {
    for (const often of ["AFTER_COMPLETION", "AS_NEEDED", "ONCE"] as const) {
      expect(withOften(weekly(), often).who).toBe("TURNS")
      expect(allowsWeekByWeek(often)).toBe(false)
    }
    expect(allowsWeekByWeek("WEEKLY")).toBe(true)
  })

  it("rejects a length outside 1 to 8 weeks", () => {
    const result = buildQuickRequest(weekly(9), context)
    expect(result).toEqual({
      error: { field: "who", message: "Choose between 1 and 8 weeks for each person." },
    })
  })

  it("is everyone by default, a fixed list after Change, and a saved list stays a list", () => {
    const fresh = named()
    expect(fresh.everyone).toBe(true)
    expect(whoLabel(fresh, members, "farhan")).toBe("Take turns · everyone")
    const changed = withParticipants(fresh, ["farhan", "rubayet", "abu"], members)
    expect(changed.everyone).toBe(false)
    expect(requestFor(changed).schedule.everyone).toBeNull()
    expect(whoLabel(changed, members, "farhan")).toBe("Take turns · 3 people")
    const saved = valuesFromChore(
      { ...savedChore, schedule: { ...requestFor(changed).schedule, active: true } },
      context,
    )
    expect(saved.values.everyone).toBe(false)
  })
})

describe("steps (E12)", () => {
  it("fills a matching suggestion's steps on create and stops once the user edits them", () => {
    const named = withTitle(initialQuickValues(context), "clean the fridge", categories)
    expect(named.steps.map((step) => step.text)).toEqual(suggestion("Clean the fridge").steps)
    expect(named.steps.every((step) => step.suggested && step.id === null)).toBe(true)
    expect(withTitle(named, "Clean the fridge door", categories).steps).toEqual([])
    const edited = removeStep(named, named.steps[0].key)
    expect(withTitle(edited, "Laundry", categories).steps).toHaveLength(4)
    expect(applySuggestion(edited, suggestion("Laundry"), categories, context).steps).toHaveLength(
      4,
    )
    expect(clearSuggestedSteps(named).steps).toEqual([])
  })

  it("maps a saved chore's steps with their ids and never replaces them", () => {
    const chore: Chore = {
      ...savedChore,
      title: "Clean bathroom",
      steps: [
        { id: "s-1", text: "Mirror" },
        { id: "s-2", text: "Sink" },
      ],
    }
    const loaded = valuesFromChore(chore, context).values
    expect(loaded.steps.map(({ id, text }) => ({ id, text }))).toEqual(chore.steps)
    expect(loaded.stepsEdited).toBe(true)
    // The saved steps on an otherwise complete form (the fixture's schedule is partial).
    const values = { ...named("Clean bathroom"), steps: loaded.steps, stepsEdited: true }
    const renamed = renameStep(
      withTitle(values, "Laundry", categories),
      values.steps[1].key,
      "Taps",
    )
    const moved = moveStep(addStep(renamed, " Floor "), renamed.steps[1].key, 0)
    const result = buildQuickRequest(moved, context)
    if ("error" in result) throw new Error(result.error.message)
    expect(result.request.steps).toEqual([
      { id: "s-2", text: "Taps" },
      { id: "s-1", text: "Mirror" },
      { id: null, text: "Floor" },
    ])
    expect(moreLabel(moved, true)).toContain("3 steps")
    // A copy is a new chore with new steps.
    expect(copyValues(chore, context).values.steps.every((step) => step.id === null)).toBe(true)
  })

  it("caps steps at 15 and 80 characters and reports blank ones", () => {
    let values = initialQuickValues(context)
    for (let index = 0; index < 16; index++) values = addStep(values, `Step ${index}`)
    expect(values.steps).toHaveLength(15)
    expect(addStep(values, "One more")).toBe(values)
    expect(addStep(initialQuickValues(context), "x".repeat(90)).steps[0].text).toHaveLength(80)
    expect(stepsError([{ key: "k", id: null, text: "  ", suggested: false }])).toBe(
      "Enter a step, or remove it.",
    )
    const blank = renameStep(addStep(named("Sweep"), "Porch"), "missing", "")
    expect(stepsError(blank.steps)).toBeNull()
  })
})
