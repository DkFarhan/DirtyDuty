import { clockIn, clockLabel, shortDate, todayIn } from "@/lib/household/chore-quick-form"
import type { BoardMember, BoardPost, BoardPostInput, BoardPostType, NotifyMode } from "./api"
import type { PostSuggestion } from "./post-suggestions"

export const MAX_POST_TITLE = 120
export const MAX_POST_DETAILS = 2000

/** Fields a suggestion may fill until the user changes them. */
export type PostField = "type" | "details"

export type PostFormValues = {
  title: string
  /** null until the user (or a suggestion) chooses; saved as a heads-up. */
  type: BoardPostType | null
  details: string
  /** "YYYY-MM-DD" or "". */
  eventDate: string
  /** "HH:mm" or "" (all day). */
  startTime: string
  endTime: string
  notifyMode: NotifyMode
  recipients: string[]
  pinned: boolean
  touched: PostField[]
}

export function initialPostValues(): PostFormValues {
  return {
    title: "",
    type: null,
    details: "",
    eventDate: "",
    startTime: "",
    endTime: "",
    notifyMode: "EVERYONE",
    recipients: [],
    pinned: false,
    touched: [],
  }
}

/** "HH:mm:ss" from the server, "HH:mm" in the form. */
function hhmm(time: string | null) {
  return time ? time.slice(0, 5) : ""
}

export function valuesFromPost(post: BoardPost): PostFormValues {
  return {
    title: post.title,
    type: post.type,
    details: post.details ?? "",
    eventDate: post.eventDate ?? "",
    startTime: hhmm(post.startTime),
    endTime: hhmm(post.endTime),
    notifyMode: post.notifyMode,
    recipients: post.recipientUserIds,
    pinned: post.pinned,
    // An existing post's fields are the author's own: suggestions never overwrite them.
    touched: ["type", "details"],
  }
}

export function withPostField(
  values: PostFormValues,
  field: PostField,
  patch: Partial<PostFormValues>,
): PostFormValues {
  return {
    ...values,
    ...patch,
    touched: values.touched.includes(field) ? values.touched : [...values.touched, field],
  }
}

/**
 * Picking a suggestion sets the title, and the type and details unless the user already changed
 * them.
 */
export function applyPostSuggestion(
  values: PostFormValues,
  suggestion: PostSuggestion,
): PostFormValues {
  return {
    ...values,
    title: suggestion.title,
    type: values.touched.includes("type") ? values.type : suggestion.type,
    details: values.touched.includes("details") ? values.details : (suggestion.details ?? ""),
  }
}

export type PostFormError = { field: "title" | "when" | "notify"; message: string }

/** The request for the form, or the first thing to fix. */
export function buildPostRequest(
  values: PostFormValues,
  timeZone: string,
  original: BoardPost | null = null,
  now: Date = new Date(),
): { request: BoardPostInput } | { error: PostFormError } {
  const title = values.title.trim()
  if (!title) return { error: { field: "title", message: "Enter what's happening." } }
  if (title.length > MAX_POST_TITLE) {
    return { error: { field: "title", message: "Keep it to 120 characters." } }
  }
  const type = values.type ?? "HEADS_UP"
  const event = type === "EVENT"
  if (event) {
    if (!values.eventDate) {
      return { error: { field: "when", message: "Choose a date for this event." } }
    }
    const unchanged = original?.eventDate === values.eventDate
    if (!unchanged && values.eventDate < todayIn(timeZone, now)) {
      return { error: { field: "when", message: "Choose today or a later date." } }
    }
    if (values.endTime && !values.startTime) {
      return { error: { field: "when", message: "Add a start time first." } }
    }
    if (values.endTime && values.endTime <= values.startTime) {
      return { error: { field: "when", message: "The end time must be after the start time." } }
    }
  }
  if (values.notifyMode === "PICKED" && values.recipients.length === 0) {
    return { error: { field: "notify", message: "Pick at least one person to notify." } }
  }
  const details = values.details.trim()
  return {
    request: {
      type,
      title,
      details: details ? details.slice(0, MAX_POST_DETAILS) : null,
      eventDate: event ? values.eventDate : null,
      startTime: event && values.startTime ? values.startTime : null,
      endTime: event && values.startTime && values.endTime ? values.endTime : null,
      pinned: values.pinned,
      notifyMode: values.notifyMode,
      recipientUserIds: values.notifyMode === "PICKED" ? values.recipients : [],
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Labels

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** The value on the When row: "Thu, Nov 27 · 10 AM–12 PM", "Thu, Nov 27 · All day". */
export function whenLabel(values: Pick<PostFormValues, "eventDate" | "startTime" | "endTime">) {
  if (!values.eventDate) return "Pick a date"
  return `${shortDate(values.eventDate)} · ${timeRangeLabel(values.startTime, values.endTime)}`
}

/** "10 AM–12 PM", "10 AM", or "All day". */
export function timeRangeLabel(start: string | null, end: string | null) {
  const from = hhmm(start)
  const to = hhmm(end)
  if (!from) return "All day"
  return to ? `${clockLabel(from)}–${clockLabel(to)}` : clockLabel(from)
}

/** The value on the Notify row. */
export function notifyLabel(values: PostFormValues, members: BoardMember[]) {
  if (values.notifyMode === "NONE") return "No one"
  if (values.notifyMode === "EVERYONE") return "Everyone"
  const names = values.recipients
    .map((userId) => members.find((member) => member.userId === userId)?.displayName)
    .filter((name): name is string => Boolean(name))
  if (names.length === 0) return "Pick people"
  return names.length <= 2 ? joinNames(names) : `${names[0]} and ${names.length - 1} others`
}

export type SummaryPart = { text: string; strong?: boolean }

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function weekdayOf(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number)
  return WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

function dayBefore(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

/**
 * The reminder part of an event's summary: "then a reminder Wed evening and Thu morning". Slots
 * that have passed are left out; "this evening"/"this morning" name today.
 */
function reminderPhrase(eventDate: string, timeZone: string, now: Date) {
  if (!eventDate) return "then a reminder the evening before and that morning"
  const today = todayIn(timeZone, now)
  const clock = clockIn(timeZone, now)
  const eve = dayBefore(eventDate)
  const slots: string[] = []
  if (eve > today || (eve === today && clock < "19:00")) {
    slots.push(eve === today ? "this evening" : `${weekdayOf(eve)} evening`)
  }
  if (eventDate > today || (eventDate === today && clock < "08:00")) {
    slots.push(eventDate === today ? "this morning" : `${weekdayOf(eventDate)} morning`)
  }
  if (slots.length === 0) return null
  return `then a reminder ${slots.join(" and ")}`
}

/**
 * The live sentence under Type: who gets it now, the reminders for an event, and how long it stays
 * on the board.
 */
export function postSummary(
  values: PostFormValues,
  members: BoardMember[],
  viewerId: string,
  timeZone: string,
  now: Date = new Date(),
): SummaryPart[] {
  const type = values.type ?? "HEADS_UP"
  const others = members.filter((member) => member.userId !== viewerId)
  const picked = values.recipients
    .map((userId) => others.find((member) => member.userId === userId)?.displayName)
    .filter((name): name is string => Boolean(name))
  const parts: SummaryPart[] = []
  const reminders = type === "EVENT" ? reminderPhrase(values.eventDate, timeZone, now) : null

  if (values.notifyMode === "NONE") {
    parts.push({ text: "No one", strong: true })
    parts.push({
      text: type === "EVENT" ? " gets a notification or reminders." : " gets a notification.",
    })
  } else {
    const who =
      values.notifyMode === "PICKED"
        ? picked.length === 0
          ? "Only the people you pick"
          : `Only ${joinNames(picked)}`
        : "Everyone"
    const plural = values.notifyMode === "PICKED" && picked.length !== 1
    parts.push({ text: who, strong: true })
    if (reminders) {
      parts.push({ text: ` ${plural ? "get" : "gets"} it now, ${reminders}.` })
    } else if (values.notifyMode === "PICKED") {
      parts.push({ text: ` ${plural ? "get" : "gets"} a notification.` })
    } else {
      parts.push({ text: " gets it now." })
    }
  }

  if (values.pinned) {
    parts.push({ text: " It stays pinned under " })
    parts.push({ text: "House info", strong: true })
    parts.push({ text: "." })
  } else if (type === "PROBLEM") {
    parts.push({ text: " It stays at the top of the board " })
    parts.push({ text: "until someone marks it fixed", strong: true })
    parts.push({ text: "." })
  } else if (type === "HEADS_UP") {
    parts.push({ text: " Everyone can still see it on the board " })
    parts.push({ text: "for 7 days", strong: true })
    parts.push({ text: "." })
  } else if (values.notifyMode !== "EVERYONE") {
    parts.push({ text: " Everyone can still see it on the board." })
  }
  return parts
}

/** The summary as plain text (tests, aria). */
export function summaryText(parts: SummaryPart[]) {
  return parts.map((part) => part.text).join("")
}

/**
 * The one-time chore "Make it a chore" proposes for an event: due at 6 PM the day before, or today
 * when that has passed.
 */
export function choreDueForEvent(eventDate: string, timeZone: string, now: Date = new Date()) {
  const today = todayIn(timeZone, now)
  const eve = dayBefore(eventDate)
  const late = eve < today || (eve === today && clockIn(timeZone, now) >= "18:00")
  return { date: late ? today : eve, time: "18:00" }
}
