import { describe, expect, it } from "vitest"
import type { Chore } from "./chores"
import { BASICS, basicsOften, basicsRequests, showBasics } from "./basics"
import { copyValues, type QuickContext } from "./chore-quick-form"

const context: QuickContext = {
  viewerId: "farhan",
  members: [{ userId: "farhan", displayName: "Farhan" }],
  timezone: "America/Halifax",
  today: "2026-11-14",
}
const categories = [
  { id: "cat-kitchen", name: "kitchen" },
  { id: "cat-trash", name: "Trash" },
  { id: "cat-bath", name: "Bathroom" },
]

describe("Start with the basics", () => {
  it("shows only once the household is known to have no chores", () => {
    expect(showBasics(false)).toBe(true)
    expect(showBasics(true)).toBe(false)
    expect(showBasics(undefined)).toBe(false)
    expect(showBasics(null)).toBe(false)
  })

  it("lists the four basics with how often they're done", () => {
    expect(BASICS.map((suggestion) => [suggestion.title, basicsOften(suggestion)])).toEqual([
      ["Wash dishes", "Every day"],
      ["Take out garbage", "When it's needed"],
      ["Clean bathroom", "Every week"],
      ["Vacuum", "Every week"],
    ])
  })

  it("builds each from its suggestion, taking turns between everyone, categories by name", () => {
    const requests = basicsRequests(context, categories)
    expect(requests.map((request) => request.title)).toEqual([
      "Wash dishes",
      "Take out garbage",
      "Clean bathroom",
      "Vacuum",
    ])
    for (const request of requests) {
      expect(request.schedule).toMatchObject({
        assignmentStrategy: "ROUND_ROBIN",
        everyone: true,
        participantUserIds: ["farhan"],
        peopleNeeded: 1,
        rotationWeeks: null,
      })
    }
    expect(requests.map((request) => request.categoryId)).toEqual([
      "cat-kitchen",
      "cat-trash",
      "cat-bath",
      null,
    ])
    expect(requests[0].schedule).toMatchObject({ recurrenceRule: "FREQ=DAILY", dueTime: "21:00" })
    expect(requests[1].schedule).toMatchObject({ kind: "AS_NEEDED", backstopDays: 2 })
  })
})

describe("copyValues", () => {
  it("copies a chore's setup as a new one, titled as a copy and starting no earlier than today", () => {
    const chore: Chore = {
      id: "chore-1",
      householdId: "home-1",
      categoryId: "cat-kitchen",
      title: "Wash dishes",
      description: null,
      defaultPriority: "HIGH",
      difficulty: 2,
      estimatedMinutes: 15,
      requiresVerification: false,
      active: true,
      archivedAt: null,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      schedule: {
        recurrenceRule: "FREQ=DAILY",
        timezone: "America/Halifax",
        startsOn: "2026-10-01",
        endsOn: null,
        dueTime: "21:00:00",
        assignmentStrategy: "ROUND_ROBIN",
        peopleNeeded: 1,
        fixedAssigneeUserId: null,
        participantUserIds: ["farhan"],
        active: true,
        kind: "CALENDAR",
        everyone: true,
        rotationWeeks: 2,
      },
    }
    const copy = copyValues(chore, context).values
    expect(copy).toMatchObject({
      title: "Wash dishes (copy)",
      categoryId: "cat-kitchen",
      priority: "HIGH",
      often: "DAILY",
      who: "WEEKS",
      rotationWeeks: 2,
      everyone: true,
      startsOn: "2026-11-14",
    })
  })
})
