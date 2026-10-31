import { describe, expect, it } from "vitest"
import type { Household, HouseholdMemberDTO } from "@/lib/household/api"
import { createHouseholdApplicationViewModel } from "./household-application-adapter"

const household: Household = {
  id: "home-1",
  name: "Apartment 305",
  timezone: "America/Sao_Paulo",
  currentUserRole: "OWNER",
  createdAt: "2026-10-01T00:00:00Z",
}

function member(overrides: Partial<HouseholdMemberDTO> = {}): HouseholdMemberDTO {
  return {
    userId: "user-1",
    displayName: "Farhan Habib",
    role: "OWNER",
    joinedAt: "2026-10-01T12:00:00Z",
    assignedThisWeek: 1,
    completedThisWeek: 0,
    ...overrides,
  }
}

describe("Household application adapter", () => {
  it("maps live household/member values and marks the current user without changing server data", () => {
    const viewModel = createHouseholdApplicationViewModel({
      household,
      members: [
        member(),
        member({
          userId: "user-2",
          displayName: "Salman",
          role: "ADMIN",
          assignedThisWeek: 3,
          completedThisWeek: 1,
        }),
      ],
      currentUserId: "user-2",
      status: "loaded",
      errorMessage: null,
      refreshError: "Refresh failed.",
    })

    expect(viewModel).toMatchObject({
      householdName: "Apartment 305",
      currentUserRole: "OWNER",
      canManage: true,
      status: "loaded",
      refreshError: "Refresh failed.",
    })
    expect(viewModel.members).toEqual([
      expect.objectContaining({
        userId: "user-1",
        displayName: "Farhan Habib",
        role: "OWNER",
        joinedAt: "2026-10-01T12:00:00Z",
        assignedThisWeek: 1,
        completedThisWeek: 0,
        joinedLabel: "Joined Oct 2026",
        progressPercent: 0,
        isCurrentUser: false,
      }),
      expect.objectContaining({
        userId: "user-2",
        displayName: "Salman",
        role: "ADMIN",
        assignedThisWeek: 3,
        completedThisWeek: 1,
        progressPercent: 33,
        isCurrentUser: true,
      }),
    ])
  })

  it("keeps zero-denominator progress safe and clamps inconsistent completion totals", () => {
    const viewModel = createHouseholdApplicationViewModel({
      household: { ...household, currentUserRole: "MEMBER" },
      members: [
        member({ assignedThisWeek: 0, completedThisWeek: 0 }),
        member({ userId: "user-2", assignedThisWeek: 2, completedThisWeek: 3 }),
      ],
      currentUserId: "user-1",
      status: "loaded",
      errorMessage: null,
      refreshError: null,
    })

    expect(viewModel.canManage).toBe(false)
    expect(viewModel.members.map((item) => item.progressPercent)).toEqual([0, 100])
  })

  it("preserves error/loading data shape and handles unavailable dates", () => {
    const viewModel = createHouseholdApplicationViewModel({
      household: null,
      members: [member({ joinedAt: "invalid" })],
      currentUserId: "user-1",
      status: "error",
      errorMessage: "Unable to load.",
      refreshError: null,
    })

    expect(viewModel).toMatchObject({
      householdName: "Your household",
      currentUserRole: "MEMBER",
      canManage: false,
      status: "error",
      errorMessage: "Unable to load.",
    })
    expect(viewModel.members[0].joinedLabel).toBe("Join date unavailable")
  })
})
