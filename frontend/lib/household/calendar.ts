import { api } from "@/lib/auth/api"
import { getLocalDateKey } from "@/components/chore-sync/week-summary"
import { householdPath } from "./chores"
import { clockLabel } from "./requests"

/** The household calendar (6c): one request per Week or Month view. */

export type CalendarPerson = { userId: string; displayName: string }

export type CalendarMember = CalendarPerson & {
  role: "OWNER" | "ADMIN" | "MEMBER" | string
  /** Place in join order; picks the member's colour. */
  colorIndex: number
}

export type CalendarItem = {
  /** The stored occurrence; null for a projected one. */
  id: string | null
  choreId: string
  title: string
  categoryName: string | null
  categoryIcon: string | null
  kind: string
  status: "PENDING" | "COMPLETED"
  date: string
  dueAt: string | null
  assignees: CalendarPerson[]
  projected: boolean
  /** Projected with nobody predicted (Balanced, Mix it up). */
  toBeDecided: boolean
}

export type CalendarUndated = {
  id: string
  choreId: string
  title: string
  kind: string
  flagged: boolean
  turn: CalendarPerson[]
}

export type CalendarDTO = {
  from: string
  to: string
  today: string
  timezone: string
  viewerRole: string
  members: CalendarMember[]
  days: { date: string; items: CalendarItem[] }[]
  undated: CalendarUndated[]
  counts: { userId: string; count: number }[]
}

export const calendarApi = {
  get: (householdId: string, from: string, to: string) =>
    api.get<CalendarDTO>(
      `${householdPath(householdId)}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
}

export type CalendarView = "week" | "month"
/** "everyone", or one member's id. */
export type CalendarFilter = "everyone" | string

// ---- Dates ("YYYY-MM-DD" household dates; arithmetic in UTC so DST never shifts a day) ----

function toUtc(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function fromUtc(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number) {
  const next = toUtc(date)
  next.setUTCDate(next.getUTCDate() + days)
  return fromUtc(next)
}

/** Today in the household's time zone. */
export function householdToday(timeZone: string, now: Date = new Date()) {
  return getLocalDateKey(now, timeZone)
}

/** The Monday of the (Monday–Sunday) week holding {@link date}. */
export function weekStart(date: string) {
  const day = toUtc(date).getUTCDay() // 0 = Sunday
  return addDays(date, -((day + 6) % 7))
}

/** The seven dates of the week starting on {@link monday}. */
export function weekDates(monday: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`
}

export function monthEnd(date: string) {
  const next = toUtc(monthStart(date))
  next.setUTCMonth(next.getUTCMonth() + 1)
  next.setUTCDate(0)
  return fromUtc(next)
}

export function addMonths(date: string, months: number) {
  const next = toUtc(monthStart(date))
  next.setUTCMonth(next.getUTCMonth() + months)
  return fromUtc(next)
}

/**
 * The month as Monday-first weeks: each cell is a date in the month, or null for the blank days
 * before the 1st and after the last day.
 */
export function monthGrid(date: string): (string | null)[][] {
  const first = monthStart(date)
  const last = monthEnd(date)
  const lead = (toUtc(first).getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let day = first; day <= last; day = addDays(day, 1)) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  return weeks
}

/** The range one request asks for: Monday–Sunday, or the whole month. */
export function rangeFor(view: CalendarView, anchor: string) {
  if (view === "week") {
    const from = weekStart(anchor)
    return { from, to: addDays(from, 6) }
  }
  return { from: monthStart(anchor), to: monthEnd(anchor) }
}

/** Moves the anchor one week or month back (-1) or forward (+1). */
export function stepAnchor(view: CalendarView, anchor: string, direction: -1 | 1) {
  return view === "week" ? addDays(weekStart(anchor), 7 * direction) : addMonths(anchor, direction)
}

/** Whether {@link anchor}'s week or month is the one holding today. */
export function isCurrentRange(view: CalendarView, anchor: string, today: string) {
  const range = rangeFor(view, anchor)
  return today >= range.from && today <= range.to
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function monthName(date: string) {
  return MONTHS[Number(date.slice(5, 7)) - 1]
}

function shortMonth(date: string) {
  return monthName(date).slice(0, 3)
}

function dayNumber(date: string) {
  return Number(date.slice(8, 10))
}

export function weekdayName(date: string) {
  return WEEKDAYS[toUtc(date).getUTCDay()]
}

/** "Nov 24 – 30", "Nov 24 – Dec 7", "Dec 29 – Jan 4"; "November 2026" for a month. */
export function rangeLabel(view: CalendarView, anchor: string) {
  const { from, to } = rangeFor(view, anchor)
  if (view === "month") return `${monthName(from)} ${from.slice(0, 4)}`
  const start = `${shortMonth(from)} ${dayNumber(from)}`
  return from.slice(5, 7) === to.slice(5, 7)
    ? `${start} – ${dayNumber(to)}`
    : `${start} – ${shortMonth(to)} ${dayNumber(to)}`
}

/** The header title: "This week", "Next week", "Last week", "Week of Dec 8", or the month name. */
export function calendarTitle(view: CalendarView, anchor: string, today: string) {
  if (view === "month") return monthName(anchor)
  const monday = weekStart(anchor)
  const current = weekStart(today)
  if (monday === current) return "This week"
  if (monday === addDays(current, 7)) return "Next week"
  if (monday === addDays(current, -7)) return "Last week"
  return `Week of ${shortMonth(monday)} ${dayNumber(monday)}`
}

/** "TODAY · WED, NOV 26" or "THU, NOV 27" above the Month view's day list. */
export function selectedDayHeading(date: string, today: string) {
  const label = `${weekdayName(date)}, ${shortMonth(date)} ${dayNumber(date)}`.toUpperCase()
  return date === today ? `TODAY · ${label}` : label
}

// ---- People ----

/** Member colours by join order; the same in both themes (each theme tunes the token). */
export const MEMBER_COLORS = ["teal", "amber", "blue", "coral", "violet", "green", "pink", "sand"]

/** A member's colour token; former members (not in the list) are neutral. */
export function memberColor(members: CalendarMember[], userId: string | null | undefined) {
  const member = members.find((item) => item.userId === userId)
  if (!member) return "neutral"
  return MEMBER_COLORS[member.colorIndex % MEMBER_COLORS.length]
}

export function initial(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase()
}

/** First name ("Farhan Habib" → "Farhan"). */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

export function canAddChores(viewerRole: string | null | undefined) {
  return viewerRole === "OWNER" || viewerRole === "ADMIN"
}

// ---- What a view shows ----

export function matchesFilter(item: Pick<CalendarItem, "assignees">, filter: CalendarFilter) {
  return filter === "everyone" || item.assignees.some((person) => person.userId === filter)
}

/** The undated list for a filter: someone's own turns, plus the ones anyone can do. */
export function filterUndated(undated: CalendarUndated[], filter: CalendarFilter) {
  if (filter === "everyone") return undated
  return undated.filter(
    (item) => item.flagged || item.turn.length === 0 || item.turn.some((p) => p.userId === filter),
  )
}

/** Each day's items for the filter, keyed by date. */
export function itemsByDay(calendar: CalendarDTO | null, filter: CalendarFilter) {
  const days = new Map<string, CalendarItem[]>()
  for (const day of calendar?.days ?? []) {
    days.set(
      day.date,
      day.items.filter((item) => matchesFilter(item, filter)),
    )
  }
  return days
}

/**
 * "This week, by person": one pill per active member, highest count first (ties in join order);
 * only the chosen member with a filter.
 */
export function personCounts(calendar: CalendarDTO | null, filter: CalendarFilter) {
  if (!calendar) return []
  const counts = new Map(calendar.counts.map((entry) => [entry.userId, entry.count]))
  return calendar.members
    .filter((member) => filter === "everyone" || member.userId === filter)
    .map((member) => ({ member, count: counts.get(member.userId) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.member.colorIndex - b.member.colorIndex)
}

/** The right-hand time ("9 PM"), or null when there is no due time or it is done. */
export function itemTime(item: CalendarItem, timeZone: string) {
  if (item.status === "COMPLETED" || !item.dueAt) return null
  return clockLabel(item.dueAt, timeZone)
}

/** Month view dots: up to three people's colours, then "+N". Projected days use hollow dots. */
export function dayDots(items: CalendarItem[], members: CalendarMember[], max = 3) {
  const dots = items.flatMap((item) =>
    item.assignees.length === 0
      ? [{ color: "neutral", projected: item.projected }]
      : item.assignees.map((person) => ({
          color: memberColor(members, person.userId),
          projected: item.projected,
        })),
  )
  return { dots: dots.slice(0, max), more: Math.max(0, dots.length - max) }
}

/** "Anyone · needs doing", "Sam's turn", "No deadline". */
export function undatedSubtitle(item: CalendarUndated) {
  if (item.flagged) return "Anyone · needs doing"
  if (item.turn.length > 0) return `${firstName(item.turn[0].displayName)}'s turn`
  return "No deadline"
}

/** Who a line names, for its label: "Sam", "Sam and Ana", or "To be decided". */
export function peopleLabel(item: CalendarItem) {
  if (item.assignees.length === 0) return "To be decided"
  const names = item.assignees.map((person) => firstName(person.displayName))
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** The "+" on a day: owners and admins only, and not on days already past. */
export function addState(viewerRole: string | null | undefined, date: string, today: string) {
  if (!canAddChores(viewerRole)) return "hidden" as const
  return date < today ? ("disabled" as const) : ("enabled" as const)
}

/** The quick-create draft for a day's "+": How often = Just once on that date. */
export function quickCreateDraft(date: string) {
  return { title: "", once: { date }, returnTo: "calendar" as const }
}

// ---- Remembered view (per device) ----

const VIEW_KEY = "dirtyduty.calendar.view"

export function rememberedView(): CalendarView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "month" ? "month" : "week"
  } catch {
    return "week"
  }
}

export function rememberView(view: CalendarView) {
  try {
    window.localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

export const MONTH_WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"]
