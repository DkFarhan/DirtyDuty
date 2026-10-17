// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLegalDocumentUrl } from "@/lib/chore-sync/legal-navigation"
import { LegalAcceptanceScreen } from "./screens/legal-acceptance-screen"

const mocks = vi.hoisted(() => ({
  completeLegalAcceptance: vi.fn(),
  logout: vi.fn(),
  navigate: vi.fn(),
  resetUserData: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    completeLegalAcceptance: mocks.completeLegalAcceptance,
    logout: mocks.logout,
  }),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    navigate: mocks.navigate,
    resetUserData: mocks.resetUserData,
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({ refresh: mocks.refresh }),
}))

describe("LegalAcceptanceScreen", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.completeLegalAcceptance.mockResolvedValue(undefined)
    mocks.logout.mockResolvedValue(undefined)
    mocks.refresh.mockResolvedValue([])
  })

  afterEach(() => cleanup())

  it("opens both policies in the same tab with the acceptance screen as return target", () => {
    render(<LegalAcceptanceScreen />)

    expect(screen.getByRole("link", { name: /Terms of Service/ }).getAttribute("href")).toBe(
      getLegalDocumentUrl("/terms", "legal-acceptance"),
    )
    expect(screen.getByRole("link", { name: /Privacy Policy/ }).getAttribute("href")).toBe(
      getLegalDocumentUrl("/privacy", "legal-acceptance"),
    )
    expect(screen.getByRole("link", { name: /Privacy Policy/ }).getAttribute("target")).toBeNull()
  })

  it("requires acknowledgement and refreshes household data after completion", async () => {
    render(<LegalAcceptanceScreen />)

    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(mocks.completeLegalAcceptance).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I agree to the Terms of Service and acknowledge the Privacy Policy.",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => {
      expect(mocks.completeLegalAcceptance).toHaveBeenCalledOnce()
      expect(mocks.refresh).toHaveBeenCalledOnce()
      expect(mocks.navigate).toHaveBeenCalledWith("welcome")
    })
  })

  it("allows users to sign out from the required-acceptance screen", async () => {
    render(<LegalAcceptanceScreen />)

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalledOnce()
      expect(mocks.resetUserData).toHaveBeenCalledOnce()
      expect(mocks.navigate).toHaveBeenCalledWith("login")
    })
  })
})
