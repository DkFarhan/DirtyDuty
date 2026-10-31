// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    state: { currentUser: { id: "user-1" } },
    screen: "create-chore",
    navigate: mocks.navigate,
    editingChoreId: null,
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    activeHousehold: { id: "home-1", name: "Real household", timezone: "UTC" },
  }),
}))

vi.mock("@/lib/household/chores", () => ({
  categoryIcon: () => "🧹",
  choreApi: {
    options: mocks.options,
    create: mocks.create,
    update: mocks.update,
    get: mocks.get,
  },
}))

vi.mock("@/lib/data-sync/data-sync-context", () => ({
  householdChoreResource: (id: string) => `${id}:chores`,
  useDataSync: () => ({ invalidate: mocks.invalidate }),
}))

import { ChoreFormScreen } from "./chore-form-screen"

describe("ChoreFormScreen redesigned integration", () => {
  beforeEach(() => {
    mocks.options.mockReset().mockResolvedValue({
      categories: [
        {
          id: "category-1",
          name: "Kitchen",
          iconKey: "🍽️",
          sortOrder: 1,
          createdAt: "2026-10-01T00:00:00Z",
        },
      ],
      activeMembers: [{ userId: "user-1", displayName: "Current member" }],
    })
    mocks.create.mockReset().mockResolvedValue(undefined)
    mocks.update.mockReset()
    mocks.get.mockReset()
    mocks.navigate.mockReset()
    mocks.invalidate.mockReset()
  })

  afterEach(() => cleanup())

  it("uses the proposed shell while saving the live form state through the existing API", async () => {
    render(<ChoreFormScreen redesigned theme="dark" />)

    expect(await screen.findByRole("heading", { name: "Create a chore" })).toBeTruthy()
    expect(screen.getByText("Real household")).toBeTruthy()
    expect(await screen.findByRole("option", { name: /Kitchen/ })).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "category-1" },
    })
    fireEvent.change(screen.getByPlaceholderText("e.g. Clean Kitchen"), {
      target: { value: "Wipe the counters" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create Chore" }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create).toHaveBeenCalledWith(
      "home-1",
      expect.objectContaining({
        title: "Wipe the counters",
        categoryId: "category-1",
        schedule: expect.objectContaining({
          timezone: "UTC",
          assignmentStrategy: "FIXED",
          fixedAssigneeUserId: "user-1",
        }),
      }),
    )
    expect(mocks.invalidate).toHaveBeenCalledOnce()
  })
})
