// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  register: vi.fn(),
  googleEnabled: false,
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    register: mocks.register,
    features: { google: mocks.googleEnabled, passwordReset: true, emailVerification: true },
  }),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

import { RegisterScreen } from "./register-screen"
import styles from "./auth-screens.module.css"

describe("RegisterScreen duplicate signup guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.googleEnabled = false
    window.sessionStorage.clear()
  })

  afterEach(() => cleanup())

  it("shows the shared accessible Google action only when enabled", () => {
    mocks.googleEnabled = true
    render(<RegisterScreen />)

    const button = screen.getByRole("button", { name: "Continue with Google" })
    expect(button.querySelector(".google-sign-in-icon")?.textContent).toBe("G")
    expect(button.querySelector(".google-sign-in-label")?.textContent).toBe("Continue with Google")
    expect(button.className).toContain(styles.googleButton)
  })

  it("offers sign-in and recovery while preserving the entered email", async () => {
    mocks.register.mockRejectedValueOnce(
      new ApiError(
        "Unable to complete registration with this email. If you've registered before, try signing in or recovering your account.",
        409,
        "conflict",
      ),
    )
    render(<RegisterScreen />)
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Existing User" } })
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }))

    await screen.findByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "Forgot Password" }))

    expect(window.sessionStorage.getItem("auth-prefill-email")).toBe("person@example.com")
    expect(mocks.navigate).toHaveBeenCalledWith("forgot-password")
  })

  it("uses the same centered stacked brand while retaining back navigation", () => {
    render(<RegisterScreen />)
    const brand = screen.getByRole("banner")
    expect(brand.className).toContain(styles.centeredBrand)
    expect(brand.querySelector('img[alt="DirtyDuty"]')).toBeTruthy()
    expect(brand.textContent).toContain("Keep your home running smoothly")
    expect(screen.getByRole("button", { name: "Back to sign in" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Create account" }).className).toContain(
      styles.title,
    )
  })
})
