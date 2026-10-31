// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"
import { householdApi, type Household } from "@/lib/household/api"
import { InviteHousemateDialog } from "./invite-housemate-dialog"

vi.mock("@/lib/household/api", () => ({
  householdApi: {
    createInvitation: vi.fn(),
  },
}))

const household: Household = {
  id: "household/one",
  name: "1501",
  timezone: "UTC",
  currentUserRole: "ADMIN",
  createdAt: "2026-10-01T12:00:00Z",
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
})

describe("redesigned household invitation dialog", () => {
  it("retries secure generation after errors and copies the generated code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    vi.mocked(householdApi.createInvitation)
      .mockRejectedValueOnce(new ApiError("Invitation service unavailable.", 503, "server"))
      .mockResolvedValueOnce({
        inviteCode: "SECURE-ONE-TIME-CODE",
        expiresAt: "2026-10-31T12:00:00Z",
      })

    render(
      <InviteHousemateDialog
        household={household}
        onOpenChange={onOpenChange}
        open
        redesigned
        theme="light"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Generate code" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Invitation service unavailable.",
    )

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("SECURE-ONE-TIME-CODE")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Copy invitation code" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("SECURE-ONE-TIME-CODE"))
    expect(await screen.findByRole("button", { name: "Invitation code copied" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
