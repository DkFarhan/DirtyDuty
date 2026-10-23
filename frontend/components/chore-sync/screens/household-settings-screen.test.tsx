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
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    user: { hasPassword: true, authProviders: ["PASSWORD"] },
    features: { google: false },
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    households: [mocks.activeHousehold],
    activeHousehold: mocks.activeHousehold,
    refresh: vi.fn(),
    updateHousehold: vi.fn(),
    removeHousehold: vi.fn(() => []),
  }),
}))

vi.mock("@/lib/household/api", () => ({
  householdApi: {
    settings: mocks.settings,
    listInvitations: mocks.listInvitations,
    revokeInvitation: mocks.revokeInvitation,
    updateSettings: vi.fn(),
    deleteHousehold: vi.fn(),
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
})

function withinDialogButton(dialog: HTMLElement, name: string) {
  return Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent === name,
  )!
}
