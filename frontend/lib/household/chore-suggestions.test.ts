import { describe, expect, it } from "vitest"
import {
  CHORE_SUGGESTIONS,
  POPULAR_SUGGESTIONS,
  describeSuggestion,
  findCategoryByName,
  guessCategoryName,
  matchSuggestions,
} from "./chore-suggestions"

describe("chore suggestions", () => {
  it("matches up to three titles case-insensitively, word starts first, and splits the match", () => {
    const matches = matchSuggestions("GARB")
    expect(matches.map((match) => match.suggestion.title)).toEqual([
      "Take out garbage",
      "Garbage bins to the curb",
      "Clean garbage bin",
    ])
    expect(matches[0]).toMatchObject({ before: "Take out ", match: "garb", after: "age" })
    expect(matches[1]).toMatchObject({ before: "", match: "Garb", after: "age bins to the curb" })
  })

  it("puts a match inside a word after word-start matches", () => {
    const titles = matchSuggestions("ash").map((match) => match.suggestion.title)
    // "Wash dishes" contains "ash" mid-word; nothing starts a word with it.
    expect(titles[0]).toBe("Wash dishes")
    expect(matchSuggestions("ash", 10).every((match) => match.match.toLowerCase() === "ash")).toBe(
      true,
    )
  })

  it("returns nothing for blank or unknown text", () => {
    expect(matchSuggestions("   ")).toEqual([])
    expect(matchSuggestions("zzz")).toEqual([])
    expect(matchSuggestions("  vacuum ")).toHaveLength(1)
  })

  it("has about thirty full setups and six popular chips", () => {
    expect(CHORE_SUGGESTIONS.length).toBeGreaterThanOrEqual(28)
    expect(new Set(CHORE_SUGGESTIONS.map((suggestion) => suggestion.title)).size).toBe(
      CHORE_SUGGESTIONS.length,
    )
    expect(POPULAR_SUGGESTIONS.map((suggestion) => suggestion?.title)).toEqual([
      "Take out garbage",
      "Wash dishes",
      "Vacuum",
      "Laundry",
      "Clean bathroom",
      "Water plants",
    ])
    const defaults = ["Kitchen", "Bathroom", "Laundry", "Trash", "Cleaning", "General"]
    for (const suggestion of CHORE_SUGGESTIONS) {
      expect(defaults).toContain(suggestion.category)
      expect(suggestion.difficulty).toBeGreaterThanOrEqual(1)
      expect(suggestion.difficulty).toBeLessThanOrEqual(5)
      // "Mix it up" can't be used for chores done when needed.
      if (suggestion.often.type === "AS_NEEDED") expect(suggestion.who).not.toBe("RANDOM")
    }
  })

  it("describes a suggestion's setup in a short line", () => {
    const find = (title: string) => CHORE_SUGGESTIONS.find((item) => item.title === title)!
    expect(describeSuggestion(find("Take out garbage"))).toBe(
      "When it's needed · turns · at least every 2 days",
    )
    expect(describeSuggestion(find("Garbage bins to the curb"))).toBe("Every week on Tue · turns")
    expect(describeSuggestion(find("Clean garbage bin"))).toBe("Every month · turns")
  })
})

describe("category guess", () => {
  it.each([
    ["Take out the garbage", "Trash"],
    ["Empty TRASH", "Trash"],
    ["Recycling day", "Trash"],
    ["Wash dishes", "Kitchen"],
    ["Clean the fridge", "Kitchen"],
    ["Wipe counters", "Kitchen"],
    ["Scrub the toilet", "Bathroom"],
    ["Shower glass", "Bathroom"],
    ["Clean bathroom", "Bathroom"],
    ["Fold clothes", "Laundry"],
    ["Wash towels", "Laundry"],
    ["Vacuum stairs", "Cleaning"],
    ["Mop", "Cleaning"],
    ["Dust shelves", "Cleaning"],
    ["Sweep porch", "Cleaning"],
  ])("guesses %s as %s", (title, category) => {
    expect(guessCategoryName(title)).toBe(category)
  })

  it("leaves unknown or blank names without a guess", () => {
    expect(guessCategoryName("Walk the dog")).toBeNull()
    expect(guessCategoryName("   ")).toBeNull()
  })

  it("matches categories by name, ignoring case and spaces", () => {
    const categories = [
      { id: "a", name: "kitchen " },
      { id: "b", name: "Trash" },
    ]
    expect(findCategoryByName(categories, "Kitchen")?.id).toBe("a")
    expect(findCategoryByName(categories, "TRASH")?.id).toBe("b")
    expect(findCategoryByName(categories, "Laundry")).toBeNull()
    expect(findCategoryByName(categories, null)).toBeNull()
  })
})
