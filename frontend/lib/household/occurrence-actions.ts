import { choreApi, type AssignmentDTO } from "./chores"

/** One change to a single chore occurrence, as chosen in the action sheet. */
export type OccurrenceAction =
  | { kind: "move"; date: string; time: string | null }
  | { kind: "skip" }
  | { kind: "unskip" }
  | { kind: "reassign"; assignees: { userId: string; displayName: string }[] }

/** Whether the viewer may do anything with this occurrence, so a "More" button is worth showing. */
export function hasOccurrenceActions(assignment: AssignmentDTO) {
  const actions = assignment.actions
  return Boolean(
    actions && (actions.canMove || actions.canSkip || actions.canUnskip || actions.canReassign),
  )
}

/** Calls the server for the chosen action and returns the updated occurrence. */
export function runOccurrenceAction(
  householdId: string,
  assignmentId: string,
  action: OccurrenceAction,
) {
  switch (action.kind) {
    case "move":
      return choreApi.move(householdId, assignmentId, action.date, action.time)
    case "skip":
      return choreApi.skip(householdId, assignmentId)
    case "unskip":
      return choreApi.unskip(householdId, assignmentId)
    case "reassign":
      return choreApi.reassign(
        householdId,
        assignmentId,
        action.assignees.map((assignee) => assignee.userId),
      )
  }
}

/** Local wall-clock time "HH:MM" of an ISO instant in a time zone. */
export function localTime(iso: string | null, timeZone: string) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(date)
    const hour = parts.find((part) => part.type === "hour")?.value ?? "00"
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00"
    return `${hour}:${minute}`
  } catch {
    return null
  }
}

/** The UTC instant of a local date and "HH:MM" time in a time zone. */
export function zonedInstant(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  // Correct the guess by the zone's offset at that moment (twice covers DST edges).
  let instant = guess
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = localTime(new Date(instant).toISOString(), timeZone)
    const shownDate = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(new Date(instant))
    if (!shown) break
    const [shownHour, shownMinute] = shown.split(":").map(Number)
    const [shownYear, shownMonth, shownDay] = shownDate.split("-").map(Number)
    const shownUtc = Date.UTC(shownYear, shownMonth - 1, shownDay, shownHour, shownMinute)
    instant += guess - shownUtc
  }
  return new Date(instant).toISOString()
}

/**
 * What the occurrence will look like once the server applies the action, for an optimistic
 * update. The server's answer replaces it, or the previous value comes back on failure.
 */
export function optimisticOccurrence(
  assignment: AssignmentDTO,
  action: OccurrenceAction,
  timeZone: string,
  viewerId: string,
): AssignmentDTO {
  switch (action.kind) {
    case "skip":
      return {
        ...assignment,
        status: "SKIPPED",
        canComplete: false,
        overdue: false,
        actions: assignment.actions && {
          ...assignment.actions,
          canMove: false,
          canSkip: false,
          canReassign: false,
          canUnskip: true,
        },
      }
    case "unskip":
      return {
        ...assignment,
        status: "PENDING",
        canComplete: assignment.assignees.some((assignee) => assignee.userId === viewerId),
        actions: assignment.actions && {
          ...assignment.actions,
          canUnskip: false,
          canSkip: true,
          canReassign: true,
          canMove: true,
        },
      }
    case "reassign":
      return {
        ...assignment,
        assignees: action.assignees,
        reassigned: true,
        canComplete: action.assignees.some((assignee) => assignee.userId === viewerId),
      }
    case "move": {
      const time = action.time ?? localTime(assignment.dueAt, timeZone)
      const dueAt = time ? zonedInstant(action.date, time, timeZone) : null
      const original = assignment.originalDate ?? assignment.scheduledFor
      return {
        ...assignment,
        scheduledFor: action.date,
        dueAt,
        moved: true,
        originalDate: original === action.date ? null : original,
        overdue: dueAt !== null && new Date(dueAt).getTime() < Date.now(),
      }
    }
  }
}

/** "Moved from Tue" for an occurrence moved to another day, else null. */
export function movedFromLabel(assignment: Pick<AssignmentDTO, "originalDate" | "scheduledFor">) {
  const original = assignment.originalDate
  if (!original || original === assignment.scheduledFor) return null
  const from = utcNoon(original)
  const to = utcNoon(assignment.scheduledFor)
  if (!from) return null
  // A weekday alone is ambiguous once the move spans a week or more ("Fri" to "Fri").
  const days = to ? Math.abs(Math.round((to.getTime() - from.getTime()) / 86_400_000)) : 7
  if (days >= 7) return `Moved from ${dayLabel(original)}`
  const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(from)
  return `Moved from ${weekday}`
}

function utcNoon(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
    : null
}

/** Short day label "Tue, Nov 18" for a YYYY-MM-DD date. */
export function dayLabel(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return date
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)))
}
