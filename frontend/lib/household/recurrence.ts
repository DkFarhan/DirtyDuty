/**
 * Chore recurrence rules: the strict RRULE subset the backend accepts (see the backend
 * RecurrenceRule class). One module parses, builds and describes them so the chore form, the
 * admin list and any other label agree.
 */

export type Frequency = "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU"
export type MonthlyMode = "DAY" | "WEEKDAY" | "LAST_DAY"

export type Recurrence = {
  frequency: Frequency
  interval: number
  weekdays: Weekday[]
  monthlyMode: MonthlyMode
  /** Day of the month for monthly "On day" (1 to 31; 29 to 31 fall on the last day). */
  monthDay: number
  /** 1 to 4, or -1 for "last". */
  ordinal: number
  ordinalWeekday: Weekday
  /** Yearly month (1 to 12) and day. */
  yearMonth: number
  yearDay: number
  /** Seasonality: active months 1 to 12. Empty means all year. */
  activeMonths: number[]
  /** COUNT, or null for no count. */
  count: number | null
}

export const WEEKDAYS: { key: Weekday; short: string; label: string }[] = [
  { key: "MO", short: "Mon", label: "Monday" },
  { key: "TU", short: "Tue", label: "Tuesday" },
  { key: "WE", short: "Wed", label: "Wednesday" },
  { key: "TH", short: "Thu", label: "Thursday" },
  { key: "FR", short: "Fri", label: "Friday" },
  { key: "SA", short: "Sat", label: "Saturday" },
  { key: "SU", short: "Sun", label: "Sunday" },
]

export const MONTHS: { value: number; short: string; label: string; days: number }[] = [
  { value: 1, short: "Jan", label: "January", days: 31 },
  { value: 2, short: "Feb", label: "February", days: 29 },
  { value: 3, short: "Mar", label: "March", days: 31 },
  { value: 4, short: "Apr", label: "April", days: 30 },
  { value: 5, short: "May", label: "May", days: 31 },
  { value: 6, short: "Jun", label: "June", days: 30 },
  { value: 7, short: "Jul", label: "July", days: 31 },
  { value: 8, short: "Aug", label: "August", days: 31 },
  { value: 9, short: "Sep", label: "September", days: 30 },
  { value: 10, short: "Oct", label: "October", days: 31 },
  { value: 11, short: "Nov", label: "November", days: 30 },
  { value: 12, short: "Dec", label: "December", days: 31 },
]

export const ORDINALS: { value: number; label: string }[] = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: -1, label: "last" },
]

export const MAX_INTERVAL: Record<Exclude<Frequency, "ONCE">, number> = {
  DAILY: 365,
  WEEKLY: 52,
  MONTHLY: 24,
  YEARLY: 10,
}
export const MAX_COUNT = 999

export const INTERVAL_UNIT: Record<Exclude<Frequency, "ONCE">, [string, string]> = {
  DAILY: ["day", "days"],
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  YEARLY: ["year", "years"],
}

const WEEKDAY_KEYS = WEEKDAYS.map((day) => day.key)
const KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT"])
const INTEGER = /^-?[0-9]{1,4}$/

/** Sensible defaults for a new rule, derived from the start date (YYYY-MM-DD). */
export function defaultRecurrence(startsOn: string): Recurrence {
  const [year, month, day] = startsOn.split("-").map(Number)
  const date = new Date(Date.UTC(year || 2000, (month || 1) - 1, day || 1))
  const weekday = WEEKDAY_KEYS[(date.getUTCDay() + 6) % 7]
  const dayOfMonth = date.getUTCDate()
  return {
    frequency: "WEEKLY",
    interval: 1,
    weekdays: [weekday],
    monthlyMode: "DAY",
    monthDay: dayOfMonth,
    ordinal: dayOfMonth > 28 ? -1 : Math.ceil(dayOfMonth / 7),
    ordinalWeekday: weekday,
    yearMonth: date.getUTCMonth() + 1,
    yearDay: dayOfMonth,
    activeMonths: [],
    count: null,
  }
}

/**
 * Parses a stored rule into form values. Returns null for anything the form cannot represent
 * exactly, so the caller can keep that rule untouched and show it as a custom schedule.
 */
export function parseRecurrenceRule(rule: string, startsOn: string): Recurrence | null {
  const base = defaultRecurrence(startsOn)
  const fields = new Map<string, string>()
  for (const part of rule.trim().split(";")) {
    const separator = part.indexOf("=")
    if (separator <= 0 || separator !== part.lastIndexOf("=")) return null
    const key = part.slice(0, separator)
    const value = part.slice(separator + 1)
    if (!KEYS.has(key) || value === "" || fields.has(key)) return null
    fields.set(key, value)
  }
  const frequency = fields.get("FREQ")
  if (frequency === "ONCE") {
    return fields.size === 1 ? { ...base, frequency: "ONCE" } : null
  }
  if (
    frequency !== "DAILY" &&
    frequency !== "WEEKLY" &&
    frequency !== "MONTHLY" &&
    frequency !== "YEARLY"
  ) {
    return null
  }

  const integer = (value: string | undefined) =>
    value !== undefined && INTEGER.test(value) ? Number(value) : null
  const result: Recurrence = { ...base, frequency, weekdays: [] }

  if (fields.has("INTERVAL")) {
    const interval = integer(fields.get("INTERVAL"))
    if (interval === null || interval < 1 || interval > MAX_INTERVAL[frequency]) return null
    result.interval = interval
  } else {
    result.interval = 1
  }
  if (fields.has("COUNT")) {
    const count = integer(fields.get("COUNT"))
    if (count === null || count < 1 || count > MAX_COUNT) return null
    result.count = count
  }

  const months = fields.get("BYMONTH")
  const parseMonths = (value: string) => {
    const parts = value.split(",").map((part) => integer(part))
    if (parts.some((part) => part === null || part < 1 || part > 12)) return null
    const unique = [...new Set(parts as number[])]
    return unique.length === parts.length ? unique.sort((a, b) => a - b) : null
  }

  if (frequency === "DAILY") {
    if (fields.has("BYDAY") || fields.has("BYMONTHDAY")) return null
  } else if (frequency === "WEEKLY") {
    if (fields.has("BYMONTHDAY")) return null
    const days = fields.get("BYDAY")?.split(",") ?? []
    if (
      days.length === 0 ||
      new Set(days).size !== days.length ||
      days.some((day) => !WEEKDAY_KEYS.includes(day as Weekday))
    ) {
      return null
    }
    result.weekdays = WEEKDAY_KEYS.filter((day) => days.includes(day))
  } else if (frequency === "MONTHLY") {
    const byDay = fields.get("BYDAY")
    const byMonthDay = fields.get("BYMONTHDAY")
    if ((byDay === undefined) === (byMonthDay === undefined)) return null
    if (byMonthDay !== undefined) {
      const day = integer(byMonthDay)
      if (day === -1) result.monthlyMode = "LAST_DAY"
      else if (day !== null && day >= 1 && day <= 31) {
        result.monthlyMode = "DAY"
        result.monthDay = day
      } else return null
    } else {
      const match = /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay ?? "")
      if (!match) return null
      result.monthlyMode = "WEEKDAY"
      result.ordinal = Number(match[1])
      result.ordinalWeekday = match[2] as Weekday
    }
  } else {
    if (fields.has("BYDAY") || !months || months.includes(",")) return null
    const month = integer(months)
    const day = integer(fields.get("BYMONTHDAY"))
    if (month === null || month < 1 || month > 12 || day === null || day < 1) return null
    if (day > MONTHS[month - 1].days) return null
    result.yearMonth = month
    result.yearDay = day
    return result
  }

  if (months !== undefined) {
    const parsed = parseMonths(months)
    if (!parsed) return null
    result.activeMonths = parsed.length === 12 ? [] : parsed
  }
  return result
}

/** Builds the canonical rule string the backend stores. */
export function buildRecurrenceRule(recurrence: Recurrence): string {
  const { frequency } = recurrence
  if (frequency === "ONCE") return "FREQ=ONCE"
  const parts = [`FREQ=${frequency}`]
  if (recurrence.interval > 1) parts.push(`INTERVAL=${recurrence.interval}`)
  if (frequency === "WEEKLY") {
    parts.push(`BYDAY=${WEEKDAY_KEYS.filter((day) => recurrence.weekdays.includes(day)).join(",")}`)
  } else if (frequency === "MONTHLY") {
    if (recurrence.monthlyMode === "LAST_DAY") parts.push("BYMONTHDAY=-1")
    else if (recurrence.monthlyMode === "DAY") parts.push(`BYMONTHDAY=${recurrence.monthDay}`)
    else parts.push(`BYDAY=${recurrence.ordinal}${recurrence.ordinalWeekday}`)
  } else if (frequency === "YEARLY") {
    parts.push(`BYMONTH=${recurrence.yearMonth}`, `BYMONTHDAY=${recurrence.yearDay}`)
  }
  const months = [...new Set(recurrence.activeMonths)].sort((a, b) => a - b)
  if (frequency !== "YEARLY" && months.length > 0 && months.length < 12) {
    parts.push(`BYMONTH=${months.join(",")}`)
  }
  if (recurrence.count !== null) parts.push(`COUNT=${recurrence.count}`)
  return parts.join(";")
}

function joinList(items: string[]) {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** "Nov to Mar" for a run of consecutive months (wrapping the year), otherwise a list. */
export function describeMonths(months: number[]) {
  const sorted = [...new Set(months)].sort((a, b) => a - b)
  if (sorted.length === 0 || sorted.length === 12) return ""
  const short = (month: number) => MONTHS[month - 1].short
  if (sorted.length === 1) return short(sorted[0])
  const included = new Set(sorted)
  // Find a month whose predecessor is excluded: the start of the single run, if there is one.
  const starts = sorted.filter((month) => !included.has(month === 1 ? 12 : month - 1))
  if (starts.length === 1 && sorted.length >= 3) {
    const start = starts[0]
    const end = ((start + sorted.length - 2) % 12) + 1
    return `${short(start)} to ${short(end)}`
  }
  return joinList(sorted.map(short))
}

function ordinalSuffix(day: number) {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th"}`
}

function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number)
  if (!year || !month || !day) return isoDate
  return `${MONTHS[month - 1].short} ${day}, ${year}`
}

/** A plain-English summary, for example "Every 2 weeks on Mon and Thu, Nov to Mar, 10 times". */
export function describeRecurrence(recurrence: Recurrence, endsOn?: string | null): string {
  const { frequency, interval } = recurrence
  if (frequency === "ONCE") return "One time"
  const plural = INTERVAL_UNIT[frequency][1]
  const cadence =
    interval > 1
      ? `Every ${interval} ${plural}`
      : { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[frequency]
  let detail = ""
  if (frequency === "WEEKLY") {
    const days = WEEKDAYS.filter((day) => recurrence.weekdays.includes(day.key))
    detail =
      days.length === 0
        ? ""
        : days.length === 7
          ? " on every day"
          : ` on ${joinList(days.map((day) => day.short))}`
  } else if (frequency === "MONTHLY") {
    detail =
      recurrence.monthlyMode === "LAST_DAY"
        ? " on the last day"
        : recurrence.monthlyMode === "DAY"
          ? ` on the ${ordinalSuffix(recurrence.monthDay)}`
          : ` on the ${ORDINALS.find((ordinal) => ordinal.value === recurrence.ordinal)?.label ?? ""} ${
              WEEKDAYS.find((day) => day.key === recurrence.ordinalWeekday)?.label ?? ""
            }`
  } else if (frequency === "YEARLY") {
    detail = ` on ${MONTHS[recurrence.yearMonth - 1]?.short ?? ""} ${recurrence.yearDay}`
  }
  const parts = [cadence + detail]
  if (frequency !== "YEARLY") {
    const season = describeMonths(recurrence.activeMonths)
    if (season) parts.push(season)
  }
  if (recurrence.count !== null) {
    parts.push(recurrence.count === 1 ? "once" : `${recurrence.count} times`)
  } else if (endsOn) {
    parts.push(`until ${formatDate(endsOn)}`)
  }
  return parts.join(", ")
}

/** Describes a stored rule, or "Custom schedule" when it cannot be represented. */
export function describeRecurrenceRule(
  rule: string | null | undefined,
  startsOn = "2000-01-03",
  endsOn?: string | null,
): string {
  if (!rule) return "No schedule"
  const parsed = parseRecurrenceRule(rule, startsOn)
  return parsed ? describeRecurrence(parsed, endsOn) : "Custom schedule"
}
