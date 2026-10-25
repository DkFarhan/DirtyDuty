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

vi.mock("@/components/ui/password-input", () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("./subpage-header", () => ({
  SubpageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

import { HouseholdSettingsScreen } from "./household-settings-screen"

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
    fireEvent.click(screen.getByRole("button", { name: "Save default notification style" }))
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
    fireEvent.click(await screen.findByRole("button", { name: "Delete household" }))
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
})

function withinDialogButton(dialog: HTMLElement, name: string) {
  return Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent === name,
  )!
}
