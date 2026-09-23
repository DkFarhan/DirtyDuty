export type Screen =
  | "login"
  | "register"
  | "welcome"
  | "create-household"
  | "join-household"
  | "dashboard"
  | "my-chores"
  | "household"
  | "admin"
  | "create-chore"
  | "profile"

export type ChoreStatus = "pending" | "completed"
export type Priority = "low" | "medium" | "high"

export interface Member {
  id: string
  name: string
  avatar: string
  isAdmin: boolean

  /**
   * Forward-looking gamification fields. These are intentionally optional and
   * are NOT rendered yet. They exist so upcoming features (points, streaks,
   * badges, achievements, leaderboards) can be layered on without reshaping the
   * core model. Populate them from the backend when those features ship.
   */
  points?: number
  streak?: StreakInfo
  badgeIds?: string[]
  achievementIds?: string[]
}

export interface Chore {
  id: string
  name: string
  assigneeId: string
  assigneeName: string
  due: string
  dueDay: string
  status: ChoreStatus
  priority: Priority
  icon: string
  frequency: string

  /** Forward-looking: points awarded for completing this chore. Unused for now. */
  pointsValue?: number
  /** Forward-looking: completion timestamp used for streak/statistics math. */
  completedAt?: string
}

export interface Household {
  id: string
  name: string
  code: string
  members: Member[]
}

export interface AppState {
  currentUser: Member
  household: Household
  chores: Chore[]
}

/* -------------------------------------------------------------------------- */
/* Forward-looking gamification contracts.                                    */
/* Declared now so future screens/components share one vocabulary. Not used    */
/* by any current UI — see the "Coming Soon" teaser on the Profile screen.     */
/* -------------------------------------------------------------------------- */

export interface StreakInfo {
  current: number
  longest: number
  lastCompletedDate?: string
}

export interface Badge {
  id: string
  name: string
  description: string
  icon: string
}

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  goal: number
  progress: number
  unlocked: boolean
}

export interface LeaderboardEntry {
  memberId: string
  name: string
  avatar: string
  points: number
  rank: number
}

export interface HouseholdStats {
  totalChores: number
  completedChores: number
  completionRate: number
  perMember: MemberStats[]
}

export interface MemberStats {
  memberId: string
  name: string
  assigned: number
  completed: number
  completionRate: number
}
