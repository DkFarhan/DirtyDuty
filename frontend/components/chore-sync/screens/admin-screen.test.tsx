// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  activeHousehold: {
    id: "home-a",
    name: "Home A",
    timezone: "UTC",
    currentUserRole: "OWNER",
    createdAt: "2026-10-01T00:00:00Z",
  },
  list: vi.fn(),
  options: vi.fn(),
  navigate: vi.fn(),
  editChore: vi.fn(),
  pause: vi.fn(),
  activate: vi.fn(),
  archive: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate, editChore: mocks.editChore }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({ activeHousehold: mocks.activeHousehold }),
}))

vi.mock("@/lib/household/chores", () => ({
  categoryIcon: () => "🧹",
  choreApi: {
    list: mocks.list,
    options: mocks.options,
    pause: mocks.pause,
    activate: mocks.activate,
    archive: mocks.archive,
  },
}))

vi.mock("@/lib/data-sync/data-sync-context", () => ({
  householdChoreResource: (id: string) => `${id}:chores`,
  useDataSync: () => ({ revision: 0, invalidate: vi.fn() }),
}))

import { AdminScreen } from "./admin-screen"

const choreA = {
  id: "chore-a",
  householdId: "home-a",
  categoryId: null,
  title: "Home A chore",
  description: null,
  defaultPriority: "NORMAL" as const,
  difficulty: 1,
  estimatedMinutes: null,
  requiresVerification: false,
  active: true,
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  schedule: null,
}

const choreB = {
  ...choreA,
  id: "chore-b",
  householdId: "home-b",
  title: "Home B chore",
}

describe("admin screen household isolation", () => {
  beforeEach(() => {
    mocks.activeHousehold = {
      id: "home-a",
      name: "Home A",
      timezone: "UTC",
      currentUserRole: "OWNER",
      createdAt: "2026-10-01T00:00:00Z",
    }
    mocks.list
      .mockReset()
      .mockImplementation(async (id: string) => (id === "home-a" ? [choreA] : [choreB]))
    mocks.options.mockReset().mockResolvedValue({
      categories: [],
      activeMembers: [
        { userId: "member-1", displayName: "Farhan" },
        { userId: "member-2", displayName: "Aisha" },
        { userId: "member-3", displayName: "Salman" },
      ],
    })
    mocks.navigate.mockReset()
    mocks.editChore.mockReset()
    mocks.pause.mockReset()
    mocks.activate.mockReset()
    mocks.archive.mockReset()
  })

  afterEach(() => cleanup())

  it("omits primary navigation and returns to Household from its back button", async () => {
    render(<AdminScreen />)

    await screen.findByText("Home A chore")
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(mocks.navigate).toHaveBeenCalledWith("household")
  })

  it("hides the previous household chores while loading another household and retains retry behavior", async () => {
    const view = render(<AdminScreen />)
    expect(await screen.findByText("Home A chore")).toBeTruthy()

    mocks.activeHousehold = { ...mocks.activeHousehold, id: "home-b", name: "Home B" }
    mocks.list
      .mockRejectedValueOnce(new Error("Temporary chore outage."))
      .mockResolvedValueOnce([choreB])
    view.rerender(<AdminScreen />)

    await screen.findByRole("alert")
    expect(screen.queryByText("Home A chore")).toBeNull()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Home B chore")).toBeTruthy()
    expect(screen.queryByText("Home A chore")).toBeNull()
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith("home-b"))
  })

  it("shows live chore/member statistics and routes the header action to chore creation", async () => {
    const activeRoutine = {
      ...choreA,
      categoryId: "laundry",
      title: "Laundry",
      difficulty: 3,
      estimatedMinutes: 20,
      schedule: {
        recurrenceRule: "FREQ=DAILY",
        timezone: "UTC",
        startsOn: "2026-10-01",
        endsOn: null,
        dueTime: "12:30",
        assignmentStrategy: "FIXED" as const,
        peopleNeeded: 1,
        fixedAssigneeUserId: "member-2",
        participantUserIds: ["member-2"],
        active: true,
      },
    }
    const pausedRoutine = {
      ...choreA,
      id: "paused",
      title: "Paused routine",
      active: false,
    }
    const archivedRoutine = {
      ...choreA,
      id: "archived",
      title: "Archived routine",
      active: false,
      archivedAt: "2026-10-15T00:00:00Z",
    }
    mocks.list.mockResolvedValueOnce([activeRoutine, pausedRoutine, archivedRoutine])
    mocks.options.mockResolvedValueOnce({
      categories: [
        {
          id: "laundry",
          name: "Laundry",
          iconKey: "🧺",
          sortOrder: 1,
          createdAt: "2026-10-01T00:00:00Z",
        },
      ],
      activeMembers: [
        { userId: "member-1", displayName: "Farhan" },
        { userId: "member-2", displayName: "Aisha" },
        { userId: "member-3", displayName: "Salman" },
      ],
    })

    const { container } = render(<AdminScreen redesigned />)

    expect(await screen.findByRole("heading", { name: "Laundry" })).toBeTruthy()
    expect(screen.queryByText("Archived routine")).toBeNull()
    expect(screen.getByText("Household routines").previousElementSibling?.textContent).toBe("1")
    expect(screen.getByText("Ready when you are").previousElementSibling?.textContent).toBe("1")
    expect(screen.getByText("People in the rotation").previousElementSibling?.textContent).toBe("3")
    expect(screen.getByText("2 routines")).toBeTruthy()
    const choreMetadata = Array.from(container.querySelectorAll("p")).map((paragraph) =>
      paragraph.textContent?.replace(/\s+/g, " ").trim(),
    )
    expect(choreMetadata).toContain("Laundry · Daily · 12:30 PM")
    expect(choreMetadata).toContain("Fixed · Aisha · Effort 3/5 · ~20 min")
    expect(container.textContent).not.toContain("No schedule")
    const laundryCard = screen.getByRole("heading", { name: "Laundry" }).closest("article")
    expect(laundryCard?.querySelector(":scope > .contents")).toBeTruthy()
    expect(laundryCard?.querySelector("[class*=choreIcon]")?.className).not.toContain("bg-teal-50")
    expect(laundryCard?.querySelector("[class*=activePill]")?.className).not.toContain(
      "bg-emerald-50",
    )
    expect(laundryCard?.querySelector("[class*=moreButton]")?.className).not.toContain(
      "text-slate-500",
    )
    expect(laundryCard?.querySelector("p[class*=metaLine] span")?.textContent).toBe("·")
    const pausedCard = screen.getByRole("heading", { name: "Paused routine" }).closest("article")
    expect(pausedCard?.querySelector("[class*=pausedPill]")).toBeTruthy()
    expect(pausedCard?.querySelector("[class*=pausedPill]")?.className).not.toContain(
      "bg-slate-100",
    )
    expect(screen.getAllByRole("button", { name: "Create a chore" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Create a chore" }))
    expect(mocks.navigate).toHaveBeenCalledWith("create-chore")
  })

  it("preserves chore menu edit and pause actions in the redesigned screen", async () => {
    const pausedRoutine = { ...choreA, active: false }
    mocks.list.mockResolvedValueOnce([choreA])
    mocks.pause.mockResolvedValueOnce(pausedRoutine)

    render(<AdminScreen redesigned />)
    await screen.findByRole("heading", { name: "Home A chore" })

    fireEvent.click(screen.getByRole("button", { name: "Actions for Home A chore" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(mocks.editChore).toHaveBeenCalledWith("chore-a")

    fireEvent.click(screen.getByRole("button", { name: "Actions for Home A chore" }))
    fireEvent.click(screen.getByRole("button", { name: "Actions for Home A chore" }))
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith("home-a", "chore-a"))
  })
})
