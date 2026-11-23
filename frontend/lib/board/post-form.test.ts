import { describe, expect, it } from "vitest"
import type { BoardMember } from "./api"
import {
  applyPostSuggestion,
  buildPostRequest,
  choreDueForEvent,
  initialPostValues,
  postSummary,
  summaryText,
  withPostField,
  type PostFormValues,
} from "./post-form"
import { POST_SUGGESTIONS } from "./post-suggestions"

const members: BoardMember[] = [
  { userId: "me", displayName: "Farhan", role: "OWNER" },
  { userId: "ana", displayName: "Ana", role: "MEMBER" },
  { userId: "ben", displayName: "Ben", role: "MEMBER" },
]
// Monday, November 23 2026, 10 AM in UTC.
const MONDAY = new Date("2026-11-23T10:00:00Z")

function values(patch: Partial<PostFormValues>): PostFormValues {
  return { ...initialPostValues(), title: "Something", ...patch }
}

const summary = (patch: Partial<PostFormValues>, now = MONDAY) =>
  summaryText(postSummary(values(patch), members, "me", "UTC", now))

describe("post summary", () => {
  it("names the reminders an event gets: the evening before and that morning", () => {
    expect(summary({ type: "EVENT", eventDate: "2026-11-26" })).toBe(
      "Everyone gets it now, then a reminder Wed evening and Thu morning.",
    )
    // The evening before has passed: only the morning one is left.
    expect(
      summary({ type: "EVENT", eventDate: "2026-11-24" }, new Date("2026-11-23T20:00:00Z")),
    ).toBe("Everyone gets it now, then a reminder Tue morning.")
    expect(summary({ type: "EVENT", eventDate: "2026-11-24" })).toBe(
      "Everyone gets it now, then a reminder this evening and Tue morning.",
    )
  })

  it("says how long problems and heads-ups stay, and who hears about them", () => {
    expect(summary({ type: "PROBLEM" })).toBe(
      "Everyone gets it now. It stays at the top of the board until someone marks it fixed.",
    )
    expect(summary({ type: "HEADS_UP", notifyMode: "PICKED", recipients: ["ana"] })).toBe(
      "Only Ana gets a notification. Everyone can still see it on the board for 7 days.",
    )
    expect(summary({ type: "HEADS_UP", notifyMode: "PICKED", recipients: ["ana", "ben"] })).toBe(
      "Only Ana and Ben get a notification. Everyone can still see it on the board for 7 days.",
    )
    expect(summary({ type: "EVENT", eventDate: "2026-11-26", notifyMode: "NONE" })).toBe(
      "No one gets a notification or reminders. Everyone can still see it on the board.",
    )
    expect(summary({ type: "HEADS_UP", pinned: true })).toBe(
      "Everyone gets it now. It stays pinned under House info.",
    )
  })

  it("bolds who gets it and how long it stays", () => {
    const parts = postSummary(values({ type: "PROBLEM" }), members, "me", "UTC", MONDAY)
    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      "Everyone",
      "until someone marks it fixed",
    ])
  })
})

describe("post form values", () => {
  it("lets a suggestion fill the type and details only until the user changes them", () => {
    const pest = POST_SUGGESTIONS.find((suggestion) => suggestion.title === "Pest control visit")!
    const filled = applyPostSuggestion(initialPostValues(), pest)
    expect(filled).toMatchObject({ title: "Pest control visit", type: "EVENT" })
    expect(filled.details).toContain("sinks")

    const mine = withPostField(
      withPostField(initialPostValues(), "type", { type: "HEADS_UP" }),
      "details",
      { details: "My own words" },
    )
    expect(applyPostSuggestion(mine, pest)).toMatchObject({
      title: "Pest control visit",
      type: "HEADS_UP",
      details: "My own words",
    })
  })

  it("saves an undecided type as a heads-up and checks what each type needs", () => {
    const result = buildPostRequest(values({ title: "  Quiet tonight " }), "UTC", null, MONDAY)
    expect(result).toEqual({
      request: {
        type: "HEADS_UP",
        title: "Quiet tonight",
        details: null,
        eventDate: null,
        startTime: null,
        endTime: null,
        pinned: false,
        notifyMode: "EVERYONE",
        recipientUserIds: [],
        urgent: false,
      },
    })
    const error = (patch: Partial<PostFormValues>) => {
      const built = buildPostRequest(values(patch), "UTC", null, MONDAY)
      return "error" in built ? built.error.message : null
    }
    expect(error({ title: " " })).toBe("Enter what's happening.")
    expect(error({ type: "EVENT" })).toBe("Choose a date for this event.")
    expect(error({ type: "EVENT", eventDate: "2026-11-22" })).toBe("Choose today or a later date.")
    expect(error({ type: "EVENT", eventDate: "2026-11-24", endTime: "12:00" })).toBe(
      "Add a start time first.",
    )
    expect(error({ notifyMode: "PICKED" })).toBe("Pick at least one person to notify.")
  })

  it("dues a chore made from an event at 6 PM the day before, or today once that has passed", () => {
    expect(choreDueForEvent("2026-11-26", "UTC", MONDAY)).toEqual({
      date: "2026-11-25",
      time: "18:00",
    })
    expect(choreDueForEvent("2026-11-23", "UTC", MONDAY)).toEqual({
      date: "2026-11-23",
      time: "18:00",
    })
  })
})
