// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  createCategory: vi.fn(),
  role: "OWNER",
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
    activeHousehold: {
      id: "home-1",
      name: "Real household",
      timezone: "UTC",
      currentUserRole: mocks.role,
    },
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
  categoryApi: { create: mocks.createCategory },
}))

vi.mock("@/lib/data-sync/data-sync-context", () => ({
  householdChoreResource: (id: string) => `${id}:chores`,
  useDataSync: () => ({ invalidate: mocks.invalidate }),
}))

import { ApiError } from "@/lib/auth/api"
import { ChoreFormScreen } from "./chore-form-screen"

describe("ChoreFormScreen integration", () => {
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
    mocks.createCategory.mockReset()
    mocks.role = "OWNER"
  })

  afterEach(() => cleanup())

  it("uses the proposed shell while saving the live form state through the existing API", async () => {
    render(<ChoreFormScreen theme="dark" />)

    expect(await screen.findByRole("heading", { name: "Create a chore" })).toBeTruthy()
    expect(screen.getByText("Real household")).toBeTruthy()
    expect(await screen.findByRole("option", { name: /Kitchen/ })).toBeTruthy()
    // The form cards use the same .liveContent gutters as the hero card, with no extra padding.
    expect(screen.getByRole("main").className).not.toMatch(/(^|\s)px-/)

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
  describe("inline category creation", () => {
    const NEW = "__new-category__"
    const picker = () => screen.getByLabelText("Category") as HTMLSelectElement
    const openNewCategory = () => {
      picker().focus()
      fireEvent.change(picker(), { target: { value: NEW } })
      return screen.getByRole("dialog", { name: "New category" })
    }

    it("creates a category without losing the form and submits it", async () => {
      mocks.createCategory.mockResolvedValue({
        id: "category-new",
        name: "Pets",
        iconKey: "pets",
        sortOrder: 2,
        createdAt: "2026-11-11T00:00:00Z",
        choreCount: 0,
      })
      render(<ChoreFormScreen />)
      expect(await screen.findByRole("option", { name: "+ New category" })).toBeTruthy()
      fireEvent.change(screen.getByPlaceholderText("e.g. Clean Kitchen"), {
        target: { value: "Feed the cat" },
      })
      fireEvent.change(screen.getByPlaceholderText("Add a few helpful details"), {
        target: { value: "Half a scoop" },
      })

      const dialog = openNewCategory()
      expect(document.activeElement).toBe(within(dialog).getByLabelText("Name"))
      fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " Pets " } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Pets" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Add category" }))

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      expect(mocks.createCategory).toHaveBeenCalledWith("home-1", { name: "Pets", iconKey: "pets" })
      expect(picker().value).toBe("category-new")
      expect(screen.getByRole("option", { name: /Pets/ })).toBeTruthy()
      // Focus returns to the picker when the dialog's focus effect cleans up.
      await waitFor(() => expect(document.activeElement).toBe(picker()))
      expect((screen.getByPlaceholderText("e.g. Clean Kitchen") as HTMLInputElement).value).toBe(
        "Feed the cat",
      )
      expect(
        (screen.getByPlaceholderText("Add a few helpful details") as HTMLTextAreaElement).value,
      ).toBe("Half a scoop")
      expect(mocks.invalidate).toHaveBeenCalled()

      fireEvent.click(screen.getByRole("button", { name: "Create Chore" }))
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
      expect(mocks.create).toHaveBeenCalledWith(
        "home-1",
        expect.objectContaining({ title: "Feed the cat", categoryId: "category-new" }),
      )
    })

    it("restores the previous selection on cancel and on Escape", async () => {
      render(<ChoreFormScreen />)
      await screen.findByRole("option", { name: /Kitchen/ })
      fireEvent.change(picker(), { target: { value: "category-1" } })

      fireEvent.click(within(openNewCategory()).getByRole("button", { name: "Cancel" }))
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(picker().value).toBe("category-1")
      expect(document.activeElement).toBe(picker())

      openNewCategory()
      fireEvent.keyDown(document, { key: "Escape" })
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(picker().value).toBe("category-1")
      expect(mocks.createCategory).not.toHaveBeenCalled()
    })

    it("shows validation errors inline and keeps the dialog open", async () => {
      mocks.createCategory.mockRejectedValue(
        new ApiError("A category with this name already exists.", 409, "conflict"),
      )
      render(<ChoreFormScreen />)
      await screen.findByRole("option", { name: /Kitchen/ })

      const dialog = openNewCategory()
      fireEvent.click(within(dialog).getByRole("button", { name: "Add category" }))
      const alerts = within(dialog)
        .getAllByRole("alert")
        .map((alert) => alert.textContent)
      expect(alerts).toEqual(["Enter a category name.", "Choose an icon for this category."])
      expect(mocks.createCategory).not.toHaveBeenCalled()
      expect(within(dialog).getByLabelText("Name").getAttribute("aria-invalid")).toBe("true")

      fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "kitchen" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Kitchen" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Add category" }))

      expect(
        await within(dialog).findByText("A category with this name already exists."),
      ).toBeTruthy()
      expect(screen.getByRole("dialog")).toBeTruthy()
      expect(picker().value).toBe("")
    })

    it("does not offer a new category to members", async () => {
      mocks.role = "MEMBER"
      render(<ChoreFormScreen />)
      await screen.findByRole("option", { name: /Kitchen/ })
      expect(screen.queryByRole("option", { name: "+ New category" })).toBeNull()
    })

    it("no longer shows the duplicate category icon grid", async () => {
      render(<ChoreFormScreen />)
      await screen.findByRole("option", { name: /Kitchen/ })
      expect(screen.queryByText("Category icon")).toBeNull()
      expect(screen.queryByRole("button", { name: "Choose Kitchen icon" })).toBeNull()
    })
  })
})
