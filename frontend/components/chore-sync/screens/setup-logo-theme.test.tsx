// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  clearAccountDeletion: vi.fn(),
  resetUserData: vi.fn(),
  logout: vi.fn(),
  completeLegalAcceptance: vi.fn(),
  create: vi.fn(),
  queueCreatedHouseholdInvite: vi.fn(),
  join: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    navigate: mocks.navigate,
    clearAccountDeletion: mocks.clearAccountDeletion,
    resetUserData: mocks.resetUserData,
  }),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    logout: mocks.logout,
    completeLegalAcceptance: mocks.completeLegalAcceptance,
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    create: mocks.create,
    queueCreatedHouseholdInvite: mocks.queueCreatedHouseholdInvite,
    join: mocks.join,
    refresh: mocks.refresh,
  }),
}))

import { CreateHouseholdScreen } from "./create-household-screen"
import { JoinHouseholdScreen } from "./join-household-screen"
import { WelcomeScreen } from "./welcome-screen"

describe("setup screen branding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.logout.mockResolvedValue(undefined)
    mocks.completeLegalAcceptance.mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it.each([
    ["Welcome", WelcomeScreen],
    ["Create Household", CreateHouseholdScreen],
    ["Join Household", JoinHouseholdScreen],
  ])("uses the light and Sea-Glass logo variants on %s", (_name, Screen) => {
    render(<Screen />)

    const logo = document.querySelector(".auth-logo-surface.auth-logo-theme-aware")
    expect(logo?.querySelector(".auth-logo-theme-light")).toBeTruthy()
    expect(logo?.querySelector(".auth-logo-theme-dark")).toBeTruthy()
    expect(screen.getAllByRole("img", { name: "DirtyDuty" })).toHaveLength(1)
  })
})
