// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CalendarDTO, CalendarItem } from "@/lib/household/calendar"
import { CalendarView, type CalendarViewProps } from "./calendar-view"

afterEach(cleanup)

const farhan = { userId: "farhan", displayName: "Farhan" }
const rubayet = { userId: "rubayet", displayName: "Rubayet" }

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
    // 9 PM in Halifax (UTC-4 in November).
    dueAt: "2026-11-27T01:00:00Z",
    assignees: [farhan],
    projected: false,
    toBeDecided: false,
    ...overrides,
  }
}

function calendar(viewerRole = "OWNER"): CalendarDTO {
  return {
    from: "2026-11-23",
    to: "2026-11-29",
    today: "2026-11-26",
    timezone: "America/Halifax",
    viewerRole,
    members: [
      { ...farhan, role: "OWNER", colorIndex: 0 },
      { ...rubayet, role: "MEMBER", colorIndex: 1 },
    ],
    days: [
      {
        date: "2026-11-24",
        items: [item({ id: "done-1", date: "2026-11-24", status: "COMPLETED" })],
      },
      {
        date: "2026-11-26",
        items: [
          item(),
          item({
            id: "a-2",
            title: "Take out garbage",
            assignees: [rubayet],
            dueAt: "2026-11-27T00:00:00Z",
          }),
        ],
      },
      {
        date: "2026-11-29",
        items: [item({ id: null, date: "2026-11-29", projected: true })],
      },
    ],
    undated: [],
    counts: [
      { userId: "farhan", count: 3 },
      { userId: "rubayet", count: 1 },
    ],
  }
}

function renderView(overrides: Partial<CalendarViewProps> = {}) {
  const props: CalendarViewProps = {
    theme: "dark",
    view: "week",
    anchor: "2026-11-26",
    today: "2026-11-26",
    timeZone: "America/Halifax",
    calendar: calendar(),
    status: "loaded",
    filter: "everyone",
    selectedDay: "2026-11-26",
    filterOpen: false,
    onViewChange: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    showToday: false,
    rangeLabel: "Nov 23 – 29",
    onOpenFilter: vi.fn(),
    onCloseFilter: vi.fn(),
    onFilterChange: vi.fn(),
    onSelectDay: vi.fn(),
    onOpenItem: vi.fn(),
    onAdd: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
  render(<CalendarView {...props} />)
  return props
}

function dayRow(date: string) {
  return document.querySelector(`[data-date="${date}"]`) as HTMLElement
}

describe("Week", () => {
  it("shows seven day rows in one card, Monday first, with today marked", () => {
    renderView()
    const rows = within(screen.getByRole("region", { name: "Week" })).getAllByRole("group")
    expect(rows.map((row) => row.dataset.date)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ])
    expect(rows[0].textContent).toContain("Mon23")
    expect(dayRow("2026-11-26").dataset.today).toBeDefined()
    expect(dayRow("2026-11-25").dataset.today).toBeUndefined()
  })

  it("renders an empty day thin, with no placeholder text", () => {
    renderView()
    const empty = dayRow("2026-11-25")
    expect(empty.dataset.empty).toBeDefined()
    expect(within(empty).queryByRole("list")).toBeNull()
    expect(empty.textContent).toBe("Wed25")
  })

  it("shows the time for a chore to do and a tick instead for a done one", () => {
    renderView()
    const today = dayRow("2026-11-26")
    expect(within(today).getByRole("button", { name: "Wash dishes, Farhan, 9 PM" })).toBeTruthy()
    expect(within(today).getByText("8 PM")).toBeTruthy()
    const done = dayRow("2026-11-24")
    expect(within(done).getByLabelText("Done")).toBeTruthy()
    expect(within(done).queryByText(/PM/)).toBeNull()
  })

  it("opens the action sheet for a stored chore; projected ones aren't buttons", () => {
    const props = renderView()
    fireEvent.click(screen.getByRole("button", { name: "Take out garbage, Rubayet, 8 PM" }))
    expect(props.onOpenItem).toHaveBeenCalledWith("a-2")
    expect(within(dayRow("2026-11-29")).queryByRole("button", { name: /Wash dishes/ })).toBeNull()
    expect(dayRow("2026-11-29").textContent).toContain("planned")
  })

  it("gives owners and admins a + that is disabled on past days and opens quick create", () => {
    const props = renderView()
    const past = within(dayRow("2026-11-25")).getByRole("button", { name: /Add a chore/ })
    const today = within(dayRow("2026-11-26")).getByRole("button", { name: /Add a chore/ })
    expect((past as HTMLButtonElement).disabled).toBe(true)
    expect((today as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(today)
    expect(props.onAdd).toHaveBeenCalledWith("2026-11-26")
  })

  it("has no + for a member", () => {
    renderView({ calendar: calendar("MEMBER") })
    expect(screen.queryByRole("button", { name: /Add a chore/ })).toBeNull()
  })

  it("lists people by count, highest first, and filters to one member", () => {
    renderView()
    const pills = within(screen.getByRole("region", { name: /by person/i })).getAllByRole(
      "listitem",
    )
    expect(pills.map((pill) => pill.getAttribute("aria-label"))).toEqual([
      "Farhan: 3",
      "Rubayet: 1",
    ])
    cleanup()
    renderView({ filter: "rubayet" })
    expect(
      within(screen.getByRole("region", { name: /by person/i })).getAllByRole("listitem"),
    ).toHaveLength(1)
    expect(screen.queryByText("Wash dishes")).toBeNull()
    expect(screen.getByText("Take out garbage")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Show chores for: Rubayet/ })).toBeTruthy()
  })

  it("chooses a member from the filter sheet, each with their colour", () => {
    const props = renderView({ filterOpen: true })
    const sheet = screen.getByRole("dialog", { name: "Show chores for" })
    const options = within(sheet).getAllByRole("button")
    expect(options.map((option) => option.textContent)).toEqual(["Everyone", "FFarhan", "RRubayet"])
    expect(sheet.querySelector('[data-color="amber"]')?.textContent).toContain("R")
    fireEvent.click(options[2])
    expect(props.onFilterChange).toHaveBeenCalledWith("rubayet")
  })
})

describe("Month", () => {
  it("is a Monday-first grid with today outlined and the chosen day's list below", () => {
    const month: CalendarDTO = {
      ...calendar(),
      from: "2026-11-01",
      to: "2026-11-30",
    }
    renderView({ view: "month", calendar: month, rangeLabel: "November 2026" })
    const grid = screen.getByRole("grid")
    const firstRow = within(grid).getAllByRole("row")[0]
    const cells = within(firstRow).getAllByRole("gridcell")
    expect(cells).toHaveLength(7)
    expect(cells.slice(0, 6).every((cell) => cell.textContent === "")).toBe(true)
    expect(cells[6].textContent).toContain("1")
    const today = screen.getByRole("button", { name: "Thu 26, 2 chores" })
    expect(today.dataset.today).toBeDefined()
    expect(today.closest("[role=gridcell]")?.getAttribute("aria-selected")).toBe("true")
    expect(today.dataset.selected).toBeDefined()
    expect(screen.getByText("TODAY · THU, NOV 26")).toBeTruthy()
    const projectedDay = screen.getByRole("button", { name: "Sun 29, 1 chore" })
    expect(projectedDay.querySelector("[data-projected]")).toBeTruthy()
  })
})
