import { api } from "@/lib/auth/api"

export type ChorePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT"
export type AssignmentStrategy = "FIXED" | "ROUND_ROBIN" | "RANDOM" | "BALANCED"
/**
 * How a chore repeats. CALENDAR follows its recurrence rule (one-time chores included).
 * AFTER_COMPLETION is due an interval after it was last done. AS_NEEDED is done by anyone in the
 * rotation when needed, with an optional "at least every N days" deadline.
 */
export type ScheduleKind = "CALENDAR" | "AFTER_COMPLETION" | "AS_NEEDED"
export type IntervalUnit = "DAY" | "WEEK"

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
  /** Null for "After it's done" and "When needed" chores. */
  recurrenceRule: string | null
  timezone: string
  startsOn: string
  endsOn: string | null
  dueTime: string | null
  assignmentStrategy: AssignmentStrategy
  peopleNeeded: number
  fixedAssigneeUserId: string | null
  participantUserIds: string[]
  active: boolean
  /** Absent from older responses, which are always CALENDAR. */
  kind?: ScheduleKind
  intervalCount?: number | null
  intervalUnit?: IntervalUnit | null
  /** "Do at least every N days", or null when that deadline is off. */
  backstopDays?: number | null
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
  schedule: Omit<ChoreSchedule, "active"> & { backstopEnabled?: boolean | null }
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
  /** The chore's kind when this occurrence was created; absent means CALENDAR. */
  kind?: ScheduleKind
  /** Whose turn the open occurrence is ("After it's done" and "When needed"). */
  turn?: { userId: string; displayName: string } | null
  /** Whose slot this covers because they're away (Away mode). */
  awayFrom?: { userId: string; displayName: string } | null
  /** The latest completion before this one. */
  lastDone?: { at: string; byUserId: string; byDisplayName: string } | null
  /** "Needs doing" flag on an open "When needed" occurrence. */
  flag?: { at: string; byUserId: string; byDisplayName: string } | null
  repeat?: {
    intervalCount: number | null
    intervalUnit: IntervalUnit | null
    backstopDays: number | null
    /** "HH:mm" or null. */
    dueTime: string | null
  } | null
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
  /** "Needs doing": any member, on an open "When needed" occurrence. */
  canFlag?: boolean
}

export type HouseholdDashboard = {
  weekSummary: {
    completedCount: number
    totalCount: number
    completionPercentage: number
  }
  /**
   * The viewer's week: planned for them plus what they did for others or early, and what they
   * completed. Credit goes to whoever completed a chore, in the week they did it. Absent from older
   * responses.
   */
  personalWeek?: {
    assignedCount: number
    completedCount: number
  }
  today: AssignmentDTO[]
  thisWeek: AssignmentDTO[]
  overdue: AssignmentDTO[]
  /** Open "When needed" chores, for every member. Absent from older responses. */
  householdJobs?: AssignmentDTO[]
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
  flag: (householdId: string, assignmentId: string) =>
    api.post<AssignmentDTO>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/flag`,
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
