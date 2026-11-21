import type { IntervalUnit } from "./chores"
import type { Weekday } from "./recurrence"

/**
 * Built-in chore suggestions for the "Quick create" form: a title, an icon, a category name and a
 * full setup. Picking one fills the form; the user can change anything afterwards.
 */

export type SuggestionIcon =
  | "trash"
  | "recycle"
  | "dishes"
  | "kitchen"
  | "fridge"
  | "vacuum"
  | "mop"
  | "dust"
  | "laundry"
  | "towels"
  | "bed"
  | "bathroom"
  | "toilet"
  | "plants"
  | "garden"
  | "shopping"
  | "pets"
  | "mail"
  | "car"
  | "windows"
  | "snow"
  | "calendar"

export type SuggestionOften =
  | { type: "DAILY" }
  | { type: "WEEKLY"; weekday?: Weekday }
  | { type: "BIWEEKLY"; weekday?: Weekday }
  | { type: "MONTHLY" }
  | { type: "AFTER_COMPLETION"; count: number; unit: IntervalUnit }
  | { type: "AS_NEEDED"; backstopDays: number | null }

export type SuggestionWho = "TURNS" | "ME" | "RANDOM"

export type ChoreSuggestion = {
  title: string
  icon: SuggestionIcon
  /** A default category name; matched to the household's categories by name. */
  category: string
  often: SuggestionOften
  /** "HH:mm", or null for no particular time. */
  dueTime: string | null
  who: SuggestionWho
  /** 1 (Quick) to 5 (Big job). */
  difficulty: number
  minutes: number
}

export const CHORE_SUGGESTIONS: readonly ChoreSuggestion[] = [
  {
    title: "Take out garbage",
    icon: "trash",
    category: "Trash",
    often: { type: "AS_NEEDED", backstopDays: 2 },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 5,
  },
  {
    title: "Wash dishes",
    icon: "dishes",
    category: "Kitchen",
    often: { type: "DAILY" },
    dueTime: "21:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 15,
  },
  {
    title: "Vacuum",
    icon: "vacuum",
    category: "Cleaning",
    often: { type: "WEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 30,
  },
  {
    title: "Laundry",
    icon: "laundry",
    category: "Laundry",
    often: { type: "AFTER_COMPLETION", count: 4, unit: "DAY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 45,
  },
  {
    title: "Clean bathroom",
    icon: "bathroom",
    category: "Bathroom",
    often: { type: "WEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 4,
    minutes: 40,
  },
  {
    title: "Water plants",
    icon: "plants",
    category: "General",
    often: { type: "AFTER_COMPLETION", count: 3, unit: "DAY" },
    dueTime: "10:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Garbage bins to the curb",
    icon: "calendar",
    category: "Trash",
    often: { type: "WEEKLY", weekday: "TU" },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Clean garbage bin",
    icon: "trash",
    category: "Trash",
    often: { type: "MONTHLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 20,
  },
  {
    title: "Take out recycling",
    icon: "recycle",
    category: "Trash",
    often: { type: "AS_NEEDED", backstopDays: 7 },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Empty the dishwasher",
    icon: "dishes",
    category: "Kitchen",
    often: { type: "AS_NEEDED", backstopDays: 1 },
    dueTime: "10:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 10,
  },
  {
    title: "Wipe kitchen counters",
    icon: "kitchen",
    category: "Kitchen",
    often: { type: "DAILY" },
    dueTime: "21:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Clean the fridge",
    icon: "fridge",
    category: "Kitchen",
    often: { type: "MONTHLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 30,
  },
  {
    title: "Clean the stove",
    icon: "kitchen",
    category: "Kitchen",
    often: { type: "WEEKLY" },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 15,
  },
  {
    title: "Clean the microwave",
    icon: "kitchen",
    category: "Kitchen",
    often: { type: "BIWEEKLY" },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 10,
  },
  {
    title: "Mop the floors",
    icon: "mop",
    category: "Cleaning",
    often: { type: "WEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 30,
  },
  {
    title: "Sweep the floors",
    icon: "vacuum",
    category: "Cleaning",
    often: { type: "AFTER_COMPLETION", count: 3, unit: "DAY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 15,
  },
  {
    title: "Dust the shelves",
    icon: "dust",
    category: "Cleaning",
    often: { type: "BIWEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 20,
  },
  {
    title: "Clean the windows",
    icon: "windows",
    category: "Cleaning",
    often: { type: "MONTHLY" },
    dueTime: "12:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 40,
  },
  {
    title: "Clean the toilet",
    icon: "toilet",
    category: "Bathroom",
    often: { type: "WEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 15,
  },
  {
    title: "Clean the shower",
    icon: "bathroom",
    category: "Bathroom",
    often: { type: "BIWEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 25,
  },
  {
    title: "Restock toilet paper",
    icon: "toilet",
    category: "Bathroom",
    often: { type: "AS_NEEDED", backstopDays: null },
    dueTime: null,
    who: "TURNS",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Wash towels",
    icon: "towels",
    category: "Laundry",
    often: { type: "WEEKLY" },
    dueTime: "18:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 15,
  },
  {
    title: "Change bed sheets",
    icon: "bed",
    category: "Laundry",
    often: { type: "BIWEEKLY" },
    dueTime: "18:00",
    who: "ME",
    difficulty: 2,
    minutes: 15,
  },
  {
    title: "Fold clothes",
    icon: "laundry",
    category: "Laundry",
    often: { type: "AS_NEEDED", backstopDays: 3 },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 15,
  },
  {
    title: "Grocery shopping",
    icon: "shopping",
    category: "General",
    often: { type: "WEEKLY" },
    dueTime: "17:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 60,
  },
  {
    title: "Feed the pet",
    icon: "pets",
    category: "General",
    often: { type: "DAILY" },
    dueTime: "08:00",
    who: "TURNS",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Walk the dog",
    icon: "pets",
    category: "General",
    often: { type: "DAILY" },
    dueTime: "18:00",
    who: "RANDOM",
    difficulty: 2,
    minutes: 30,
  },
  {
    title: "Clean the litter box",
    icon: "pets",
    category: "General",
    often: { type: "AFTER_COMPLETION", count: 2, unit: "DAY" },
    dueTime: "20:00",
    who: "TURNS",
    difficulty: 2,
    minutes: 10,
  },
  {
    title: "Check the mail",
    icon: "mail",
    category: "General",
    often: { type: "AFTER_COMPLETION", count: 2, unit: "DAY" },
    dueTime: "18:00",
    who: "RANDOM",
    difficulty: 1,
    minutes: 5,
  },
  {
    title: "Mow the lawn",
    icon: "garden",
    category: "General",
    often: { type: "AFTER_COMPLETION", count: 2, unit: "WEEK" },
    dueTime: "12:00",
    who: "TURNS",
    difficulty: 4,
    minutes: 60,
  },
  {
    title: "Shovel snow",
    icon: "snow",
    category: "General",
    often: { type: "AS_NEEDED", backstopDays: null },
    dueTime: null,
    who: "TURNS",
    difficulty: 4,
    minutes: 30,
  },
  {
    title: "Wash the car",
    icon: "car",
    category: "General",
    often: { type: "MONTHLY" },
    dueTime: "12:00",
    who: "TURNS",
    difficulty: 3,
    minutes: 45,
  },
]

/** The "Popular" chips shown before anything is typed, in display order. */
export const POPULAR_SUGGESTIONS: readonly ChoreSuggestion[] = [
  "Take out garbage",
  "Wash dishes",
  "Vacuum",
  "Laundry",
  "Clean bathroom",
  "Water plants",
].map((title) => CHORE_SUGGESTIONS.find((suggestion) => suggestion.title === title)!)

export type SuggestionMatch = {
  suggestion: ChoreSuggestion
  /** The title split around the first case-insensitive match, for bolding the matched part. */
  before: string
  match: string
  after: string
}

/**
 * Up to {@link limit} suggestions whose title contains the query (case-insensitive, trimmed).
 * Titles with a word that starts with the query come first, then the rest, each in list order.
 */
export function matchSuggestions(query: string, limit = 3): SuggestionMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const ranked: { rank: number; index: number; match: SuggestionMatch }[] = []
  CHORE_SUGGESTIONS.forEach((suggestion, index) => {
    const title = suggestion.title
    const at = title.toLowerCase().indexOf(needle)
    if (at < 0) return
    const wordStart = at === 0 || title.charAt(at - 1) === " "
    ranked.push({
      rank: wordStart ? 0 : 1,
      index,
      match: {
        suggestion,
        before: title.slice(0, at),
        match: title.slice(at, at + needle.length),
        after: title.slice(at + needle.length),
      },
    })
  })
  return ranked
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.match)
}

const CATEGORY_KEYWORDS: readonly [string, readonly string[]][] = [
  ["Trash", ["garbage", "trash", "recycling"]],
  ["Kitchen", ["dish", "kitchen", "fridge", "counter"]],
  ["Bathroom", ["toilet", "shower", "bath"]],
  ["Laundry", ["laundry", "clothes", "towels"]],
  ["Cleaning", ["vacuum", "mop", "dust", "sweep"]],
]

/** A default category name guessed from a chore name, or null when nothing matches. */
export function guessCategoryName(title: string): string | null {
  const normalized = title.toLowerCase()
  if (!normalized.trim()) return null
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return category
  }
  return null
}

/** The household category with this name (case-insensitive), if any. */
export function findCategoryByName<T extends { name: string }>(
  categories: readonly T[],
  name: string | null,
): T | null {
  if (!name) return null
  const wanted = name.trim().toLowerCase()
  return categories.find((category) => category.name.trim().toLowerCase() === wanted) ?? null
}

const WEEKDAY_SHORT: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
}

/** The small line under a suggestion: "Every week on Tue · turns". */
export function describeSuggestion(suggestion: ChoreSuggestion): string {
  const often = suggestion.often
  const schedule =
    often.type === "DAILY"
      ? "Every day"
      : often.type === "WEEKLY"
        ? often.weekday
          ? `Every week on ${WEEKDAY_SHORT[often.weekday]}`
          : "Every week"
        : often.type === "BIWEEKLY"
          ? "Every 2 weeks"
          : often.type === "MONTHLY"
            ? "Every month"
            : often.type === "AFTER_COMPLETION"
              ? `Every ${often.count} ${often.unit === "WEEK" ? "weeks" : "days"} after it's done`
              : "When it's needed"
  const who = suggestion.who === "TURNS" ? "turns" : suggestion.who === "ME" ? "you" : "mixed up"
  const parts = [schedule, who]
  if (often.type === "AS_NEEDED" && often.backstopDays) {
    parts.push(
      often.backstopDays === 1 ? "at least every day" : `at least every ${often.backstopDays} days`,
    )
  }
  return parts.join(" · ")
}
