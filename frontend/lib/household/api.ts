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

export type HouseholdMemberDTO = {
  userId: string
  displayName: string
  role: string
  joinedAt: string
  assignedThisWeek: number
  completedThisWeek: number
}

export const householdApi = {
  list: () => api.get<Household[]>("/api/households"),
  create: (input: CreateHouseholdInput) => api.post<Household>("/api/households", input),
  join: (inviteCode: string) => api.post<Household>("/api/households/join", { inviteCode }),
  createInvitation: (householdId: string) =>
    api.post<HouseholdInvitation>(`/api/households/${encodeURIComponent(householdId)}/invitations`),
  members: (householdId: string) =>
    api.get<HouseholdMemberDTO[]>(`/api/households/${encodeURIComponent(householdId)}/members`),
  settings: (householdId: string) =>
    api.get<HouseholdSettings>(`/api/households/${encodeURIComponent(householdId)}/settings`),
  updateSettings: (householdId: string, input: Pick<HouseholdSettings, "name" | "description" | "timezone">) =>
    api.put<HouseholdSettings>(`/api/households/${encodeURIComponent(householdId)}/settings`, input),
  leave: (householdId: string) =>
    api.post<void>(`/api/households/${encodeURIComponent(householdId)}/leave`),
}
