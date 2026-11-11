// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  activeHousehold: {
    id: "home-a",
    name: "Home A",
    timezone: "UTC",
    currentUserRole: "OWNER",
    createdAt: "2026-10-01T00:00:00Z",
  },
  settings: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
  setHouseholdStyle: vi.fn(),
  navigate: vi.fn(),
  deleteHousehold: vi.fn(),
  refresh: vi.fn(),
  removeHousehold: vi.fn(),
  pendingAccountDeletionUserId: null as string | null,
  clearAccountDeletion: vi.fn(),
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  reorderCategories: vi.fn(),
  removeCategory: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    navigate: mocks.navigate,
    pendingAccountDeletionUserId: mocks.pendingAccountDeletionUserId,
    clearAccountDeletion: mocks.clearAccountDeletion,
  }),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    user: { userId: "user-1", hasPassword: true, authProviders: ["PASSWORD"] },
    features: { google: false },
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    households: [mocks.activeHousehold],
    activeHousehold: mocks.activeHousehold,
    refresh: mocks.refresh,
    updateHousehold: vi.fn(),
    removeHousehold: mocks.removeHousehold,
  }),
}))

vi.mock("@/lib/household/api", () => ({
  householdApi: {
    settings: mocks.settings,
    listInvitations: mocks.listInvitations,
    revokeInvitation: mocks.revokeInvitation,
    updateSettings: vi.fn(),
    deleteHousehold: mocks.deleteHousehold,
  },
}))

vi.mock("@/lib/notifications/api", () => ({
  notificationApi: {
    setHouseholdStyle: mocks.setHouseholdStyle,
  },
}))

vi.mock("@/lib/household/chores", () => ({
  categoryApi: {
    list: mocks.listCategories,
    create: mocks.createCategory,
    update: mocks.updateCategory,
    reorder: mocks.reorderCategories,
    remove: mocks.removeCategory,
  },
}))

vi.mock("@/components/ui/password-input", () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

import { HouseholdSettingsScreen } from "./household-settings-screen"
import designStyles from "../redesign/household-secondary-design-preview.module.css"

const homeASettings = {
  ...mocks.activeHousehold,
  description: null,
  notificationStyle: "NORMAL" as const,
}
const homeBSettings = {
  ...mocks.activeHousehold,
  id: "home-b",
  name: "Home B",
  notificationStyle: "COMPETITIVE" as const,
}
const activeInvitation = {
  id: "invitation-1",
  createdAt: "2026-10-01T00:00:00Z",
  expiresAt: null,
  status: "ACTIVE" as const,
  createdByDisplayName: "Jahid",
  roleToAssign: "MEMBER" as const,
}

describe("household settings screen", () => {
  beforeEach(() => {
    mocks.activeHousehold = {
      id: "home-a",
      name: "Home A",
      timezone: "UTC",
      currentUserRole: "OWNER",
      createdAt: "2026-10-01T00:00:00Z",
    }
    mocks.settings
      .mockReset()
      .mockImplementation(async (id: string) => (id === "home-a" ? homeASettings : homeBSettings))
    mocks.listInvitations.mockReset().mockResolvedValue([])
    mocks.revokeInvitation.mockReset()
    mocks.setHouseholdStyle.mockReset()
    mocks.navigate.mockReset()
    mocks.deleteHousehold.mockReset().mockResolvedValue(undefined)
    mocks.refresh.mockReset().mockResolvedValue([])
    mocks.removeHousehold.mockReset().mockReturnValue([])
    mocks.pendingAccountDeletionUserId = null
    mocks.clearAccountDeletion.mockReset()
    mocks.listCategories.mockReset().mockResolvedValue([])
    mocks.createCategory.mockReset()
    mocks.updateCategory.mockReset()
    mocks.reorderCategories.mockReset()
    mocks.removeCategory.mockReset()
  })

  afterEach(() => cleanup())

  it("keeps the revocation dialog open, prevents duplicate requests, and closes only on success", async () => {
    mocks.listInvitations.mockResolvedValueOnce([activeInvitation]).mockResolvedValueOnce([])
    mocks.revokeInvitation.mockRejectedValueOnce(new Error("Revocation failed. Try again."))
    render(<HouseholdSettingsScreen />)

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(withinDialogButton(dialog, "Confirm revoke"))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to revoke this invitation.",
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(
      false,
    )

    let resolveRevoke!: () => void
    mocks.revokeInvitation.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve
        }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect((screen.getByRole("button", { name: "Revoking…" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByRole("button", { name: "Revoking…" }))
    expect(mocks.revokeInvitation).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("dialog")).toBeTruthy()

    resolveRevoke()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.revokeInvitation).toHaveBeenLastCalledWith("home-a", "invitation-1")
  })

  it("restores the original settings composition using live household and invitation data", async () => {
    mocks.listInvitations.mockResolvedValueOnce([
      activeInvitation,
      { ...activeInvitation, id: "invitation-2", roleToAssign: "ADMIN" },
      { ...activeInvitation, id: "invitation-3", roleToAssign: "OWNER" },
    ])
    render(<HouseholdSettingsScreen theme="light" />)

    expect(await screen.findByRole("heading", { name: "Make it feel like yours." })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Home A" })).toBeTruthy()
    expect(screen.getByLabelText("Household name")).toHaveProperty("value", "Home A")
    expect(screen.getByText("UTC")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Who can join" })).toBeTruthy()
    expect(await screen.findAllByText("Created by Jahid")).toHaveLength(3)
    const activeBadges = screen.getAllByText("ACTIVE")
    expect(activeBadges).toHaveLength(3)
    for (const badge of activeBadges) {
      expect(badge.parentElement?.className).toContain("invitationPrimaryLine")
    }
    expect(screen.queryByText("member")).toBeNull()
    expect(screen.queryByText("admin")).toBeNull()
    expect(screen.queryByText("owner")).toBeNull()
    expect(screen.getAllByText(/No expiry date/)).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Review deletion steps" })).toBeTruthy()
  })

  it("uses the current destructive action hierarchy in the deletion dialog", async () => {
    const { container } = render(<HouseholdSettingsScreen theme="dark" />)
    const trigger = await screen.findByRole("button", { name: "Review deletion steps" })
    fireEvent.click(trigger)

    const namedDialog = screen.getByRole("dialog", { name: "Delete Home A?" })
    expect(document.activeElement).toBe(
      within(namedDialog).getByRole("button", { name: "Transfer ownership" }),
    )
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(within(namedDialog).getByRole("button", { name: "Cancel" }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)

    const dialog = screen.getByRole("dialog", { name: "Delete Home A?" })
    const destructiveAction = screen.getByRole("button", { name: "Continue to deletion" })
    expect(container.querySelector(`.${designStyles.dark}`)).toBeTruthy()
    expect(dialog.className).toContain(designStyles.deletionDialog)
    expect(destructiveAction.className).toContain(designStyles.dangerButton)
    expect(destructiveAction.className).toContain(designStyles.deletionAction)
    expect(screen.getByRole("button", { name: "Transfer ownership" }).className).toContain(
      designStyles.dialogNeutralAction,
    )
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain(
      designStyles.dialogCancelAction,
    )
  })

  it("keeps unsaved style selections through household settings reloads and applies the server style after save", async () => {
    const view = render(<HouseholdSettingsScreen />)
    const styleSelect = (await screen.findByLabelText(
      "Default notification style",
    )) as HTMLSelectElement
    fireEvent.change(styleSelect, { target: { value: "FUNNY" } })

    mocks.activeHousehold = { ...mocks.activeHousehold, id: "home-b", name: "Home B" }
    mocks.settings.mockRejectedValueOnce(new Error("Temporary settings outage."))
    view.rerender(<HouseholdSettingsScreen />)
    await screen.findByRole("button", { name: "Try again" })
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Default notification style")).toHaveProperty(
        "value",
        "COMPETITIVE",
      ),
    )

    mocks.activeHousehold = { ...mocks.activeHousehold, id: "home-a", name: "Home A" }
    view.rerender(<HouseholdSettingsScreen />)
    await waitFor(() =>
      expect(screen.getByLabelText("Default notification style")).toHaveProperty("value", "FUNNY"),
    )

    mocks.setHouseholdStyle.mockResolvedValueOnce(undefined)
    mocks.settings.mockResolvedValueOnce({ ...homeASettings, notificationStyle: "MINIMAL" })
    fireEvent.click(screen.getByRole("button", { name: "Save default style" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Default notification style")).toHaveProperty(
        "value",
        "MINIMAL",
      ),
    )
    expect(mocks.setHouseholdStyle).toHaveBeenCalledWith("home-a", "FUNNY")
  })

  it("returns to account deletion after household deletion when that flow is pending", async () => {
    mocks.pendingAccountDeletionUserId = "user-1"
    render(<HouseholdSettingsScreen />)
    fireEvent.click(await screen.findByRole("button", { name: "Review deletion steps" }))
    fireEvent.click(screen.getByRole("button", { name: "Continue to deletion" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "All members will lose access." }))
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Household data and history will be permanently deleted.",
      }),
    )
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand this cannot be undone." }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    fireEvent.change(screen.getByPlaceholderText("Home A"), { target: { value: "Home A" } })
    fireEvent.change(screen.getByPlaceholderText("Current password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete Home A" }))

    await waitFor(() => {
      expect(mocks.deleteHousehold).toHaveBeenCalledWith("home-a", {
        householdName: "Home A",
        password: "StrongPassword123!",
      })
      expect(mocks.navigate).toHaveBeenCalledWith("privacy-security")
    })
    expect(mocks.clearAccountDeletion).not.toHaveBeenCalled()
  })
  describe("categories", () => {
    const kitchen = {
      id: "cat-kitchen",
      name: "Kitchen",
      iconKey: "kitchen",
      sortOrder: 0,
      createdAt: "2026-10-01T00:00:00Z",
      choreCount: 2,
    }
    const laundry = {
      ...kitchen,
      id: "cat-laundry",
      name: "Laundry",
      iconKey: "laundry",
      sortOrder: 1,
      choreCount: 3,
    }
    const pets = {
      ...kitchen,
      id: "cat-pets",
      name: "Pets",
      iconKey: "pets",
      sortOrder: 2,
      choreCount: 1,
    }

    // The section reloads from the server after every change, so keep a server-side list.
    let server: (typeof kitchen)[] = []
    const serve = (categories: (typeof kitchen)[]) => {
      server = categories
      mocks.listCategories.mockImplementation(async () => server)
    }

    const rowNames = () =>
      within(screen.getByRole("list", { name: "Categories" }))
        .getAllByRole("listitem")
        .map((row) => row.querySelector("strong")?.textContent)

    it("lists each category with its icon, name and chore count", async () => {
      serve([kitchen, laundry, pets])
      render(<HouseholdSettingsScreen />)

      expect(await screen.findByRole("heading", { name: "Categories" })).toBeTruthy()
      await waitFor(() => expect(rowNames()).toEqual(["Kitchen", "Laundry", "Pets"]))
      const kitchenRow = screen.getAllByRole("listitem")[0]
      expect(kitchenRow.textContent).toContain("🍽️")
      expect(kitchenRow.textContent).toContain("2 chores")
      expect(screen.getAllByRole("listitem")[2].textContent).toContain("1 chore")
      expect(mocks.listCategories).toHaveBeenCalledWith("home-a")
      expect(
        (screen.getByRole("button", { name: "Move Kitchen up" }) as HTMLButtonElement).disabled,
      ).toBe(true)
      expect(
        (screen.getByRole("button", { name: "Move Pets down" }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    it("reorders with the move buttons and sends the full ordered list", async () => {
      serve([kitchen, laundry, pets])
      mocks.reorderCategories.mockImplementation(async (_id: string, ids: string[]) => {
        server = ids.map((id) => server.find((category) => category.id === id)!)
        return server.map((category, index) => ({ ...category, sortOrder: index }))
      })
      render(<HouseholdSettingsScreen />)

      fireEvent.click(await screen.findByRole("button", { name: "Move Kitchen down" }))

      await waitFor(() =>
        expect(mocks.reorderCategories).toHaveBeenCalledWith("home-a", [
          "cat-laundry",
          "cat-kitchen",
          "cat-pets",
        ]),
      )
      await waitFor(() => expect(rowNames()).toEqual(["Laundry", "Kitchen", "Pets"]))
    })

    it("renames and changes the icon in the edit dialog", async () => {
      serve([kitchen, laundry])
      mocks.updateCategory.mockImplementation(async () => {
        const updated = { ...kitchen, name: "Cooking", iconKey: "dishes" }
        server = server.map((category) => (category.id === updated.id ? updated : category))
        return updated
      })
      render(<HouseholdSettingsScreen />)

      fireEvent.click(await screen.findByRole("button", { name: "Edit Kitchen" }))
      const dialog = screen.getByRole("dialog", { name: "Edit category" })
      const name = within(dialog).getByLabelText("Name") as HTMLInputElement
      expect(name.value).toBe("Kitchen")
      expect(
        within(dialog).getByRole("button", { name: "Kitchen" }).getAttribute("aria-pressed"),
      ).toBe("true")
      fireEvent.change(name, { target: { value: "  Cooking " } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Dishes" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Save category" }))

      await waitFor(() =>
        expect(mocks.updateCategory).toHaveBeenCalledWith("home-a", "cat-kitchen", {
          name: "Cooking",
          iconKey: "dishes",
        }),
      )
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      expect(rowNames()).toEqual(["Cooking", "Laundry"])
    })

    it("asks before deleting and explains what happens to the chores", async () => {
      serve([kitchen, laundry])
      mocks.removeCategory.mockImplementation(async (_home: string, id: string) => {
        server = server.filter((category) => category.id !== id)
      })
      render(<HouseholdSettingsScreen />)

      fireEvent.click(await screen.findByRole("button", { name: "Delete Laundry" }))
      const dialog = screen.getByRole("dialog", { name: "Delete Laundry?" })
      expect(dialog.textContent).toContain(
        "3 chores use Laundry. They'll keep working without a category.",
      )
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(mocks.removeCategory).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole("button", { name: "Delete Laundry" }))
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }))
      await waitFor(() =>
        expect(mocks.removeCategory).toHaveBeenCalledWith("home-a", "cat-laundry"),
      )
      await waitFor(() => expect(rowNames()).toEqual(["Kitchen"]))
    })

    it("adds a category from the Add category button", async () => {
      serve([kitchen])
      mocks.createCategory.mockImplementation(async () => {
        server = [...server, pets]
        return pets
      })
      render(<HouseholdSettingsScreen />)

      await waitFor(() => expect(rowNames()).toEqual(["Kitchen"]))
      fireEvent.click(screen.getByRole("button", { name: "Add category" }))
      const dialog = screen.getByRole("dialog", { name: "New category" })
      fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Pets" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Pets" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Add category" }))

      await waitFor(() =>
        expect(mocks.createCategory).toHaveBeenCalledWith("home-a", {
          name: "Pets",
          iconKey: "pets",
        }),
      )
      await waitFor(() => expect(rowNames()).toEqual(["Kitchen", "Pets"]))
    })

    it("hides the section from members", async () => {
      mocks.activeHousehold = { ...mocks.activeHousehold, currentUserRole: "MEMBER" }
      mocks.settings.mockResolvedValue({ ...homeASettings, currentUserRole: "MEMBER" })
      render(<HouseholdSettingsScreen />)

      expect(await screen.findByRole("heading", { name: "Notifications" })).toBeTruthy()
      expect(screen.queryByRole("heading", { name: "Categories" })).toBeNull()
      expect(screen.queryByRole("button", { name: "Add category" })).toBeNull()
      expect(mocks.listCategories).not.toHaveBeenCalled()
    })
  })
})

function withinDialogButton(dialog: HTMLElement, name: string) {
  return Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent === name,
  )!
}
