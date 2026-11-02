// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: {
    user: { userId: "user-1", email: "pending@example.com" },
    emailVerificationStatus: {
      email: "pending@example.com",
      emailVerified: false,
      codeExpiresAt: null as string | null,
      resendAvailableAt: null as string | null,
      deliveryState: "SENT" as "SENT" | "FAILED" | "NONE" | "PENDING",
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
    Object.assign(mocks.auth.emailVerificationStatus, {
      deliveryState: "SENT",
      codeExpiresAt: null,
      resendAvailableAt: null,
    })
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

    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeTruthy()
    expect(screen.getByText("pending@example.com")).toBeTruthy()
    expect(document.querySelector("main")?.className).toContain("emailPage")
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

  it("explains missing and pending delivery states without claiming a code was sent", async () => {
    mocks.auth.emailVerificationStatus.deliveryState = "NONE"
    const { rerender } = render(<EmailVerificationScreen />)

    expect(await screen.findByText(/No verification code is available yet/)).toBeTruthy()
    expect(screen.queryByText(/A verification code was sent/)).toBeNull()

    mocks.auth.emailVerificationStatus.deliveryState = "PENDING"
    rerender(<EmailVerificationScreen />)
    expect(screen.getByText(/verification email is being prepared/)).toBeTruthy()
    expect(screen.queryByText(/A verification code was sent/)).toBeNull()
  })

  it("shows expiration and keeps resend disabled during the cooldown", async () => {
    mocks.auth.emailVerificationStatus.codeExpiresAt = new Date(
      Date.now() + 5 * 60_000,
    ).toISOString()
    mocks.auth.emailVerificationStatus.resendAvailableAt = new Date(
      Date.now() + 60_000,
    ).toISOString()
    render(<EmailVerificationScreen />)

    expect(await screen.findByText(/This code expires in/)).toBeTruthy()
    const resend = screen.getByRole("button", { name: /Resend available in/ })
    expect((resend as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.auth.resendVerificationCode).not.toHaveBeenCalled()
  })

  it("announces verification errors and keeps the code available for correction", async () => {
    mocks.auth.verifyEmail.mockRejectedValueOnce(
      new ApiError("That code has expired.", 400, "validation"),
    )
    render(<EmailVerificationScreen />)
    const code = await screen.findByRole("textbox", { name: "Six-digit code" })
    fireEvent.change(code, { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }))

    expect((await screen.findByRole("alert")).textContent).toContain("That code has expired.")
    expect((code as HTMLInputElement).value).toBe("123456")
  })

  it("shows a distinct status-checking presentation while verification status is loading", async () => {
    mocks.auth.refreshEmailVerificationStatus.mockReturnValueOnce(new Promise(() => {}))
    render(<EmailVerificationScreen />)

    expect(await screen.findByText(/Checking verification status/)).toBeTruthy()
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

  it("preserves sign-out behavior", async () => {
    render(<EmailVerificationScreen />)
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))

    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledWith("login")
  })
})
