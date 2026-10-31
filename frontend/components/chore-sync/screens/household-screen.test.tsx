// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  household: {
    id: "home-1",
    name: "Home A",
    timezone: "UTC",
    currentUserRole: "OWNER",
    createdAt: "2026-10-01T00:00:00Z",
  },
  members: vi.fn(),
  leave: vi.fn(),
  transferOwnership: vi.fn(),
  removeHousehold: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    state: { currentUser: { id: "owner-1" } },
    navigate: mocks.navigate,
    pendingAccountDeletionUserId: null,
    clearAccountDeletion: vi.fn(),
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    households: [mocks.household],
    activeHousehold: mocks.household,
    refresh: mocks.refresh,
    removeHousehold: mocks.removeHousehold,
  }),
}))

vi.mock("@/lib/household/api", () => ({
  householdApi: {
    members: mocks.members,
    leave: mocks.leave,
    transferOwnership: mocks.transferOwnership,
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
}))

vi.mock("../invite-housemate-dialog", () => ({
  InviteHousemateDialog: () => null,
}))

import { HouseholdScreen } from "./household-screen"

const ownerMembers = [
  {
    userId: "owner-1",
    displayName: "Jordan",
    role: "OWNER",
    joinedAt: "2026-10-01T00:00:00Z",
    assignedThisWeek: 3,
    completedThisWeek: 1,
  },
  {
    userId: "successor-1",
    displayName: "Alex",
    role: "ADMIN",
    joinedAt: "2026-10-02T00:00:00Z",
    assignedThisWeek: 2,
    completedThisWeek: 2,
  },
]

describe("HouseholdScreen owner leave confirmation", () => {
  beforeEach(() => {
    mocks.household.currentUserRole = "OWNER"
    mocks.members.mockReset().mockResolvedValue(ownerMembers)
    mocks.leave.mockReset().mockResolvedValue(undefined)
    mocks.transferOwnership.mockReset().mockResolvedValue(undefined)
    mocks.removeHousehold.mockReset().mockReturnValue([])
    mocks.refresh.mockReset().mockResolvedValue([])
    mocks.navigate.mockReset()
  })

  afterEach(() => cleanup())

  async function openOwnerSuccessorSelection() {
    render(<HouseholdScreen redesigned theme="dark" />)
    await screen.findByText("Jordan")
    fireEvent.click(screen.getByRole("button", { name: "Leave household" }))
    fireEvent.click(screen.getByRole("radio", { name: /Alex/ }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  }

  it("Continue only advances to confirmation and never submits a leave or transfer request", async () => {
    await openOwnerSuccessorSelection()

    expect(
      await screen.findByRole("heading", { name: "Transfer ownership to Alex and leave?" }),
    ).toBeTruthy()
    expect(
      screen.getByText("Alex becomes Owner. You leave the household in the same action."),
    ).toBeTruthy()
    expect(mocks.leave).not.toHaveBeenCalled()
    expect(mocks.transferOwnership).not.toHaveBeenCalled()
  })

  it("Back and Cancel do not modify membership", async () => {
    await openOwnerSuccessorSelection()

    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByRole("heading", { name: "Pass the keys." })).toBeTruthy()
    expect(mocks.leave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.leave).not.toHaveBeenCalled()
    expect(mocks.transferOwnership).not.toHaveBeenCalled()
  })

  it("only final confirmation submits once with the selected successor", async () => {
    let finishLeave!: () => void
    mocks.leave.mockReturnValue(
      new Promise<void>((resolve) => {
        finishLeave = resolve
      }),
    )
    await openOwnerSuccessorSelection()

    const finalConfirmation = screen.getByRole("button", { name: "Transfer and leave" })
    fireEvent.click(finalConfirmation)
    fireEvent.click(finalConfirmation)

    expect(mocks.leave).toHaveBeenCalledTimes(1)
    expect(mocks.leave).toHaveBeenCalledWith("home-1", "successor-1")
    expect(mocks.transferOwnership).not.toHaveBeenCalled()
    finishLeave()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("keeps the confirmation open with a readable error when the API fails", async () => {
    mocks.leave.mockRejectedValue(new Error("network unavailable"))
    await openOwnerSuccessorSelection()

    fireEvent.click(screen.getByRole("button", { name: "Transfer and leave" }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Unable to leave this household. Please try again.",
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(mocks.leave).toHaveBeenCalledTimes(1)
  })

  it("keeps management cards connected to their existing application routes", async () => {
    render(<HouseholdScreen redesigned theme="dark" />)
    await screen.findByText("Jordan")

    expect(screen.getByRole("heading", { name: "Manage household" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Manage chores/ }))
    expect(mocks.navigate).toHaveBeenCalledWith("admin", "chores")

    fireEvent.click(screen.getByRole("button", { name: /Household settings/ }))
    expect(mocks.navigate).toHaveBeenCalledWith("household-settings")
  })

  it("preserves ordinary member leave and blocks a sole owner from submitting", async () => {
    mocks.household.currentUserRole = "MEMBER"
    mocks.members.mockResolvedValue([
      { ...ownerMembers[0], role: "MEMBER" },
      { ...ownerMembers[1], role: "OWNER" },
    ])
    render(<HouseholdScreen redesigned theme="dark" />)
    await screen.findByText("Jordan")
    fireEvent.click(screen.getByRole("button", { name: "Leave household" }))
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Leave household" }),
    )
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(1))
    expect(mocks.leave).toHaveBeenCalledWith("home-1", undefined)

    cleanup()
    mocks.household.currentUserRole = "OWNER"
    mocks.members.mockResolvedValue([ownerMembers[0]])
    render(<HouseholdScreen redesigned theme="dark" />)
    await screen.findByText("Jordan")
    fireEvent.click(screen.getByRole("button", { name: "Leave household" }))
    expect(await screen.findByText("You’re the only active member")).toBeTruthy()
    expect(mocks.leave).toHaveBeenCalledTimes(1)
    expect(mocks.transferOwnership).not.toHaveBeenCalled()
  })
})
