import { api } from "@/lib/auth/api"

export type ChorePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT"
export type AssignmentStrategy = "FIXED" | "ROUND_ROBIN" | "RANDOM"

export type ChoreCategory = {
  id: string
  name: string
  iconKey: string
  sortOrder: number
  createdAt: string
}

export type ChoreMemberOption = {
  userId: string
  displayName: string
}

export type ChoreManagementOptions = {
  categories: ChoreCategory[]
  activeMembers: ChoreMemberOption[]
}

export type ChoreSchedule = {
  recurrenceRule: string
  timezone: string
  startsOn: string
  endsOn: string | null
  dueTime: string | null
  assignmentStrategy: AssignmentStrategy
  peopleNeeded: number
  fixedAssigneeUserId: string | null
  participantUserIds: string[]
  active: boolean
}

export type Chore = {
  id: string
  householdId: string
  categoryId: string | null
  title: string
  description: string | null
  defaultPriority: ChorePriority
  difficulty: number
  estimatedMinutes: number | null
  requiresVerification: boolean
  active: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  schedule: ChoreSchedule | null
}

export type ChoreRequest = {
  title: string
  description: string | null
  categoryId: string | null
  defaultPriority: ChorePriority
  difficulty: number
  estimatedMinutes: number | null
  requiresVerification: boolean
  schedule: Omit<ChoreSchedule, "active">
}

export type AssignmentDTO = {
  id: string
  householdId: string
  choreId: string
  categoryName: string | null
  categoryIcon: string | null
  title: string
  scheduledFor: string
  dueAt: string | null
  status: "PENDING" | "COMPLETED" | "CANCELLED"
  priority: ChorePriority
  difficulty: number
  estimatedMinutes: number | null
  assignees: { userId: string; displayName: string }[]
  canComplete: boolean
  completedAt: string | null
  completedByDisplayName: string | null
  overdue: boolean
}

export type HouseholdDashboard = {
  weekSummary: {
    completedCount: number
    totalCount: number
    completionPercentage: number
  }
  today: AssignmentDTO[]
  thisWeek: AssignmentDTO[]
}

export function categoryIcon(iconKey: string | null | undefined) {
  if (!iconKey) return "🧹"
  const icons = new Set(["🧹", "🗑️", "🛁", "🧺", "🍽️", "🌀", "🫧", "♻️", "🪴", "🛒", "🧽", "🪣", "🏠"])
  if (icons.has(iconKey)) return iconKey
  const normalized = iconKey.toLowerCase()
  if (normalized.includes("bath")) return "🛁"
  if (normalized.includes("laundry") || normalized.includes("wash")) return "🧺"
  if (normalized.includes("trash") || normalized.includes("garbage")) return "🗑️"
  if (normalized.includes("kitchen") || normalized.includes("dish")) return "🍽️"
  if (normalized.includes("plant") || normalized.includes("garden")) return "🪴"
  if (normalized.includes("shop")) return "🛒"
  if (normalized.includes("recycle")) return "♻️"
  if (normalized.includes("home") || normalized.includes("general")) return "🏠"
  return "🧹"
}

function householdPath(householdId: string) {
  return `/api/households/${encodeURIComponent(householdId)}`
}

export const choreApi = {
  options: (householdId: string) =>
    api.get<ChoreManagementOptions>(`${householdPath(householdId)}/chore-management-options`),
  list: (householdId: string) => api.get<Chore[]>(`${householdPath(householdId)}/chores`),
  get: (householdId: string, choreId: string) =>
    api.get<Chore>(`${householdPath(householdId)}/chores/${encodeURIComponent(choreId)}`),
  create: (householdId: string, request: ChoreRequest) =>
    api.post<Chore>(`${householdPath(householdId)}/chores`, request),
  update: (householdId: string, choreId: string, request: ChoreRequest) =>
    api.put<Chore>(`${householdPath(householdId)}/chores/${encodeURIComponent(choreId)}`, request),
  pause: (householdId: string, choreId: string) =>
    api.post<Chore>(`${householdPath(householdId)}/chores/${encodeURIComponent(choreId)}/pause`),
  activate: (householdId: string, choreId: string) =>
    api.post<Chore>(`${householdPath(householdId)}/chores/${encodeURIComponent(choreId)}/activate`),
  archive: (householdId: string, choreId: string) =>
    api.post<Chore>(`${householdPath(householdId)}/chores/${encodeURIComponent(choreId)}/archive`),
  dashboard: (householdId: string) =>
    api.get<HouseholdDashboard>(`${householdPath(householdId)}/dashboard`),
  myChores: (householdId: string, status: "UPCOMING" | "COMPLETED") =>
    api.get<AssignmentDTO[]>(`${householdPath(householdId)}/my-chores?status=${status}`),
  complete: (householdId: string, assignmentId: string) =>
    api.post<AssignmentDTO>(`${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/complete`),
}
