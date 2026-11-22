import { describe, expect, it } from "vitest"
import type { BoardList, BoardListItem } from "./api"
import {
  boughtSummary,
  chooseList,
  claimLabel,
  listNameError,
  shoppingSubtitle,
  showShoppingRow,
  sortOpenItems,
  withItemCounts,
} from "./list-view"

function item(name: string, overrides: Partial<BoardListItem> = {}): BoardListItem {
  return {
    id: name.toLowerCase(),
    listId: "shopping",
    name,
    note: null,
    addedByUserId: "me",
    addedByDisplayName: "Farhan",
    claimedByUserId: null,
    claimedByDisplayName: null,
    neededToday: false,
    neededTodayByDisplayName: null,
    boughtAt: null,
    boughtByUserId: null,
    boughtByDisplayName: null,
    createdAt: "2026-11-21T10:00:00Z",
    ...overrides,
  }
}

const list = (id: string, name: string, overrides: Partial<BoardList> = {}): BoardList => ({
  id,
  name,
  defaultList: false,
  openCount: 0,
  todayCount: 0,
  createdAt: "2026-11-01T00:00:00Z",
  ...overrides,
})

describe("list view", () => {
  it("labels claims for the viewer and for others", () => {
    expect(claimLabel(item("Milk"), "me")).toBeNull()
    expect(claimLabel(item("Milk", { claimedByUserId: "me" }), "me")).toBe("You're getting it")
    expect(
      claimLabel(item("Oil", { claimedByUserId: "r", claimedByDisplayName: "Rubayet" }), "me"),
    ).toBe("Rubayet's on it")
  })

  it("puts needed-today items first, then the order they were added", () => {
    const sorted = sortOpenItems([
      item("Milk", { createdAt: "2026-11-21T09:00:00Z" }),
      item("Eggs", { createdAt: "2026-11-21T08:00:00Z" }),
      item("Toilet paper", { neededToday: true, createdAt: "2026-11-21T11:00:00Z" }),
    ])
    expect(sorted.map((entry) => entry.name)).toEqual(["Toilet paper", "Eggs", "Milk"])
  })

  it("collapses bought items into one line", () => {
    expect(boughtSummary([])).toBeNull()
    expect(boughtSummary([item("Paper towels"), item("Rice")])).toBe(
      "2 bought today · Paper towels, Rice",
    )
    expect(boughtSummary(["A", "B", "C", "D", "E"].map((name) => item(name)))).toBe(
      "5 bought today · A, B, C and 2 more",
    )
  })

  it("summarises Shopping for Home and hides the row when it's empty", () => {
    expect(shoppingSubtitle({ openCount: 5, todayCount: 1 })).toBe("5 items · 1 needed today")
    expect(shoppingSubtitle({ openCount: 1, todayCount: 0 })).toBe("1 item")
    expect(showShoppingRow({ listId: "s", openCount: 0, todayCount: 0 })).toBe(false)
    expect(showShoppingRow({ listId: "s", openCount: 2, todayCount: 0 })).toBe(true)
    expect(showShoppingRow(undefined)).toBe(false)
  })

  it("keeps the counts in step when an item is added, flagged or bought", () => {
    const shopping = list("shopping", "Shopping", { openCount: 2, todayCount: 1 })
    const milk = item("Milk")
    expect(withItemCounts(shopping, null, milk)).toMatchObject({ openCount: 3, todayCount: 1 })
    expect(withItemCounts(shopping, milk, { ...milk, neededToday: true })).toMatchObject({
      openCount: 2,
      todayCount: 2,
    })
    const flagged = { ...milk, neededToday: true }
    expect(
      withItemCounts(shopping, flagged, { ...flagged, boughtAt: "2026-11-21T12:00:00Z" }),
    ).toMatchObject({ openCount: 1, todayCount: 0 })
  })

  it("chooses the requested list, then the remembered one, then Shopping", () => {
    const lists = [list("party", "Party"), list("shopping", "Shopping", { defaultList: true })]
    expect(chooseList(lists, "party", "shopping")?.id).toBe("party")
    expect(chooseList(lists, "gone", "party")?.id).toBe("party")
    expect(chooseList(lists, null, "gone")?.id).toBe("shopping")
    expect(chooseList([], null, null)).toBeNull()
  })

  it("checks list names like the server", () => {
    const lists = [list("party", "Party Saturday")]
    expect(listNameError(" ", lists)).toBe("Enter a name for the list.")
    expect(listNameError("x".repeat(41), lists)).toBe("Keep list names to 40 characters.")
    expect(listNameError(" party saturday", lists)).toBe(
      "There's already a list called Party Saturday.",
    )
    expect(listNameError("Party Saturday", lists, "party")).toBeNull()
  })
})
