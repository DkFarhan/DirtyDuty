// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"
import { PrivacySecurityScreen } from "./screens/privacy-security-screen"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  resetUserData: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  refresh: vi.fn(),
  selectHousehold: vi.fn(),
  removeBrowserPushSubscription: vi.fn(),
  user: {
    userId: "user-1",
    displayName: "Test User",
    email: "user@example.com",
    emailVerified: false,
  },
  households: [] as Array<{ id: string; name: string; currentUserRole: string }>,
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    user: mocks.user,
    logout: mocks.logout,
    changePassword: mocks.changePassword,
    deleteAccount: mocks.deleteAccount,
  }),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate, resetUserData: mocks.resetUserData }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    households: mocks.households,
    refresh: mocks.refresh,
    selectHousehold: mocks.selectHousehold,
  }),
}))

vi.mock("@/lib/notifications/push", () => ({
  removeBrowserPushSubscription: mocks.removeBrowserPushSubscription,
}))

describe("PrivacySecurityScreen", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.email = "user@example.com"
    mocks.households = []
    mocks.removeBrowserPushSubscription.mockResolvedValue(null)
    mocks.refresh.mockResolvedValue([])
  })

  afterEach(() => cleanup())

  it("validates password length, same-password changes, and confirmation", async () => {
    render(<PrivacySecurityScreen />)
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "StrongPassword123!" } })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))
    expect((await screen.findByRole("alert")).textContent).toContain("between 12 and 128")
    expect(mocks.changePassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "StrongPassword123!" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "StrongPassword123!" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))
    expect((await screen.findByRole("alert")).textContent).toContain("different from your current password")

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "AQuiteDifferentPassword456!" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "NotTheSamePassword456!" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))
    expect((await screen.findByRole("alert")).textContent).toContain("do not match")
  })

  it("shows the server's wrong-current-password response without clearing the session", async () => {
    mocks.changePassword.mockRejectedValue(new ApiError("Current password incorrect.", 400, "validation"))
    render(<PrivacySecurityScreen />)

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "incorrect" } })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "AQuiteDifferentPassword456!" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "AQuiteDifferentPassword456!" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Current password incorrect.")
    expect(mocks.resetUserData).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalledWith("login")
  })

  it("clears local data and routes to login after a successful password change", async () => {
    mocks.changePassword.mockResolvedValue(undefined)
    render(<PrivacySecurityScreen />)

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "StrongPassword123!" } })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "AQuiteDifferentPassword456!" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "AQuiteDifferentPassword456!" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    await waitFor(() => {
      expect(mocks.changePassword).toHaveBeenCalledWith("StrongPassword123!", "AQuiteDifferentPassword456!")
      expect(mocks.resetUserData).toHaveBeenCalledOnce()
      expect(mocks.navigate).toHaveBeenCalledWith("login")
    })
  })

  it("shows the active-owner blocker and routes each household action to its existing flow", () => {
    mocks.households = [{ id: "house-1", name: "Maple House", currentUserRole: "OWNER" }]
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))

    expect(screen.getAllByText("You still own households.").length).toBeGreaterThan(0)
    expect(screen.getByText("Maple House")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Permanently delete my account" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }))
    expect(mocks.selectHousehold).toHaveBeenCalledWith("house-1")
    expect(mocks.navigate).toHaveBeenCalledWith("household")

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete household" }))
    expect(mocks.selectHousehold).toHaveBeenCalledWith("house-1")
    expect(mocks.navigate).toHaveBeenCalledWith("household-settings")
  })

  it("requires acknowledgement, exact email, and password before deletion", async () => {
    mocks.deleteAccount.mockResolvedValue(undefined)
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    const continueButton = screen.getByRole("button", { name: "Continue" })
    expect((continueButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText("I understand that deleting my account is permanent."))
    fireEvent.click(continueButton)
    const deleteButton = screen.getByRole("button", { name: "Permanently delete my account" })
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText("Account email"), { target: { value: "other@example.com" } })
    fireEvent.change(screen.getAllByLabelText("Current password")[1], { target: { value: "StrongPassword123!" } })
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Account email"), { target: { value: "user@example.com" } })
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(mocks.deleteAccount).toHaveBeenCalledWith("StrongPassword123!", "user@example.com")
      expect(mocks.resetUserData).toHaveBeenCalledOnce()
      expect(mocks.navigate).toHaveBeenCalledWith("login")
      expect(mocks.removeBrowserPushSubscription).toHaveBeenCalledOnce()
    })
  })

  it("turns the server ownership conflict into a visible household blocker", async () => {
    mocks.deleteAccount.mockRejectedValue(new ApiError("You still own households.", 409, "conflict", {
      ownedHouseholds: [{ id: "house-2", name: "Cedar Home" }],
    }))
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByLabelText("I understand that deleting my account is permanent."))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    fireEvent.change(screen.getByLabelText("Account email"), { target: { value: "user@example.com" } })
    fireEvent.change(screen.getAllByLabelText("Current password")[1], { target: { value: "StrongPassword123!" } })
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete my account" }))

    expect(await screen.findByText("Cedar Home")).toBeTruthy()
    expect(screen.getAllByText("You still own households.").length).toBeGreaterThan(0)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.resetUserData).not.toHaveBeenCalled()
  })
})
