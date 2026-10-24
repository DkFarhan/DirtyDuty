// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: {
    user: { userId: "user-1", email: "pending@example.com" },
    emailVerificationStatus: {
      email: "pending@example.com",
      emailVerified: false,
      codeExpiresAt: null,
      resendAvailableAt: null,
      deliveryState: "SENT" as "SENT" | "FAILED" | "NONE",
    },
    refreshEmailVerificationStatus: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerificationCode: vi.fn(),
    correctVerificationEmail: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  },
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => mocks.auth,
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

import { EmailVerificationScreen } from "./email-verification-screen"

describe("EmailVerificationScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.emailVerificationStatus.deliveryState = "SENT"
    mocks.auth.refreshEmailVerificationStatus.mockResolvedValue(mocks.auth.emailVerificationStatus)
    mocks.auth.verifyEmail.mockResolvedValue({ emailVerified: true })
    mocks.auth.resendVerificationCode.mockResolvedValue(mocks.auth.emailVerificationStatus)
    mocks.auth.correctVerificationEmail.mockResolvedValue(undefined)
    mocks.auth.logout.mockResolvedValue(undefined)
    mocks.auth.refreshUser.mockResolvedValue({ emailVerified: false })
  })

  afterEach(() => cleanup())

  it("accepts numeric paste/input, applies autofill attributes, and verifies the code", async () => {
    render(<EmailVerificationScreen />)

    expect(
      await screen.findByText("A verification code was sent to pending@example.com."),
    ).toBeTruthy()
    const code = screen.getByRole("textbox", { name: "Six-digit code" }) as HTMLInputElement
    expect(code.inputMode).toBe("numeric")
    expect(code.autocomplete).toBe("one-time-code")
    expect(code.maxLength).toBe(6)

    fireEvent.change(code, { target: { value: "12a34 56-789" } })
    expect(code.value).toBe("123456")
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }))

    await waitFor(() => expect(mocks.auth.verifyEmail).toHaveBeenCalledWith("123456"))
    expect(mocks.navigate).toHaveBeenCalledWith("welcome")
  })

  it("never claims delivery after failure and offers resend", async () => {
    mocks.auth.emailVerificationStatus.deliveryState = "FAILED"
    render(<EmailVerificationScreen />)

    expect(await screen.findByText(/We couldn.t deliver a verification code/)).toBeTruthy()
    expect(screen.queryByText(/A verification code was sent/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }))

    await waitFor(() => expect(mocks.auth.resendVerificationCode).toHaveBeenCalledOnce())
  })

  it("submits the wrong-email flow and returns to login", async () => {
    render(<EmailVerificationScreen />)
    await screen.findByText("A verification code was sent to pending@example.com.")
    fireEvent.click(screen.getByRole("button", { name: "Wrong email address?" }))
    fireEvent.change(screen.getByLabelText("Correct email"), {
      target: { value: "correct@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "account-password" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update email and sign in" }))

    await waitFor(() =>
      expect(mocks.auth.correctVerificationEmail).toHaveBeenCalledWith(
        "correct@example.com",
        "account-password",
      ),
    )
    expect(mocks.navigate).toHaveBeenCalledWith("login")
  })
})
