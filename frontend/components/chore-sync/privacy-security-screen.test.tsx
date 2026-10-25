// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  beginAccountDeletion: vi.fn(),
  clearAccountDeletion: vi.fn(),
  pendingAccountDeletionUserId: null as string | null,
  removeBrowserPushSubscription: vi.fn(),
  user: {
    userId: "user-1",
    displayName: "Test User",
    email: "user@example.com",
    emailVerified: false,
    hasPassword: true,
    authProviders: ["PASSWORD"],
  },
  features: { google: false, passwordReset: false },
  households: [] as Array<{ id: string; name: string; currentUserRole: string }>,
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    user: mocks.user,
    logout: mocks.logout,
    changePassword: mocks.changePassword,
    deleteAccount: mocks.deleteAccount,
    features: mocks.features,
  }),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    navigate: mocks.navigate,
    resetUserData: mocks.resetUserData,
    beginAccountDeletion: mocks.beginAccountDeletion,
    clearAccountDeletion: mocks.clearAccountDeletion,
    pendingAccountDeletionUserId: mocks.pendingAccountDeletionUserId,
  }),
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
    mocks.user.hasPassword = true
    mocks.user.authProviders = ["PASSWORD"]
    mocks.features = { google: false, passwordReset: false }
    mocks.households = []
    mocks.removeBrowserPushSubscription.mockResolvedValue(null)
    mocks.refresh.mockImplementation(async () => mocks.households)
  })

  afterEach(() => cleanup())

  it("toggles each change-password field independently without submitting", () => {
    render(<PrivacySecurityScreen />)
    const current = screen.getByLabelText("Current password") as HTMLInputElement
    const next = screen.getByLabelText("New password") as HTMLInputElement
    const confirmation = screen.getByLabelText("Confirm new password") as HTMLInputElement
    fireEvent.change(current, { target: { value: "current-secret" } })
    fireEvent.change(next, { target: { value: "new-secret" } })
    fireEvent.change(confirmation, { target: { value: "new-secret" } })

    fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[1])
    expect(current.type).toBe("password")
    expect(next.type).toBe("text")
    expect(confirmation.type).toBe("password")
    expect(next.value).toBe("new-secret")
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it("provides accessible links to both public legal documents", () => {
    render(<PrivacySecurityScreen />)

    expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe(
      "/terms?returnTo=privacy-security",
    )
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
      "/privacy?returnTo=privacy-security",
    )
  })

  it("validates password length, same-password changes, and confirmation", async () => {
    render(<PrivacySecurityScreen />)
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))
    expect((await screen.findByRole("alert")).textContent).toContain("between 12 and 128")
    expect(mocks.changePassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "different from your current password",
    )

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "AQuiteDifferentPassword456!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "NotTheSamePassword456!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))
    expect((await screen.findByRole("alert")).textContent).toContain("do not match")
  })

  it("shows the server's wrong-current-password response without clearing the session", async () => {
    mocks.changePassword.mockRejectedValue(
      new ApiError("Current password incorrect.", 400, "validation"),
    )
    render(<PrivacySecurityScreen />)

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "incorrect" } })
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "AQuiteDifferentPassword456!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "AQuiteDifferentPassword456!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Current password incorrect.")
    expect(mocks.resetUserData).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalledWith("login")
  })

  it("clears local data and routes to login after a successful password change", async () => {
    mocks.changePassword.mockResolvedValue(undefined)
    render(<PrivacySecurityScreen />)

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "AQuiteDifferentPassword456!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "AQuiteDifferentPassword456!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    await waitFor(() => {
      expect(mocks.changePassword).toHaveBeenCalledWith(
        "StrongPassword123!",
        "AQuiteDifferentPassword456!",
      )
      expect(mocks.resetUserData).toHaveBeenCalledOnce()
      expect(mocks.navigate).toHaveBeenCalledWith("login")
    })
  })

  it("preserves deletion intent for household resolution without deleting the account", async () => {
    mocks.households = [{ id: "house-1", name: "Maple House", currentUserRole: "OWNER" }]
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))

    await screen.findByText("Maple House")
    expect(screen.getAllByText("You still own households.").length).toBeGreaterThan(0)
    expect(
      screen.queryByLabelText("I understand that deleting my account is permanent."),
    ).toBeNull()

    // Ownership resolution is independent from account-deletion acknowledgement.
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }))
    expect(mocks.beginAccountDeletion).toHaveBeenCalledWith("user-1")
    expect(mocks.selectHousehold).toHaveBeenCalledWith("house-1")
    expect(mocks.navigate).toHaveBeenCalledWith("household")
    expect(mocks.deleteAccount).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete household" }))
    expect(mocks.beginAccountDeletion).toHaveBeenLastCalledWith("user-1")
    expect(mocks.selectHousehold).toHaveBeenCalledWith("house-1")
    expect(mocks.navigate).toHaveBeenCalledWith("household-settings")
  })

  it("returns Back to Welcome for a user without a household", () => {
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(mocks.navigate).toHaveBeenCalledWith("welcome")
  })

  it("requires acknowledgement, full email, and password before reviewing deletion", async () => {
    mocks.deleteAccount.mockResolvedValue(undefined)
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    await screen.findByLabelText("I understand that deleting my account is permanent.")
    const continueButton = screen.getByRole("button", { name: "Continue" })
    expect((continueButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText("I understand that deleting my account is permanent."))
    fireEvent.click(continueButton)
    const reviewButton = screen.getByRole("button", { name: "Review account deletion" })
    expect((reviewButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: "other@example.com" },
    })
    fireEvent.change(screen.getAllByLabelText("Current password")[1], {
      target: { value: "StrongPassword123!" },
    })
    expect((reviewButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: "USER@Example.COM" },
    })
    expect((reviewButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(reviewButton)
    const dialog = await screen.findByRole("dialog", { name: "Permanently delete your account?" })
    expect(dialog.textContent).toContain("you will be signed out")
    expect(dialog.textContent).toContain("cannot be undone")
    expect(dialog.textContent).not.toContain("StrongPassword123!")
    expect(mocks.deleteAccount).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Account email") as HTMLInputElement).value).toBe(
      "USER@Example.COM",
    )
    expect((screen.getAllByLabelText("Current password")[1] as HTMLInputElement).value).toBe(
      "StrongPassword123!",
    )
    fireEvent.click(screen.getByRole("button", { name: "Review account deletion" }))
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Permanently delete your account?" })).getByRole(
        "button",
        { name: "Permanently delete account" },
      ),
    )

    await waitFor(() => {
      expect(mocks.deleteAccount).toHaveBeenCalledWith("StrongPassword123!", "user@example.com")
      expect(mocks.deleteAccount).toHaveBeenCalledOnce()
      expect(mocks.resetUserData).toHaveBeenCalledOnce()
      expect(mocks.navigate).toHaveBeenCalledWith("login")
      expect(mocks.removeBrowserPushSubscription).toHaveBeenCalledOnce()
    })
  })

  it("turns the server ownership conflict into a visible household blocker", async () => {
    mocks.deleteAccount.mockRejectedValue(
      new ApiError("You still own households.", 409, "conflict", {
        ownedHouseholds: [{ id: "house-2", name: "Cedar Home" }],
      }),
    )
    mocks.refresh.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "house-2",
        name: "Cedar Home",
        timezone: "UTC",
        currentUserRole: "OWNER",
        createdAt: "2026-10-01T00:00:00Z",
      },
    ])
    render(<PrivacySecurityScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    await screen.findByLabelText("I understand that deleting my account is permanent.")
    fireEvent.click(screen.getByLabelText("I understand that deleting my account is permanent."))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: "user@example.com" },
    })
    fireEvent.change(screen.getAllByLabelText("Current password")[1], {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review account deletion" }))
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Permanently delete your account?" })).getByRole(
        "button",
        { name: "Permanently delete account" },
      ),
    )

    expect(await screen.findByText("Cedar Home")).toBeTruthy()
    expect(screen.getAllByText("You still own households.").length).toBeGreaterThan(0)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(mocks.resetUserData).not.toHaveBeenCalled()
  })

  it("supports passwordless Google users without requiring password fields for deletion", async () => {
    mocks.user.hasPassword = false
    mocks.user.authProviders = ["GOOGLE"]
    mocks.features = { google: true, passwordReset: true }
    mocks.deleteAccount.mockResolvedValue(undefined)
    render(<PrivacySecurityScreen />)

    expect(screen.getByText(/uses Google to sign in/i)).toBeTruthy()
    expect(screen.queryByLabelText("Current password")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Set a password by email" }))
    expect(mocks.navigate).toHaveBeenCalledWith("forgot-password")

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    await screen.findByLabelText("I understand that deleting my account is permanent.")
    fireEvent.click(screen.getByLabelText("I understand that deleting my account is permanent."))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.queryByLabelText("Current password")).toBeNull()
    expect(
      screen.getByRole("button", { name: /Reauthenticate with Google, then retry/ }),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: "user@example.com" },
    })
    const reviewButton = screen.getByRole("button", { name: "Review account deletion" })
    expect((reviewButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(reviewButton)
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Permanently delete your account?" })).getByRole(
        "button",
        { name: "Permanently delete account" },
      ),
    )

    await waitFor(() => {
      expect(mocks.deleteAccount).toHaveBeenCalledWith("", "user@example.com")
    })
  })

  it("preserves failed Google reauthentication context and offers a retry message", () => {
    mocks.user.hasPassword = false
    mocks.user.authProviders = ["GOOGLE"]
    mocks.features = { google: true, passwordReset: true }
    window.history.replaceState({}, "", "/?auth=google-error&screen=privacy-security")

    render(<PrivacySecurityScreen />)

    expect(screen.getByRole("status").textContent).toContain(
      "Google verification was not completed",
    )
    expect(window.location.search).toBe("?screen=privacy-security")
    window.history.replaceState({}, "", "/")
  })
})
