import { describe, expect, it } from "vitest"
import { COMMON_ITEMS, itemSuggestions } from "./item-suggestions"

const names = (typed: string, recent: string[] = [], exclude: string[] = []) =>
  itemSuggestions(typed, recent, exclude).map((suggestion) => suggestion.name)

describe("item suggestions", () => {
  it("has about 80 common items across groceries, cleaning, toiletries, kitchen and laundry", () => {
    const all = Object.values(COMMON_ITEMS).flat()
    expect(all.length).toBeGreaterThanOrEqual(75)
    expect(new Set(all.map((name) => name.toLowerCase())).size).toBe(all.length)
  })

  it("suggests up to three built-in items, with the matched part split out for bold", () => {
    expect(itemSuggestions("dish", [])).toEqual([
      { name: "Dish soap", before: "", match: "Dish", after: " soap", source: "common" },
      {
        name: "Dishwasher pods",
        before: "",
        match: "Dish",
        after: "washer pods",
        source: "common",
      },
      { name: "Dish sponges", before: "", match: "Dish", after: " sponges", source: "common" },
    ])
    expect(names("")).toEqual([])
    expect(names("zzz")).toEqual([])
  })

  it("matches a later word after names that start with it", () => {
    const soap = itemSuggestions("soap", [])
    expect(soap.map((suggestion) => suggestion.name)).toEqual(["Dish soap", "Hand soap"])
    expect(soap[0]).toMatchObject({ before: "Dish ", match: "soap", after: "" })
  })

  it("puts the household's own names first, most recent first, without duplicates", () => {
    expect(names("mi", ["Mint tea", "milk"])).toEqual(["Mint tea", "milk"])
    expect(names("d", ["Diapers"])).toEqual(["Diapers", "Dish soap", "Dishwasher pods"])
    expect(names("bread", ["bread rolls", "Bread"])).toEqual(["bread rolls"])
  })

  it("leaves out what's typed exactly and names already open on the list", () => {
    expect(names("milk")).toEqual([])
    expect(names("dish", [], ["dish SOAP"])).toEqual(["Dishwasher pods", "Dish sponges"])
  })
})
