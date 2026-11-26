import type { CardFeedbackView } from "./card-feedback"
import { stepsChip, type StepsChipView } from "./steps"
import { cardRequestView, type CardRequestView } from "./requests"
import type { AssignmentDTO } from "./chores"
import { describeChoreSchedule } from "./recurrence"
import { awayNote } from "./away"

/**
 * "When needed" chores ("household jobs"): what a card says about whose turn it is, when it was
 * last done, its next deadline and its "Needs doing" flag, for one viewer.
 */
export type HouseholdJobViewModel = {
  id: string
  title: string
  /** "2 of 5 steps" when the chore has a checklist (E12). */
  steps?: StepsChipView | null
  category: string
  /** "Your turn" or "Sam's turn". */
  turnLabel: string
  /** "Sam is away, so it skipped to you" when the turn moved for Away mode, else null. */
  awayNote: string | null
  /** Hand-off request chip and note (E11). */
  request?: CardRequestView
  /** The first letter of whose turn it is, for the avatar; null on your turn or nobody's. */
  turnInitial: string | null
  yourTurn: boolean
  /** "Last done 2 days ago by Sam", or "Not done yet". */
  lastDoneLabel: string
  /**
   * "Due by 8:00 PM today", "Due Sun, Nov 16 by 8:00 PM", "Due now" while flagged, or null without
   * a deadline.
   */
  deadlineLabel: string | null
  /** "You asked 5 min ago" or "Sam asked 5 min ago", or null. */
  flagLabel: string | null
  flagged: boolean
  /** When the open flag was raised (ISO), or null. */
  flaggedAt: string | null
  overdue: boolean
  /** "I did it" for anyone in the rotation who may complete it, else null. */
  completeLabel: string | null
  canFlag: boolean
  /**
   * The secondary button: "Needs doing", "Reminder sent" while the repeat window is open, or
   * "Remind again" after it. Null for whoever's turn it is and for viewers who can't flag.
   */
  reminder: JobReminderView | null
  hasActions: boolean
  /** The result of the last action taken from this card. */
  feedback?: CardFeedbackView
}

/**
 * How long after a flag nobody can flag the job again. Mirrors the backend's
 * OccurrenceService.FLAG_REPEAT_WINDOW; keep the two in step.
 */
export const FLAG_REPEAT_WINDOW_MS = 2 * 60 * 60 * 1000

export type JobReminderView =
  | { state: "needs-doing" }
  | {
      state: "reminder-sent"
      /** When the window ends (epoch ms). */
      remindAgainAt: number
      /** "You can remind again at 3:07 AM", in the household's time zone. */
      remindAgainLabel: string
    }
  | { state: "remind-again" }

function clockTime(at: number, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(at))
  } catch {
    return new Date(at).toISOString().slice(11, 16)
  }
}

/** The secondary button for a viewer who may flag, from when the job was last flagged. */
export function jobReminder(
  flaggedAt: string | null,
  timeZone: string,
  now: number = Date.now(),
): JobReminderView {
  const flagged = flaggedAt ? new Date(flaggedAt).getTime() : Number.NaN
  if (Number.isNaN(flagged)) return { state: "needs-doing" }
  const remindAgainAt = flagged + FLAG_REPEAT_WINDOW_MS
  if (now >= remindAgainAt) return { state: "remind-again" }
  return {
    state: "reminder-sent",
    remindAgainAt,
    remindAgainLabel: `You can remind again at ${clockTime(remindAgainAt, timeZone)}`,
  }
}

/**
 * The card message for a failed "Needs doing". The server's 409 ("Already flagged at 3:10 PM.")
 * reads as "Already asked at 3:10 PM." to match the card's wording.
 */
export function flagErrorWording(message: string) {
  const repeat = /^Already flagged at (.+)$/.exec(message)
  return repeat ? `Already asked at ${repeat[1]}` : message
}

export function isHouseholdJob(assignment: AssignmentDTO) {
  return assignment.kind === "AS_NEEDED"
}

function isOpen(assignment: AssignmentDTO) {
  return assignment.status === "PENDING"
}

/** Whose turn it is on an open job, falling back to the first assignee. */
export function jobTurn(assignment: AssignmentDTO) {
  return assignment.turn ?? assignment.assignees[0] ?? null
}

export function isViewersTurn(assignment: AssignmentDTO, viewerId: string) {
  return jobTurn(assignment)?.userId === viewerId
}

/** Rounded "how long ago", in plain words: "just now", "10 min ago", "2 days ago". */
export function timeAgo(iso: string, now: number = Date.now()) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 14) return `${days} days ago`
  const weeks = Math.round(days / 7)
  return `${weeks} weeks ago`
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date)
}

/** "by 8:00 PM today", "by 8:00 PM tomorrow", "Sun, Nov 16 by 8:00 PM". */
export function deadlineWords(iso: string, timeZone: string, now: number = Date.now()) {
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return ""
  let time: string
  let day: string
  try {
    time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(due)
    day = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(due)
    const today = dayKey(new Date(now), timeZone)
    const tomorrow = dayKey(new Date(now + 86_400_000), timeZone)
    const dueDay = dayKey(due, timeZone)
    if (dueDay === today) return `by ${time} today`
    if (dueDay === tomorrow) return `by ${time} tomorrow`
  } catch {
    return due.toISOString().slice(0, 10)
  }
  return `${day} by ${time}`
}

function firstName(name: string) {
  return name.trim() || "Someone"
}

export function householdJobView(
  assignment: AssignmentDTO,
  viewerId: string,
  timeZone: string,
  now: number = Date.now(),
): HouseholdJobViewModel {
  const open = isOpen(assignment)
  const turn = jobTurn(assignment)
  const yourTurn = turn?.userId === viewerId
  const flag = open ? (assignment.flag ?? null) : null
  const lastDone = assignment.lastDone ?? null
  const byName = (userId: string, name: string) => (userId === viewerId ? "you" : firstName(name))
  const overdue = open && assignment.overdue
  const canFlag = open && Boolean(assignment.actions?.canFlag)
  const turnName = turn ? firstName(turn.displayName) : null
  return {
    id: assignment.id,
    title: assignment.title,
    steps: stepsChip(assignment),
    category: assignment.categoryName ?? "Household job",
    turnLabel: !turn ? "Nobody's turn yet" : yourTurn ? "Your turn" : `${turnName}'s turn`,
    awayNote: awayNote(assignment, viewerId),
    request: cardRequestView(assignment, viewerId),
    turnInitial: turnName && !yourTurn ? turnName.charAt(0).toUpperCase() : null,
    yourTurn,
    lastDoneLabel: lastDone
      ? `Last done ${timeAgo(lastDone.at, now)} by ${byName(lastDone.byUserId, lastDone.byDisplayName)}`
      : "Not done yet",
    // A flag pulls the deadline to now.
    deadlineLabel:
      flag && !overdue
        ? "Due now"
        : open && assignment.dueAt
          ? `${overdue ? "Was due" : "Due"} ${deadlineWords(assignment.dueAt, timeZone, now)}`
          : null,
    flagLabel: flag
      ? `${flag.byUserId === viewerId ? "You" : firstName(flag.byDisplayName)} asked ${timeAgo(flag.at, now)}`
      : null,
    flagged: Boolean(flag),
    flaggedAt: flag?.at ?? null,
    overdue,
    completeLabel: open && assignment.canComplete ? "I did it" : null,
    canFlag,
    // Whoever's turn it is never asks themselves; the backend allows one flag per window.
    reminder: canFlag && !yourTurn ? jobReminder(flag?.at ?? null, timeZone, now) : null,
    hasActions: open && Boolean(assignment.actions?.canReassign),
  }
}

/** The job as it will look once the viewer's "Needs doing" lands, for an optimistic update. */
export function optimisticFlag(
  assignment: AssignmentDTO,
  viewer: { userId: string; displayName: string },
  now: number = Date.now(),
): AssignmentDTO {
  const at = new Date(now).toISOString()
  const pullForward = !assignment.dueAt || new Date(assignment.dueAt).getTime() > now
  return {
    ...assignment,
    flag: { at, byUserId: viewer.userId, byDisplayName: viewer.displayName },
    dueAt: pullForward ? at : assignment.dueAt,
  }
}

/** Replaces one job in a list (optimistic value, server answer, or rollback). */
export function replaceJob(jobs: AssignmentDTO[], next: AssignmentDTO) {
  return jobs.map((job) => (job.id === next.id ? next : job))
}

/** "Kitchen · Every 3 days after it's done" for an "After it's done" chore, else the category. */
export function categoryWithRepeat(assignment: AssignmentDTO) {
  const category = assignment.categoryName ?? "Chore"
  if (assignment.kind !== "AFTER_COMPLETION" || !assignment.repeat) return category
  return `${category} · ${describeChoreSchedule({
    kind: "AFTER_COMPLETION",
    intervalCount: assignment.repeat.intervalCount,
    intervalUnit: assignment.repeat.intervalUnit,
  })}`
}
