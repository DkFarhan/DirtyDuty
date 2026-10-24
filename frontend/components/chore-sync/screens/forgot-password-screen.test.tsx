// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  requestPasswordReset: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ requestPasswordReset: mocks.requestPasswordReset }),
}))

import { ForgotPasswordScreen } from "./forgot-password-screen"

describe("forgot password screen", () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.requestPasswordReset.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("submits the email and replaces the form with a generic confirmation", async () => {
    mocks.requestPasswordReset.mockResolvedValueOnce(undefined)
    render(<ForgotPasswordScreen />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }))

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe(
      "If an account exists for this email, we'll send you a password reset link.",
    )
    expect(
      screen.getByText(
        "Check your inbox and spam folder. The reset link expires after 30 minutes.",
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Email")).toBeNull()
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith("person@example.com")
  })

  it("requires the full cooldown before enabling resend, then starts a new cooldown", async () => {
    vi.useFakeTimers()
    mocks.requestPasswordReset.mockResolvedValue(undefined)
    render(<ForgotPasswordScreen initialEmail="person@example.com" />)
    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole("timer").textContent).toContain("60 seconds")
    expect(screen.queryByRole("button", { name: "Resend email" })).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000)
    })
    expect(screen.getByRole("timer").textContent).toContain("1 second.")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByRole("button", { name: "Resend email" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("timer").textContent).toContain("60 seconds")
  })

  it("returns to the form and clears the prior email when choosing another address", async () => {
    mocks.requestPasswordReset.mockResolvedValueOnce(undefined)
    render(<ForgotPasswordScreen initialEmail="person@example.com" />)
    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }))
    await screen.findByRole("heading", { name: "Check your email" })
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }))

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy()
    expect(screen.getByLabelText("Email")).toHaveProperty("value", "")
  })

  it("prevents duplicate submissions while the request is in flight", async () => {
    let resolveRequest!: () => void
    mocks.requestPasswordReset.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve
        }),
    )
    render(<ForgotPasswordScreen initialEmail="person@example.com" />)
    const submit = screen.getByRole("button", { name: "Send reset instructions" })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(1)
    expect((screen.getByRole("button", { name: "Sending..." }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await act(async () => resolveRequest())
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy()
  })

  it("keeps the form editable after a network failure and allows an explicit retry", async () => {
    mocks.requestPasswordReset
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(undefined)
    render(<ForgotPasswordScreen initialEmail="person@example.com" />)
    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to request")
    expect(screen.getByLabelText("Email")).toHaveProperty("value", "person@example.com")

    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }))
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy()
    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(2)
  })

  it("keeps the confirmation and cooldown after a resend failure so it can be retried later", async () => {
    vi.useFakeTimers()
    mocks.requestPasswordReset
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(undefined)
    render(<ForgotPasswordScreen initialEmail="person@example.com" />)
    fireEvent.click(screen.getByRole("button", { name: "Send reset instructions" }))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("Unable to request")
    expect(screen.getByRole("timer").textContent).toContain("60 seconds")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
