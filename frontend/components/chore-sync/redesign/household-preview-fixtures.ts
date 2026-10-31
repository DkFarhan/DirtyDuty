import type { HouseholdMemberDTO } from "@/lib/household/api"
import type {
  HouseholdLeaveFlow,
  HouseholdScreenViewModel,
  HouseholdViewStatus,
} from "./household-screen-view"
import type { MemberAction } from "../member-card"

export type HouseholdPreviewScenario =
  | "owner-3"
  | "admin-3"
  | "member-3"
  | "owner-0"
  | "owner-1"
  | "admin-20"
  | "loading"
  | "error"
  | "refresh-error"
  | "owner-menu"
  | "admin-menu"
  | "member-action"
  | "member-leave"
  | "owner-successor"
  | "owner-confirm"
  | "sole-owner"
  | "long-names"
  | "invite-ready"
  | "invite-error"
  | "invite-created"

export interface HouseholdPreviewFixture {
  viewModel: HouseholdScreenViewModel
  openMemberMenuId: string | null
  pendingMemberAction: { action: MemberAction; member: HouseholdMemberDTO } | null
  confirmText: string
  leaveFlow: HouseholdLeaveFlow
  selectedNewOwnerId: string
  leaveError: string | null
  memberActionError: string | null
  previewInvite: {
    status: "ready" | "loading" | "error" | "created"
    code?: string
    expiresAt?: string
    errorMessage?: string
  } | null
}

const scenarioLabels: Record<HouseholdPreviewScenario, string> = {
  "owner-3": "Owner · 3 members",
  "admin-3": "Admin · 3 members",
  "member-3": "Member · 3 members",
  "owner-0": "Owner · 0 members",
  "owner-1": "Owner · 1 member",
  "admin-20": "Admin · 20 members",
  loading: "Loading members",
  error: "Member load error",
  "refresh-error": "Refresh error · stale data",
  "owner-menu": "Owner action menu",
  "admin-menu": "Admin action menu",
  "member-action": "Member action confirmation",
  "member-leave": "Member leave confirmation",
  "owner-successor": "Owner successor selection",
  "owner-confirm": "Owner transfer confirmation",
  "sole-owner": "Sole owner",
  "long-names": "Long names and narrow overflow",
  "invite-ready": "Invitation ready",
  "invite-error": "Invitation error",
  "invite-created": "Invitation created",
}

const baseMembers: HouseholdMemberDTO[] = [
  {
    userId: "preview-owner",
    displayName: "Farhan Habib",
    role: "OWNER",
    joinedAt: "2026-10-01T12:00:00Z",
    assignedThisWeek: 1,
    completedThisWeek: 0,
  },
  {
    userId: "preview-admin",
    displayName: "Salman",
    role: "ADMIN",
    joinedAt: "2026-10-02T12:00:00Z",
    assignedThisWeek: 3,
    completedThisWeek: 1,
  },
  {
    userId: "preview-member",
    displayName: "Farhan Habib",
    role: "MEMBER",
    joinedAt: "2026-10-03T12:00:00Z",
    assignedThisWeek: 1,
    completedThisWeek: 0,
  },
]

function mapMembers(role: "OWNER" | "ADMIN" | "MEMBER", count: number) {
  const members = baseMembers.map((member) => ({ ...member }))
  if (role === "MEMBER") members[1].role = "MEMBER"

  for (let index = members.length; index < count; index += 1) {
    members.push({
      userId: `preview-member-${index + 1}`,
      displayName: index === 3 ? "Maya Chen" : `Member ${String(index + 1).padStart(2, "0")}`,
      role: "MEMBER",
      joinedAt: `2026-10-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      assignedThisWeek: index % 4,
      completedThisWeek: index % 3,
    })
  }
  return members.slice(0, count)
}

function viewModel(
  role: "OWNER" | "ADMIN" | "MEMBER",
  members: HouseholdMemberDTO[],
  status: HouseholdViewStatus = "loaded",
  refreshError?: string,
  errorMessage?: string,
): HouseholdScreenViewModel {
  return {
    householdName: "1501",
    currentUserRole: role,
    currentUserId: role === "ADMIN" || role === "MEMBER" ? "preview-admin" : "preview-owner",
    canManage: role === "OWNER" || role === "ADMIN",
    status,
    refreshError,
    errorMessage,
    members: members.map((member) => ({
      ...member,
      isCurrentUser: member.userId === (role === "OWNER" ? "preview-owner" : "preview-admin"),
      joinedLabel: "Joined Oct 2026",
      progressPercent:
        member.assignedThisWeek > 0
          ? Math.min(100, Math.round((member.completedThisWeek / member.assignedThisWeek) * 100))
          : 0,
    })),
  }
}

function baseFixture(role: "OWNER" | "ADMIN" | "MEMBER", count = 3): HouseholdPreviewFixture {
  return {
    viewModel: viewModel(role, mapMembers(role, count)),
    openMemberMenuId: null,
    pendingMemberAction: null,
    confirmText: "",
    leaveFlow: "closed",
    selectedNewOwnerId: "",
    leaveError: null,
    memberActionError: null,
    previewInvite: null,
  }
}

export const householdPreviewScenarios = Object.keys(scenarioLabels) as HouseholdPreviewScenario[]

export function householdPreviewScenarioLabel(scenario: HouseholdPreviewScenario) {
  return scenarioLabels[scenario]
}

export function createHouseholdPreviewFixture(
  scenario: HouseholdPreviewScenario,
): HouseholdPreviewFixture {
  switch (scenario) {
    case "owner-0":
      return baseFixture("OWNER", 0)
    case "owner-1":
      return baseFixture("OWNER", 1)
    case "admin-20":
      return baseFixture("ADMIN", 20)
    case "loading":
      return {
        ...baseFixture("ADMIN", 0),
        viewModel: viewModel("ADMIN", [], "loading"),
      }
    case "error":
      return {
        ...baseFixture("ADMIN", 0),
        viewModel: viewModel(
          "ADMIN",
          [],
          "error",
          undefined,
          "Unable to load household members. Please try again.",
        ),
      }
    case "refresh-error":
      return {
        ...baseFixture("ADMIN"),
        viewModel: viewModel(
          "ADMIN",
          mapMembers("ADMIN", 3),
          "loaded",
          "Unable to refresh household members. Your current list is still available.",
        ),
      }
    case "owner-menu":
      return { ...baseFixture("OWNER"), openMemberMenuId: "preview-admin" }
    case "admin-menu":
      return { ...baseFixture("ADMIN"), openMemberMenuId: "preview-member" }
    case "member-action": {
      const fixture = baseFixture("OWNER")
      const member = fixture.viewModel.members[2]
      return {
        ...fixture,
        pendingMemberAction: { action: "promote", member },
      }
    }
    case "member-leave":
      return { ...baseFixture("MEMBER"), leaveFlow: "member-confirm" }
    case "owner-successor":
      return {
        ...baseFixture("OWNER"),
        leaveFlow: "owner-select",
        selectedNewOwnerId: "preview-admin",
      }
    case "owner-confirm":
      return {
        ...baseFixture("OWNER"),
        leaveFlow: "owner-confirm",
        selectedNewOwnerId: "preview-admin",
      }
    case "sole-owner":
      return { ...baseFixture("OWNER", 1), leaveFlow: "owner-select" }
    case "long-names": {
      const members = mapMembers("OWNER", 3)
      members[0].displayName = "Farhan Habib with a remarkably long household display name"
      members[1].displayName = "An exceptionally long name for a household administrator"
      members[2].displayName = "Member name that should wrap without hiding role actions"
      return { ...baseFixture("OWNER"), viewModel: viewModel("OWNER", members) }
    }
    case "invite-ready":
      return {
        ...baseFixture("ADMIN"),
        previewInvite: { status: "ready" },
      }
    case "invite-error":
      return {
        ...baseFixture("ADMIN"),
        previewInvite: { status: "error", errorMessage: "No code was generated. Try again." },
      }
    case "invite-created":
      return {
        ...baseFixture("ADMIN"),
        previewInvite: {
          status: "created",
          code: "PREVIEW-ONE-TIME-CODE",
          expiresAt: "Oct 31, 2026",
        },
      }
    case "owner-3":
      return baseFixture("OWNER")
    case "member-3":
      return baseFixture("MEMBER")
    case "admin-3":
    default:
      return baseFixture("ADMIN")
  }
}
