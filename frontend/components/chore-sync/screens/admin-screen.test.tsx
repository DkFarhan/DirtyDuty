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
    pause: vi.fn(),
    activate: vi.fn(),
    archive: vi.fn(),
  },
}))

vi.mock("@/lib/data-sync/data-sync-context", () => ({
  householdChoreResource: (id: string) => `${id}:chores`,
  useDataSync: () => ({ revision: 0, invalidate: vi.fn() }),
}))

vi.mock("../bottom-nav", () => ({ BottomNav: () => null }))

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
    mocks.options.mockReset().mockResolvedValue({ categories: [], activeMembers: [] })
    mocks.navigate.mockReset()
    mocks.editChore.mockReset()
  })

  afterEach(() => cleanup())

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
})
