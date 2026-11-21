import { describe, expect, it } from "vitest"
import {
  POPULAR_POST_SUGGESTIONS,
  POST_SUGGESTIONS,
  choreHintFor,
  describePostSuggestion,
  matchPostSuggestions,
} from "./post-suggestions"

describe("post suggestions", () => {
  it("has about 25 distinct built-ins and the seven chips from the empty form", () => {
    expect(POST_SUGGESTIONS.length).toBeGreaterThanOrEqual(24)
    expect(new Set(POST_SUGGESTIONS.map((suggestion) => suggestion.title)).size).toBe(
      POST_SUGGESTIONS.length,
    )
    expect(POPULAR_POST_SUGGESTIONS.map((suggestion) => suggestion.title)).toEqual([
      "Pest control visit",
      "Maintenance visit",
      "Water or power outage",
      "Guests staying",
      "Package arrived",
      "Something's broken",
      "Quiet please",
    ])
    expect(POPULAR_POST_SUGGESTIONS.every(Boolean)).toBe(true)
  })

  it("offers up to three matches, word starts first, each with its type", () => {
    const matches = matchPostSuggestions("  wat ")
    expect(matches.map((match) => match.suggestion.title)).toEqual([
      "Water or power outage",
      "Water shut-off",
      "Water heater being serviced",
    ])
    expect(matches[0]).toMatchObject({ before: "", match: "Wat", after: "er or power outage" })
    expect(describePostSuggestion(matches[1].suggestion)).toBe("Event · add the date and time")
    expect(describePostSuggestion(matchPostSuggestions("leak")[0].suggestion)).toBe(
      "Problem · stays until fixed",
    )
    // A word start beats a match inside a word.
    expect(matchPostSuggestions("ar", 5)[0].suggestion.title).toBe("Package arrived")
    expect(matchPostSuggestions("").length).toBe(0)
    // Nothing left to suggest once the title is exactly a suggestion.
    expect(matchPostSuggestions("Quiet please")).toEqual([])
  })

  it("spots text that sounds like a built-in chore", () => {
    expect(choreHintFor("wat")).toBe("Water plants")
    expect(choreHintFor("Please take out garbage tonight")).toBe("Take out garbage")
    expect(choreHintFor("wa")).toBeNull()
    expect(choreHintFor("Pest control visit")).toBeNull()
    expect(choreHintFor("Water leak")).toBeNull()
    expect(choreHintFor("Package arrived")).toBeNull()
  })
})
