import { api } from "@/lib/auth/api"
import type { NotificationStyle } from "@/lib/notifications/api"

export type Household = {
  id: string
  name: string
  timezone: string
  currentUserRole: string
  createdAt: string
}

export type HouseholdSettings = Household & {
  description: string | null
  notificationStyle: NotificationStyle
}

export type CreateHouseholdInput = {
  name: string
  timezone: string
}

export type HouseholdInvitation = {
  inviteCode: string
  expiresAt: string
}

export type HouseholdInvitationSummary = {
  id: string
  createdAt: string
  expiresAt: string | null
  status: "ACTIVE" | "USED" | "REVOKED" | "EXPIRED"
  createdByDisplayName: string | null
  roleToAssign: "OWNER" | "ADMIN" | "MEMBER"
}

export type DeleteHouseholdRequest = {
  householdName: string
  password: string
}

export type HouseholdMemberDTO = {
  userId: string
  displayName: string
  role: string
  joinedAt: string
  assignedThisWeek: number
  completedThisWeek: number
}

export type HouseholdMemberRemovalResponse = {
  message: string
  pausedScheduleCount: number
}

export const householdApi = {
  list: () => api.get<Household[]>("/api/households"),
  create: (input: CreateHouseholdInput) => api.post<Household>("/api/households", input),
  join: (inviteCode: string) => api.post<Household>("/api/households/join", { inviteCode }),
  createInvitation: (householdId: string) =>
    api.post<HouseholdInvitation>(`/api/households/${encodeURIComponent(householdId)}/invitations`),
  listInvitations: (householdId: string) =>
    api.get<HouseholdInvitationSummary[]>(
      `/api/households/${encodeURIComponent(householdId)}/invitations`,
    ),
  revokeInvitation: (householdId: string, invitationId: string) =>
    api.delete<void>(
      `/api/households/${encodeURIComponent(householdId)}/invitations/${encodeURIComponent(invitationId)}`,
    ),
  deleteHousehold: (householdId: string, input: DeleteHouseholdRequest) =>
    api.delete<void>(`/api/households/${encodeURIComponent(householdId)}`, input),
  members: (householdId: string) =>
    api.get<HouseholdMemberDTO[]>(`/api/households/${encodeURIComponent(householdId)}/members`),
  updateMemberRole: (householdId: string, userId: string, role: "OWNER" | "ADMIN" | "MEMBER") =>
    api.put<void>(
      `/api/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(userId)}/role`,
      { role },
    ),
  removeMember: (householdId: string, userId: string) =>
    api.delete<HouseholdMemberRemovalResponse>(
      `/api/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(userId)}`,
    ),
  transferOwnership: (householdId: string, userId: string) =>
    api.post<void>(
      `/api/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(userId)}/transfer-ownership`,
    ),
  settings: (householdId: string) =>
    api.get<HouseholdSettings>(`/api/households/${encodeURIComponent(householdId)}/settings`),
  updateSettings: (
    householdId: string,
    input: Pick<HouseholdSettings, "name" | "description" | "timezone">,
  ) =>
    api.put<HouseholdSettings>(
      `/api/households/${encodeURIComponent(householdId)}/settings`,
      input,
    ),
  leave: (householdId: string, newOwnerUserId?: string) =>
    api.post<void>(
      `/api/households/${encodeURIComponent(householdId)}/leave`,
      newOwnerUserId ? { newOwnerUserId } : undefined,
    ),
}
