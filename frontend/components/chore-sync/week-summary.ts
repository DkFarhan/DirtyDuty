import type { AssignmentDTO } from "@/lib/household/chores"

export type WeekSummaryState =
  "OVERDUE" | "DUE_TODAY" | "ALL_COMPLETE" | "ON_TRACK" | "NO_ASSIGNMENTS"

export type WeekSummaryCounts = {
  assigned: number
  completed: number
  dueToday: number
  overdue: number
}

export type WeekSummaryMessage = {
  title: string
  body: string
}

type MessageTemplate = {
  title: string
  body: string
}

export const WEEK_SUMMARY_TEMPLATES: Record<WeekSummaryState, MessageTemplate[]> = {
  OVERDUE: [
    {
      title: "You've got unfinished business 👀",
      body: "{overdue} {overdueChoreWord} slipped past the deadline.",
    },
    {
      title: "One thing needs your attention.",
      body: "Clear the overdue work and you're back on track.",
    },
    {
      title: "A chore is waiting on you.",
      body: "Probably judging you a little.",
    },
    {
      title: "Tiny rescue mission.",
      body: "You've got {overdue} overdue {overdueChoreWord} to knock out.",
    },
    {
      title: "Let's clean up the backlog.",
      body: "{overdue} overdue {overdueChoreWord} {overdueVerb} between you and glory.",
    },
  ],
  DUE_TODAY: [
    {
      title: "Today's mission: {dueToday} {dueTodayChoreWord}.",
      body: "Then you're clear.",
    },
    {
      title: "A couple things for today.",
      body: "You're otherwise right on track.",
    },
    {
      title: "Today called.",
      body: "It wants {dueToday} {dueTodayChoreWord} done.",
    },
    {
      title: "Almost there.",
      body: "{dueToday} {dueTodayChoreWord} {dueTodayVerb} due before the day's over.",
    },
    {
      title: "Your future self says thanks.",
      body: "You've got {dueToday} {dueTodayThingWord} due today.",
    },
  ],
  ALL_COMPLETE: [
    {
      title: "You're all caught up 🎉",
      body: "Everything assigned to you is handled.",
    },
    {
      title: "Clean sweep ✨",
      body: "You finished everything on your list.",
    },
    {
      title: "Nothing left on your plate.",
      body: "Your week is officially clear.",
    },
    {
      title: "Chore zero achieved.",
      body: "Go enjoy it before someone adds another one.",
    },
    {
      title: "Look at you being responsible.",
      body: "Every assigned chore is complete.",
    },
  ],
  ON_TRACK: [
    {
      title: "Nice progress.",
      body: "You've finished {completed} of {assigned} chores.",
    },
    {
      title: "You're keeping things moving.",
      body: "{remaining} {remainingChoreWord} left this week.",
    },
    {
      title: "Looking good so far.",
      body: "Most of your week is already handled.",
    },
    {
      title: "Solid work. Keep it rolling.",
      body: "{completed} down, {remaining} to go.",
    },
    {
      title: "The list is getting shorter.",
      body: "Exactly how we like it.",
    },
  ],
  NO_ASSIGNMENTS: [
    {
      title: "You're clear this week ✨",
      body: "Nothing has been assigned to you yet.",
    },
    {
      title: "Quiet week.",
      body: "No chores on your list right now.",
    },
    {
      title: "Nothing on your plate.",
      body: "Enjoy it while it lasts 👀",
    },
    {
      title: "The chore gods have spared you.",
      body: "For now.",
    },
    {
      title: "Suspiciously peaceful.",
      body: "You have no assignments this week.",
    },
  ],
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm

export function getWeekSummaryState(counts: WeekSummaryCounts): WeekSummaryState {
  if (counts.overdue > 0) return "OVERDUE"
  if (counts.dueToday > 0) return "DUE_TODAY"
  if (counts.assigned > 0 && counts.completed === counts.assigned) return "ALL_COMPLETE"
  if (counts.assigned > 0) return "ON_TRACK"
  return "NO_ASSIGNMENTS"
}

export function getLocalDateKey(date = new Date(), timeZone?: string) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en", {
        day: "2-digit",
        month: "2-digit",
        timeZone,
        year: "numeric",
      }).formatToParts(date)
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? ""
      return `${part("year")}-${part("month")}-${part("day")}`
    } catch {
      // Fall back to the device's local date if the timezone is invalid.
    }
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return hash >>> 0
}

export function getDailyMessageIndex(userId: string, dateKey: string, state: WeekSummaryState) {
  const count = WEEK_SUMMARY_TEMPLATES[state].length
  return stableHash(`${userId}|${dateKey}|${state}`) % count
}

export function getWeekSummaryMessage(
  state: WeekSummaryState,
  counts: WeekSummaryCounts,
  userId: string,
  dateKey: string,
): WeekSummaryMessage {
  const template = WEEK_SUMMARY_TEMPLATES[state][getDailyMessageIndex(userId, dateKey, state)]
  const replacements: Record<string, string> = {
    assigned: String(counts.assigned),
    completed: String(counts.completed),
    dueToday: String(counts.dueToday),
    dueTodayChoreWord: plural(counts.dueToday, "chore"),
    dueTodayThingWord: plural(counts.dueToday, "thing"),
    overdue: String(counts.overdue),
    overdueChoreWord: plural(counts.overdue, "chore"),
    overdueVerb: counts.overdue === 1 ? "stands" : "stand",
    dueTodayVerb: counts.dueToday === 1 ? "is" : "are",
    remaining: String(Math.max(0, counts.assigned - counts.completed)),
    remainingChoreWord: plural(Math.max(0, counts.assigned - counts.completed), "chore"),
  }
  const interpolate = (copy: string) =>
    copy.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? `{${key}}`)
  return { title: interpolate(template.title), body: interpolate(template.body) }
}

function scheduledDateKey(assignment: AssignmentDTO) {
  return /^(\d{4}-\d{2}-\d{2})/.exec(assignment.scheduledFor)?.[1] ?? null
}

export function getUpcomingAssignments(
  assignments: AssignmentDTO[],
  todayAssignments: AssignmentDTO[],
  todayKey: string,
) {
  const todayIds = new Set(todayAssignments.map(({ id }) => id))
  return assignments
    .filter((assignment) => {
      const dateKey = scheduledDateKey(assignment)
      return (
        assignment.status === "PENDING" &&
        !assignment.overdue &&
        !todayIds.has(assignment.id) &&
        dateKey !== null &&
        dateKey > todayKey
      )
    })
    .sort((left, right) => {
      const dateDifference = (scheduledDateKey(left) ?? "").localeCompare(
        scheduledDateKey(right) ?? "",
      )
      if (dateDifference !== 0) return dateDifference
      return (left.dueAt ?? "").localeCompare(right.dueAt ?? "")
    })
}

export function groupAssignmentsByDate(assignments: AssignmentDTO[]) {
  return assignments.reduce<{ dateKey: string; assignments: AssignmentDTO[] }[]>(
    (groups, assignment) => {
      const dateKey = scheduledDateKey(assignment)
      if (!dateKey) return groups
      const lastGroup = groups.at(-1)
      if (lastGroup?.dateKey === dateKey) lastGroup.assignments.push(assignment)
      else groups.push({ dateKey, assignments: [assignment] })
      return groups
    },
    [],
  )
}

export function formatUpcomingDateLabel(dateKey: string, todayKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  const today = new Date(`${todayKey}T12:00:00Z`)
  const daysUntil = (date.getTime() - today.getTime()) / 86_400_000
  if (daysUntil === 1) return "Tomorrow"
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date)
}
