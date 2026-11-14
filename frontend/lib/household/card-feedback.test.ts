import { describe, expect, it } from "vitest"
import { cardFeedback, feedbackFor, unplacedFeedbackError } from "./card-feedback"

const calendar = { id: "a1", choreId: "c1", kind: "CALENDAR" as const, status: "PENDING" as const }
const nextDay = { ...calendar, id: "a2" }
const job = { id: "j1", choreId: "c2", kind: "AS_NEEDED" as const, status: "PENDING" as const }
const nextJob = { ...job, id: "j2" }

describe("card feedback", () => {
  it("belongs to its own card, and follows an open-copy chore to its next copy", () => {
    const onCalendar = cardFeedback(calendar, "Choose today or a later day.")
    expect(feedbackFor(calendar, onCalendar, "card")?.message).toBe("Choose today or a later day.")
    // Another day of the same calendar chore is a different card.
    expect(feedbackFor(nextDay, onCalendar, "card")).toBeUndefined()
    const onJob = cardFeedback(job, "Already done by Ben.", "error", "job")
    expect(feedbackFor(nextJob, onJob, "job")?.tone).toBe("error")
    // A flagged job is also on Home as a Needs attention card; only the pressed card shows it.
    expect(feedbackFor(job, onJob, "card")).toBeUndefined()
  })

  it("falls back to the page banner only when no card on screen can show an error", () => {
    const error = cardFeedback(calendar, "Unable to complete this chore. Please try again.")
    expect(unplacedFeedbackError([{ surface: "card", assignments: [calendar] }], error)).toBeNull()
    expect(unplacedFeedbackError([{ surface: "card", assignments: [nextDay] }], error)).toBe(
      "Unable to complete this chore. Please try again.",
    )
    expect(unplacedFeedbackError([], cardFeedback(job, "Flagged.", "success", "job"))).toBeNull()
  })
})
