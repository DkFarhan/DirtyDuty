// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BoardList, BoardListItem } from "@/lib/board/api"

const mocks = vi.hoisted(() => ({
  lists: vi.fn(),
  items: vi.fn(),
  recentNames: vi.fn(),
  add: vi.fn(),
  claim: vi.fn(),
  buy: vi.fn(),
  unbuy: vi.fn(),
  create: vi.fn(),
  archive: vi.fn(),
  onChanged: vi.fn(),
}))

vi.mock("@/lib/board/api", () => ({
  boardListApi: {
    lists: mocks.lists,
    items: mocks.items,
    recentNames: mocks.recentNames,
    add: mocks.add,
    claim: mocks.claim,
    buy: mocks.buy,
    unbuy: mocks.unbuy,
    create: mocks.create,
    archive: mocks.archive,
  },
}))

import { BoardListsView } from "./board-lists-view"
import { BoardScreenView } from "./board-screen-view"
import { HomeBoardSection } from "./home-board-section"
import { UNDO_MS, useBoardLists } from "./use-board-lists"

const shopping: BoardList = {
  id: "shopping",
  name: "Shopping",
  defaultList: true,
  openCount: 1,
  todayCount: 0,
  createdAt: "2026-11-01T00:00:00Z",
}

function item(name: string, overrides: Partial<BoardListItem> = {}): BoardListItem {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    listId: "shopping",
    name,
    note: null,
    addedByUserId: "ana",
    addedByDisplayName: "Ana",
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

function Harness() {
  const state = useBoardLists("home-1", {
    active: true,
    requestedListId: null,
    onChanged: mocks.onChanged,
  })
  return <BoardListsView state={state} theme="dark" viewerId="me" />
}

async function renderLists(items: BoardListItem[] = [item("Milk", { note: "2%, 2L" })]) {
  mocks.lists.mockResolvedValue({ lists: [shopping], toBuyCount: items.length })
  mocks.recentNames.mockResolvedValue([])
  mocks.items.mockResolvedValue({ list: shopping, items, boughtToday: [] })
  render(<Harness />)
  await screen.findByRole("textbox", { name: "Add to Shopping" })
  if (items.length > 0) await screen.findByRole("list", { name: "Shopping items" })
}

describe("Board lists", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("adds an item from a suggestion, with the typed part in bold", async () => {
    await renderLists()
    const soap = item("Dish soap", { addedByUserId: "me", addedByDisplayName: "Farhan" })
    mocks.add.mockResolvedValue({ item: soap, existing: false })

    fireEvent.change(screen.getByRole("textbox", { name: "Add to Shopping" }), {
      target: { value: "dish" },
    })
    const suggestions = screen.getByRole("list", { name: "Suggestions" })
    expect(
      within(suggestions)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Dish soap", "Dishwasher pods", "Dish sponges"])
    expect(within(suggestions).getAllByText("Dish", { selector: "strong" })).toHaveLength(3)

    fireEvent.click(screen.getByRole("button", { name: "Add Dish soap" }))
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith("home-1", "shopping", {
        name: "Dish soap",
        note: null,
      }),
    )
    const items = screen.getByRole("list", { name: "Shopping items" })
    expect(await within(items).findByText("Dish soap")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Shopping 2" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(screen.getByRole("textbox", { name: "Add to Shopping" })).toHaveProperty("value", "")
    expect(mocks.onChanged).toHaveBeenCalled()
  })

  it("highlights the item already on the list instead of adding it twice", async () => {
    await renderLists()
    mocks.add.mockResolvedValue({ item: item("Milk", { note: "2%, 2L" }), existing: true })
    fireEvent.change(screen.getByRole("textbox", { name: "Add to Shopping" }), {
      target: { value: "milk" },
    })
    fireEvent.submit(screen.getByRole("textbox", { name: "Add to Shopping" }).closest("form")!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-list-item="milk"]')?.hasAttribute("data-highlight"),
      ).toBe(true),
    )
    expect(screen.getAllByText("Milk")).toHaveLength(1)
    expect(mocks.onChanged).not.toHaveBeenCalled()
  })

  it("claims an item: I'll get it, then You're getting it", async () => {
    await renderLists([
      item("Milk"),
      item("Olive oil", { claimedByUserId: "ru", claimedByDisplayName: "Rubayet" }),
    ])
    expect(screen.getByText("Rubayet's on it")).toBeTruthy()
    mocks.claim.mockResolvedValue(
      item("Milk", { claimedByUserId: "me", claimedByDisplayName: "Farhan" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "I'll get it: Milk" }))
    expect(await screen.findByText("You're getting it")).toBeTruthy()
    expect(mocks.claim).toHaveBeenCalledWith("home-1", "milk")
  })

  it("marks an item bought at once, offers Undo for a few seconds, and Undo puts it back", async () => {
    await renderLists([item("Milk"), item("Rice")])
    let confirm: (value: BoardListItem) => void = () => undefined
    mocks.buy.mockReturnValue(
      new Promise<BoardListItem>((resolve) => {
        confirm = resolve
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Mark bought: Milk" }))

    // Optimistic: gone from the list, counted under bought today, with Undo.
    const items = screen.getByRole("list", { name: "Shopping items" })
    expect(within(items).queryByText("Milk")).toBeNull()
    expect(screen.getByRole("status").textContent).toContain("Milk bought")
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain(
      "1 bought today · Milk",
    )
    await act(async () => {
      confirm(
        item("Milk", {
          boughtAt: "2026-11-21T12:00:00Z",
          boughtByUserId: "me",
          boughtByDisplayName: "Farhan",
        }),
      )
    })

    mocks.unbuy.mockResolvedValue(item("Milk"))
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(within(items).getByText("Milk")).toBeTruthy())
    expect(mocks.unbuy).toHaveBeenCalledWith("home-1", "milk")
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByText(/bought today/)).toBeNull()
  })

  it("stops offering Undo after a few seconds", async () => {
    await renderLists([item("Milk")])
    mocks.buy.mockResolvedValue(item("Milk", { boughtAt: "2026-11-21T12:00:00Z" }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: "Mark bought: Milk" }))
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 10)
    })
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  it("makes a new list from a quick pick and switches to it", async () => {
    await renderLists()
    const party: BoardList = {
      ...shopping,
      id: "party",
      name: "Party",
      defaultList: false,
      openCount: 0,
    }
    mocks.create.mockResolvedValue(party)
    mocks.items.mockImplementation((_home: string, listId: string) =>
      Promise.resolve({
        list: listId === "party" ? party : shopping,
        items: listId === "party" ? [] : [item("Milk")],
        boughtToday: [],
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: "List" }))
    const card = screen.getByRole("region", { name: "New list" })
    expect(within(card).getByText("Everyone can add to and tick off any list.")).toBeTruthy()
    fireEvent.click(within(card).getByRole("button", { name: "Party" }))
    expect(within(card).getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Party")
    fireEvent.click(within(card).getByRole("button", { name: "Create list" }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("home-1", "Party"))
    expect(await screen.findByRole("textbox", { name: "Add to Party" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Party 0" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(await screen.findByText("Nothing on Party yet.")).toBeTruthy()
    expect(window.localStorage.getItem("dirtyduty.board.list.home-1")).toBe("party")
  })

  it("asks before archiving a list that still has items", async () => {
    const party: BoardList = {
      ...shopping,
      id: "party",
      name: "Party",
      defaultList: false,
      openCount: 2,
    }
    mocks.lists.mockResolvedValue({ lists: [shopping, party], toBuyCount: 3 })
    mocks.recentNames.mockResolvedValue([])
    mocks.items.mockImplementation((_home: string, listId: string) =>
      Promise.resolve({
        list: listId === "party" ? party : shopping,
        items: listId === "party" ? [item("Chips"), item("Ice")] : [item("Milk")],
        boughtToday: [],
      }),
    )
    mocks.archive.mockResolvedValue(undefined)
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: "Party 2" }))
    // Shopping has no options; a custom list does.
    expect(screen.queryByRole("button", { name: "Options for Shopping" })).toBeNull()
    fireEvent.click(await screen.findByRole("button", { name: "Options for Party" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Archive/ }))

    const confirm = screen.getByRole("dialog", { name: "Archive Party?" })
    expect(confirm.textContent).toContain("Party still has 2 items on it.")
    expect(mocks.archive).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Archive list" }))
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("home-1", "party"))
    expect(await screen.findByRole("textbox", { name: "Add to Shopping" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Party 2" })).toBeNull()
  })

  it("refuses a list name that's already used, without asking the server", async () => {
    await renderLists()
    fireEvent.click(screen.getByRole("button", { name: "List" }))
    const card = screen.getByRole("region", { name: "New list" })
    fireEvent.change(within(card).getByRole("textbox", { name: "Name" }), {
      target: { value: "shopping" },
    })
    fireEvent.click(within(card).getByRole("button", { name: "Create list" }))
    expect(within(card).getByRole("alert").textContent).toBe(
      "There's already a list called Shopping.",
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe("Lists on the Board header and Home", () => {
  afterEach(cleanup)

  it("shows To buy and the Lists tab, and switches tabs", () => {
    const onSelectTab = vi.fn()
    render(
      <BoardScreenView
        busyIds={[]}
        feedback={null}
        groups={{ houseInfo: [], needsFixing: [], comingUp: [], headsUps: [] }}
        householdName="Apt 1501"
        listsContent={<p>Lists here</p>}
        onCompose={vi.fn()}
        onFix={vi.fn()}
        onGotIt={vi.fn()}
        onMakeChore={vi.fn()}
        onNavigate={vi.fn()}
        onOpenPast={vi.fn()}
        onOpenPost={vi.fn()}
        onRetry={vi.fn()}
        onSelectTab={onSelectTab}
        pastCount={0}
        status="loaded"
        tab="lists"
        theme="dark"
        toBuyCount={5}
        unseenCount={2}
        viewerIsAdmin={false}
      />,
    )
    const totals = screen.getByLabelText("Board totals")
    expect(within(totals).getByText("To buy").previousElementSibling?.textContent).toBe("5")
    expect(screen.getByRole("tab", { name: "Lists 5" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tabpanel").textContent).toBe("Lists here")
    fireEvent.click(screen.getByRole("tab", { name: "Posts 2 new" }))
    expect(onSelectTab).toHaveBeenCalledWith("posts")
  })

  it("adds the Shopping row last on Home while something is on it", () => {
    const onOpenShopping = vi.fn()
    const { rerender } = render(
      <HomeBoardSection
        onOpenBoard={vi.fn()}
        onOpenPost={vi.fn()}
        onOpenShopping={onOpenShopping}
        rows={[]}
        shopping={{ listId: "shopping", openCount: 5, todayCount: 1 }}
        theme="dark"
        unseenCount={0}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Shopping\s*5 items · 1 needed today/ }))
    expect(onOpenShopping).toHaveBeenCalledWith("shopping")

    rerender(
      <HomeBoardSection
        onOpenBoard={vi.fn()}
        onOpenPost={vi.fn()}
        rows={[]}
        shopping={{ listId: "shopping", openCount: 0, todayCount: 0 }}
        theme="dark"
        unseenCount={0}
      />,
    )
    expect(screen.queryByRole("heading", { name: "Board" })).toBeNull()
  })
})
