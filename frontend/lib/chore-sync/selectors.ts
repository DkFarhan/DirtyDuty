import type { AppState, Chore, HouseholdStats, MemberStats } from "./types"

/**
 * Pure, derived read-models. Screens compute their numbers through these helpers
 * rather than inline, so the upcoming Household Statistics and Leaderboard
 * features can reuse the exact same math.
 */

const DAY_ORDER = ["Today", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

export function rate(completed: number, total: number): number {
  return total > 0 ? Math.round((completed / total) * 100) : 0
}

export function todayChores(state: AppState): Chore[] {
  return state.chores.filter((c) => c.dueDay === "Today" && c.status === "pending")
}

export function upcomingWeekChores(state: AppState): Chore[] {
  return state.chores
    .filter((c) => c.dueDay !== "Today" && c.status === "pending")
    .sort((a, b) => DAY_ORDER.indexOf(a.dueDay) - DAY_ORDER.indexOf(b.dueDay))
}

export function choresForMember(state: AppState, memberId: string): Chore[] {
  return state.chores.filter((c) => c.assigneeId === memberId)
}

export function memberStats(state: AppState, memberId: string): MemberStats {
  const member = state.household.members.find((m) => m.id === memberId)
  const assignedChores = choresForMember(state, memberId)
  const completed = assignedChores.filter((c) => c.status === "completed").length
  return {
    memberId,
    name: member?.name ?? "",
    assigned: assignedChores.length,
    completed,
    completionRate: rate(completed, assignedChores.length),
  }
}

export function householdStats(state: AppState): HouseholdStats {
  const completedChores = state.chores.filter((c) => c.status === "completed").length
  return {
    totalChores: state.chores.length,
    completedChores,
    completionRate: rate(completedChores, state.chores.length),
    perMember: state.household.members.map((m) => memberStats(state, m.id)),
  }
}
