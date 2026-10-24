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

describe("LoginScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => cleanup())

  it("does not expose a separate pending signup recovery flow", () => {
    render(<LoginScreen />)
    expect(screen.queryByRole("button", { name: "Recover a pending signup" })).toBeNull()
    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sign up" })).toBeTruthy()
  })
})
