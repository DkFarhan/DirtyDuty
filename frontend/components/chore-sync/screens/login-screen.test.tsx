// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: {
    login: vi.fn(),
    authNotice: null,
    dismissAuthNotice: vi.fn(),
    features: { google: false, passwordReset: false, emailVerification: true },
    completeGoogleLink: vi.fn(),
    requestEmailVerificationRecovery: vi.fn(),
    completeEmailVerificationRecovery: vi.fn(),
  },
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => mocks.auth,
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

import { LoginScreen } from "./login-screen"

describe("LoginScreen pending signup recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.requestEmailVerificationRecovery.mockResolvedValue(undefined)
    mocks.auth.completeEmailVerificationRecovery.mockResolvedValue({
      userId: "user-1",
      emailVerified: true,
    })
  })

  afterEach(() => cleanup())

  it("shows an enumeration-safe confirmation after requesting recovery", async () => {
    render(<LoginScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Recover a pending signup" }))
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "pending@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send recovery code" }))

    expect(
      await screen.findByText(
        "If an eligible account exists for this email, a recovery code will be sent. Check your inbox and spam folder.",
      ),
    ).toBeTruthy()
    expect(mocks.auth.requestEmailVerificationRecovery).toHaveBeenCalledWith("pending@example.com")
  })

  it("completes recovery and routes to the authenticated application", async () => {
    render(<LoginScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Recover a pending signup" }))
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "pending@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send recovery code" }))
    await screen.findByLabelText("Six-digit code")
    fireEvent.change(screen.getByLabelText("Six-digit code"), {
      target: { value: "123456" },
    })
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Recovered Person" },
    })
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "RecoveredPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Verify and recover account" }))

    await waitFor(() =>
      expect(mocks.auth.completeEmailVerificationRecovery).toHaveBeenCalledWith({
        email: "pending@example.com",
        code: "123456",
        newPassword: "RecoveredPassword123!",
        displayName: "Recovered Person",
      }),
    )
    expect(mocks.navigate).toHaveBeenCalledWith("welcome")
  })
})
