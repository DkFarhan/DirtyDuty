import type { HouseholdMemberDTO, Household } from "@/lib/household/api"
import type {
  HouseholdMemberViewModel,
  HouseholdScreenViewModel,
  HouseholdViewStatus,
} from "./household-screen-view"

export interface HouseholdApplicationViewModelInput {
  household: Household | null
  members: HouseholdMemberDTO[]
  currentUserId: string
  status: HouseholdViewStatus
  errorMessage: string | null
  refreshError: string | null
}

function joinedLabel(joinedAt: string) {
  const date = new Date(joinedAt)
  if (Number.isNaN(date.getTime())) return "Join date unavailable"

  return `Joined ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(date)}`
}

function progressPercent(completed: number, assigned: number) {
  if (assigned <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((completed / assigned) * 100)))
}

function mapMember(member: HouseholdMemberDTO, currentUserId: string): HouseholdMemberViewModel {
  return {
    ...member,
    isCurrentUser: member.userId === currentUserId,
    joinedLabel: joinedLabel(member.joinedAt),
    progressPercent: progressPercent(member.completedThisWeek, member.assignedThisWeek),
  }
}

export function createHouseholdApplicationViewModel(
  input: HouseholdApplicationViewModelInput,
): HouseholdScreenViewModel {
  const role = input.household?.currentUserRole ?? "MEMBER"

  return {
    householdName: input.household?.name ?? "Your household",
    currentUserRole: role,
    currentUserId: input.currentUserId,
    canManage: role === "OWNER" || role === "ADMIN",
    status: input.status,
    errorMessage: input.errorMessage ?? undefined,
    refreshError: input.refreshError ?? undefined,
    members: input.members.map((member) => mapMember(member, input.currentUserId)),
  }
}
