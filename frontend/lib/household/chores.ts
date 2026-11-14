import { api } from "@/lib/auth/api"

export type ChorePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT"
export type AssignmentStrategy = "FIXED" | "ROUND_ROBIN" | "RANDOM"

export type ChoreCategory = {
  id: string
  name: string
  iconKey: string
  sortOrder: number
  createdAt: string
  /** Non-archived chores that use this category. */
  choreCount: number
}

export type ChoreCategoryRequest = { name: string; iconKey: string }

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
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "SKIPPED"
  priority: ChorePriority
  difficulty: number
  estimatedMinutes: number | null
  assignees: { userId: string; displayName: string }[]
  canComplete: boolean
  completedAt: string | null
  completedByDisplayName: string | null
  overdue: boolean
  /** The day it was originally due, when it has been moved to another day. */
  originalDate?: string | null
  /** Moved to another day or time. */
  moved?: boolean
  /** Given to other people for this day only. */
  reassigned?: boolean
  /** What the viewer may do with this occurrence, decided by the server. */
  actions?: OccurrenceActions
}

export type OccurrenceActions = {
  canMove: boolean
  canSkip: boolean
  canUnskip: boolean
  canReassign: boolean
  /** First day the viewer may move it to (YYYY-MM-DD). */
  moveEarliest: string | null
  /** Last day the viewer may move it to, or null for no limit. */
  moveLatest: string | null
  maxAssignees: number
}

export type HouseholdDashboard = {
  weekSummary: {
    completedCount: number
    totalCount: number
    completionPercentage: number
  }
  today: AssignmentDTO[]
  thisWeek: AssignmentDTO[]
  overdue: AssignmentDTO[]
}

export { categoryIcon } from "./category-icons"

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
    api.post<AssignmentDTO>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/complete`,
    ),
  move: (householdId: string, assignmentId: string, date: string, time: string | null) =>
    api.post<AssignmentDTO>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/move`,
      { date, time },
    ),
  skip: (householdId: string, assignmentId: string) =>
    api.post<AssignmentDTO>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/skip`,
    ),
  unskip: (householdId: string, assignmentId: string) =>
    api.post<AssignmentDTO>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/unskip`,
    ),
  reassign: (householdId: string, assignmentId: string, userIds: string[]) =>
    api.put<AssignmentDTO>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/assignees`,
      { userIds },
    ),
}

export const categoryApi = {
  list: (householdId: string) =>
    api.get<ChoreCategory[]>(`${householdPath(householdId)}/chore-categories`),
  create: (householdId: string, request: ChoreCategoryRequest) =>
    api.post<ChoreCategory>(`${householdPath(householdId)}/chore-categories`, request),
  update: (householdId: string, categoryId: string, request: ChoreCategoryRequest) =>
    api.put<ChoreCategory>(
      `${householdPath(householdId)}/chore-categories/${encodeURIComponent(categoryId)}`,
      request,
    ),
  reorder: (householdId: string, categoryIds: string[]) =>
    api.put<ChoreCategory[]>(`${householdPath(householdId)}/chore-categories/order`, {
      categoryIds,
    }),
  remove: (householdId: string, categoryId: string) =>
    api.delete<void>(
      `${householdPath(householdId)}/chore-categories/${encodeURIComponent(categoryId)}`,
    ),
}
