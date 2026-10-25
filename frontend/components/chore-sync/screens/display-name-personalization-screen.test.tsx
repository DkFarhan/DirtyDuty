// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"
import { DisplayNamePersonalizationScreen } from "./display-name-personalization-screen"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  completeDisplayNamePersonalization: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  user: {
    userId: "user-1",
    displayName: "Signup Name",
  },
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({
    user: mocks.user,
    completeDisplayNamePersonalization: mocks.completeDisplayNamePersonalization,
  }),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({ navigate: mocks.navigate }),
}))

vi.mock("@/lib/profile/api", () => ({
  profileApi: {
    update: mocks.update,
    completeDisplayNamePersonalization: mocks.complete,
  },
}))

describe("DisplayNamePersonalizationScreen", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.displayName = "Signup Name"
  })

  afterEach(() => cleanup())

  it("prefills and saves a trimmed personalized name through the profile API", async () => {
    mocks.update.mockResolvedValue({ displayName: "Sam" })
    render(<DisplayNamePersonalizationScreen />)

    const input = screen.getByRole("textbox", { name: "Display name" }) as HTMLInputElement
    expect(input.value).toBe("Signup Name")
    fireEvent.change(input, { target: { value: "  Sam  " } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith({ displayName: "Sam" })
      expect(mocks.completeDisplayNamePersonalization).toHaveBeenCalledWith("Sam")
      expect(mocks.navigate).toHaveBeenCalledWith("welcome")
    })
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it("keeps the existing name without sending a profile name update when skipped", async () => {
    mocks.complete.mockResolvedValue(undefined)
    render(<DisplayNamePersonalizationScreen />)
    fireEvent.click(screen.getByRole("button", { name: "Use my existing name" }))

    await waitFor(() => {
      expect(mocks.complete).toHaveBeenCalledOnce()
      expect(mocks.completeDisplayNamePersonalization).toHaveBeenCalledWith("Signup Name")
      expect(mocks.navigate).toHaveBeenCalledWith("welcome")
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("blocks an empty name and reports a failed save while allowing retry", async () => {
    mocks.update.mockRejectedValueOnce(new ApiError("Display name is required.", 400, "validation"))
    render(<DisplayNamePersonalizationScreen />)
    const input = screen.getByRole("textbox", { name: "Display name" })

    fireEvent.change(input, { target: { value: "   " } })
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.change(input, { target: { value: "Sam" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Display name is required.")
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it("prevents duplicate submissions while a save is pending", async () => {
    let resolveUpdate!: (profile: { displayName: string }) => void
    mocks.update.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve
      }),
    )
    render(<DisplayNamePersonalizationScreen />)
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Sam" },
    })
    const continueButton = screen.getByRole("button", { name: "Continue" })
    fireEvent.click(continueButton)
    fireEvent.click(continueButton)
    expect(mocks.update).toHaveBeenCalledOnce()

    resolveUpdate({ displayName: "Sam" })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("welcome"))
  })
})
