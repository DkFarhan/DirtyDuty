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
  /** The people are every member, including people who join later. Absent from older responses. */
  everyone?: boolean | null
  /** Week by week: each person has it for this many weeks; null for other chores. */
  rotationWeeks?: number | null
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
  /** {@link ChoreSchedule.everyone}: every member, now and later (participantUserIds is ignored). */
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
  /** Hand-off and swap requests (E11) for this viewer. */
  requests?: AssignmentRequests | null
  /** Week by week: whose period this is in, and its last day (YYYY-MM-DD). */
  week?: { owner: { userId: string; displayName: string }; until: string } | null
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

/**
 * Hand-off and swap requests on one occurrence, for the viewer: whether they may ask someone to
 * take it ("Pass my turn" for a When needed chore) or offer a swap, the open request it is in, and
 * the note an accepted one left ("Taken over from Farhan", "Swapped with Rubayet").
 */
export type AssignmentRequests = {
  canAsk: boolean
  canSwap: boolean
  passTurn: boolean
  open: {
    id: string
    type: "HANDOFF" | "SWAP"
    mine: boolean
    /** Who it was asked of; null for anyone. */
    waitingFor: { userId: string; displayName: string } | null
    requester: { userId: string; displayName: string }
  } | null
  note: { type: "TAKEN_OVER" | "SWAPPED"; with: { userId: string; displayName: string } } | null
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
  /** Week by week chores the viewer has this period. Absent from older responses. */
  myWeeks?: MyWeek[]
  /** Whether the household has any chore (active or paused). Absent from older responses. */
  hasChores?: boolean
}

/** A Week by week chore the viewer has until {@link until}; {@link next} takes over after. */
export type MyWeek = {
  choreId: string
  title: string
  categoryName: string | null
  until: string
  next: { userId: string; displayName: string } | null
}

export { categoryIcon } from "./category-icons"

export function householdPath(householdId: string) {
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
  /** Whether the household has any chore (active or paused); any member. */
  status: (householdId: string) =>
    api.get<{ hasChores: boolean }>(`${householdPath(householdId)}/chore-status`),
  /** Several chores at once, all or none (owners and admins). */
  createBatch: (householdId: string, chores: ChoreRequest[]) =>
    api.post<Chore[]>(`${householdPath(householdId)}/chores/batch`, { chores }),
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
