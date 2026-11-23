import { api } from "@/lib/auth/api"

/** Away mode (E10). Dates are ISO days ("2026-11-28"), inclusive, in the household's time zone. */

export type AwayEffectKind = "SKIPS_YOU" | "COVERED" | "PAUSED"

export type AwayEffect = {
  choreId: string
  title: string
  categoryIcon: string | null
  effect: AwayEffectKind
  resumesOn: string | null
  coveredBy: string | null
}

export type AwayPeriod = {
  id: string
  startsOn: string
  endsOn: string
  returnsOn: string
  untilBack: boolean
  status: "UPCOMING" | "ACTIVE"
}

export type AwayStatus = {
  userId: string
  displayName: string
  period: AwayPeriod | null
  chores: AwayEffect[]
}

export type AwayPreview = {
  startsOn: string
  endsOn: string
  returnsOn: string
  days: number
  chores: AwayEffect[]
}

export type AwayDates = { startsOn: string; endsOn: string | null; untilBack: boolean }

const path = (householdId: string, userId: string) =>
  `/api/households/${encodeURIComponent(householdId)}/members/${encodeURIComponent(userId)}/away`

export const awayApi = {
  status: (householdId: string, userId: string) => api.get<AwayStatus>(path(householdId, userId)),
  preview: (householdId: string, userId: string, dates: AwayDates) =>
    api.post<AwayPreview>(`${path(householdId, userId)}/preview`, dates),
  set: (householdId: string, userId: string, dates: AwayDates, postToBoard: boolean) =>
    api.post<AwayStatus>(path(householdId, userId), { ...dates, postToBoard }),
  update: (householdId: string, userId: string, dates: AwayDates) =>
    api.put<AwayStatus>(path(householdId, userId), dates),
  end: (householdId: string, userId: string) =>
    api.post<AwayStatus>(`${path(householdId, userId)}/end`),
  remove: (householdId: string, userId: string) => api.delete<void>(path(householdId, userId)),
}

export const MAX_AWAY_DAYS = 90

// ---- Dates ----------------------------------------------------------------------------------------

function toUtcDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function toIso(date: Date) {
  return date.toISOString().slice(0, 10)
}

/** Today in {@link timeZone}, as an ISO day. */
export function todayIn(timeZone: string, now: Date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
    return parts
  } catch {
    return toIso(now)
  }
}

export function addDays(iso: string, days: number) {
  const date = toUtcDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toIso(date)
}

/** Whole days from {@link from} to {@link to} (to minus from). */
export function daysBetween(from: string, to: string) {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000)
}

/** "Fri, Nov 28". */
export function formatAwayDay(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(iso))
}

/** "Sun" when within the coming week, else "Nov 30". */
export function shortAwayDay(iso: string, today: string) {
  const ahead = daysBetween(today, iso)
  return new Intl.DateTimeFormat(
    "en-US",
    ahead >= 0 && ahead < 7
      ? { weekday: "short", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" },
  ).format(toUtcDate(iso))
}

// ---- Quick picks ----------------------------------------------------------------------------------

export type QuickPick = "weekend" | "week" | "two-weeks" | "until-back"

export const QUICK_PICKS: { id: QuickPick; label: string }[] = [
  { id: "weekend", label: "This weekend" },
  { id: "week", label: "1 week" },
  { id: "two-weeks", label: "2 weeks" },
  { id: "until-back", label: "Until I'm back" },
]

/**
 * The dates a quick pick stands for. This weekend: the coming Saturday and Sunday, or today to
 * Sunday on a weekend. 1 and 2 weeks start today. Until I'm back: open-ended (up to 90 days).
 */
export function quickPickDates(pick: QuickPick, today: string): AwayDates {
  switch (pick) {
    case "weekend": {
      const weekday = toUtcDate(today).getUTCDay() // 0 Sunday … 6 Saturday
      if (weekday === 0) return { startsOn: today, endsOn: today, untilBack: false }
      if (weekday === 6) return { startsOn: today, endsOn: addDays(today, 1), untilBack: false }
      const saturday = addDays(today, 6 - weekday)
      return { startsOn: saturday, endsOn: addDays(saturday, 1), untilBack: false }
    }
    case "week":
      return { startsOn: today, endsOn: addDays(today, 6), untilBack: false }
    case "two-weeks":
      return { startsOn: today, endsOn: addDays(today, 13), untilBack: false }
    case "until-back":
      return { startsOn: today, endsOn: null, untilBack: true }
  }
}

/** Which quick pick these dates match, if any. */
export function matchingQuickPick(dates: AwayDates, today: string): QuickPick | null {
  for (const { id } of QUICK_PICKS) {
    const pick = quickPickDates(id, today)
    if (
      pick.untilBack === dates.untilBack &&
      pick.startsOn === dates.startsOn &&
      (pick.untilBack || pick.endsOn === dates.endsOn)
    ) {
      return id
    }
  }
  return null
}

/** The end date as it'd be saved: "Until I'm back" ends 90 days from today (or the start). */
export function effectiveEnd(dates: AwayDates, today: string) {
  if (!dates.untilBack) return dates.endsOn
  const fromToday = addDays(today, MAX_AWAY_DAYS)
  const fromStart = addDays(dates.startsOn, MAX_AWAY_DAYS)
  return fromToday < fromStart ? fromToday : fromStart
}

export type AwayDateError = { field: "startsOn" | "endsOn"; message: string }

/**
 * The same checks the server makes, so they show inline. {@link keptStart} is the start of a period
 * that has already begun, which may stay in the past.
 */
export function validateAwayDates(
  dates: AwayDates,
  today: string,
  keptStart: string | null = null,
): AwayDateError | null {
  if (!dates.startsOn) return { field: "startsOn", message: "Choose when you're away from." }
  if (dates.startsOn < today && dates.startsOn !== keptStart) {
    return { field: "startsOn", message: "Away mode can't start in the past." }
  }
  const endsOn = effectiveEnd(dates, today)
  if (!endsOn) return { field: "endsOn", message: "Choose when you're back." }
  if (endsOn < dates.startsOn) {
    return { field: "endsOn", message: "The end date can't be before the start date." }
  }
  if (endsOn < today) return { field: "endsOn", message: "Choose an end date from today on." }
  if (daysBetween(dates.startsOn, endsOn) > MAX_AWAY_DAYS) {
    return { field: "endsOn", message: "Away mode can last up to 90 days." }
  }
  return null
}

// ---- Copy -----------------------------------------------------------------------------------------

export type SummaryPart = { text: string; strong?: boolean }

function listOf(names: string[]) {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

const SUMMARY_NAMES = 3

/** At most three names, then "and N more": "Bins, Plants, Towels and 2 more". */
function shortListOf(names: string[]) {
  if (names.length <= SUMMARY_NAMES) return listOf(names)
  return `${names.slice(0, SUMMARY_NAMES).join(", ")} and ${names.length - SUMMARY_NAMES} more`
}

/**
 * The live summary under the dates, e.g. "Away for 3 days. Your turns go to others, Water plants
 * pauses, and you get no chore reminders." {@link self} is false when an admin sets it for someone.
 */
export function awaySummary(
  dates: AwayDates,
  today: string,
  chores: AwayEffect[],
  self = true,
): SummaryPart[] {
  const parts: SummaryPart[] = []
  const endsOn = effectiveEnd(dates, today)
  if (dates.untilBack || !endsOn) {
    parts.push(
      { text: "Away " },
      { text: self ? "until you're back" : "until they're back", strong: true },
    )
    parts.push({ text: " (up to 90 days). " })
  } else {
    const days = daysBetween(dates.startsOn, endsOn) + 1
    parts.push(
      { text: "Away for " },
      { text: `${days} ${days === 1 ? "day" : "days"}`, strong: true },
    )
    parts.push({ text: ". " })
  }
  const clauses: SummaryPart[][] = []
  if (chores.some((chore) => chore.effect !== "PAUSED")) {
    clauses.push([
      { text: self ? "Your turns " : "Their turns " },
      { text: "go to others", strong: true },
    ])
  }
  const paused = [
    ...new Set(chores.filter((chore) => chore.effect === "PAUSED").map((chore) => chore.title)),
  ]
  if (paused.length) {
    clauses.push([
      { text: `${shortListOf(paused)} ` },
      { text: paused.length === 1 ? "pauses" : "pause", strong: true },
    ])
  }
  clauses.push([
    { text: self ? "you get " : "they get " },
    { text: "no chore reminders", strong: true },
  ])
  clauses.forEach((clause, index) => {
    if (index > 0)
      parts.push({
        text: index === clauses.length - 1 ? (clauses.length > 2 ? ", and " : " and ") : ", ",
      })
    if (index === 0) clause[0] = { ...clause[0], text: capitalize(clause[0].text) }
    parts.push(...clause)
  })
  parts.push({ text: "." })
  return parts
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The line under a chore in "What happens to your chores". */
export function effectLine(effect: AwayEffect, self = true) {
  switch (effect.effect) {
    case "SKIPS_YOU":
      return self ? "Turns skip you while away" : "Turns skip them while away"
    case "COVERED":
      return `${effect.coveredBy ?? "Someone"} covers ${self ? "your" : "their"} slot`
    case "PAUSED":
      return effect.resumesOn ? `Paused · resumes ${formatAwayDay(effect.resumesOn)}` : "Paused"
  }
}

/** The Profile row's value: "Off", or "Until Sun, Nov 30". */
export function awayRowValue(period: AwayPeriod | null) {
  if (!period) return "Off"
  if (period.untilBack) return "Until you're back"
  return `Until ${formatAwayDay(period.endsOn)}`
}

/** The member card tag: "Away until Sun", or "Away from Fri" before it starts. */
export function awayTag(startsOn: string | null, endsOn: string | null, today: string) {
  if (!startsOn || !endsOn || endsOn < today) return null
  if (startsOn > today) return `Away from ${shortAwayDay(startsOn, today)}`
  return `Away until ${shortAwayDay(endsOn, today)}`
}

/**
 * The card note when a pending occurrence's turn moved because someone is away: "Rubayet is away,
 * so it skipped to Abubakar" ("to you" for the viewer).
 */
export function awayNote(
  assignment: {
    status?: string
    awayFrom?: { userId: string; displayName: string } | null
    assignees: { userId: string; displayName: string }[]
  },
  viewerId: string,
) {
  const away = assignment.awayFrom
  const to = assignment.assignees[0]
  if (!away || !to || (assignment.status && assignment.status !== "PENDING")) return null
  const who = away.userId === viewerId ? "You're" : `${away.displayName} is`
  return `${who} away, so it skipped to ${to.userId === viewerId ? "you" : to.displayName}`
}
