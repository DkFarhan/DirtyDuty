// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: {
    login: vi.fn(),
    authNotice: null,
    dismissAuthNotice: vi.fn(),
    features: { google: false, passwordReset: false, emailVerification: true },
    completeGoogleLink: vi.fn(),
  },
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => mocks.auth,
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

import { LoginScreen } from "./login-screen"
import styles from "./auth-screens.module.css"

describe("LoginScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.features.google = false
  })

  afterEach(() => cleanup())

  it("does not expose a separate pending signup recovery flow", () => {
    render(<LoginScreen />)
    expect(screen.queryByRole("button", { name: "Recover a pending signup" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull()
    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sign up" })).toBeTruthy()
  })

  it("shows a centered Google action with a separate green mark when enabled", () => {
    mocks.auth.features.google = true
    render(<LoginScreen />)

    const button = screen.getByRole("button", { name: "Continue with Google" })
    const icon = button.querySelector(".google-sign-in-icon")
    expect(icon?.textContent).toBe("G")
    expect(icon?.getAttribute("aria-hidden")).toBe("true")
    expect(button.querySelector(".google-sign-in-label")?.textContent).toBe("Continue with Google")
    expect(button.className).toContain(styles.googleButton)
  })

  it("uses the centered stacked brand above the left-aligned introduction", () => {
    render(<LoginScreen />)
    const brand = screen.getByRole("banner")
    expect(brand.className).toContain(styles.centeredBrand)
    expect(brand.querySelector('img[alt="DirtyDuty"]')).toBeTruthy()
    expect(brand.textContent).toContain("Keep your home running smoothly")
    expect(screen.getByRole("heading", { name: "Welcome back" }).className).toContain(styles.title)
    expect(
      screen.getByText("Sign in to pick up where your household left off.").className,
    ).toContain(styles.description)
  })
})
