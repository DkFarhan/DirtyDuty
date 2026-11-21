import {
  CHORE_SUGGESTIONS,
  matchSuggestions as matchChoreSuggestions,
} from "@/lib/household/chore-suggestions"
import type { BoardPostType } from "./api"

/**
 * Built-in board post suggestions for "What's happening?". Picking one fills the title, the type
 * and (when it has one) a details template; fields the user has already changed stay as they are.
 */

export type PostSuggestionIcon =
  | "bug"
  | "wrench"
  | "zap"
  | "droplet"
  | "flame"
  | "users"
  | "party"
  | "bell"
  | "sparkles"
  | "clipboard"
  | "truck"
  | "wifi"
  | "thermometer"
  | "lightbulb"
  | "washer"
  | "box"
  | "moon"
  | "plane"
  | "key"
  | "utensils"
  | "megaphone"

export type PostSuggestion = {
  title: string
  type: BoardPostType
  icon: PostSuggestionIcon
  /** The short line after the type when it is offered while typing, e.g. "add the date and time". */
  hint: string
  /** Pre-filled details, if any. */
  details?: string
}

export const POST_SUGGESTIONS: readonly PostSuggestion[] = [
  // Events
  {
    title: "Pest control visit",
    type: "EVENT",
    icon: "bug",
    hint: "clear the sinks",
    details: "Clear under the kitchen and bathroom sinks the night before.",
  },
  {
    title: "Maintenance visit",
    type: "EVENT",
    icon: "wrench",
    hint: "someone coming in",
    details: "Someone from the building will come in.",
  },
  {
    title: "Water or power outage",
    type: "EVENT",
    icon: "zap",
    hint: "add the date and time",
    details: "Charge phones and fill a jug of water beforehand.",
  },
  { title: "Water shut-off", type: "EVENT", icon: "zap", hint: "add the date and time" },
  { title: "Power outage", type: "EVENT", icon: "zap", hint: "add the date and time" },
  {
    title: "Water heater being serviced",
    type: "EVENT",
    icon: "flame",
    hint: "building maintenance",
  },
  { title: "Fire alarm test", type: "EVENT", icon: "bell", hint: "building maintenance" },
  { title: "Guests staying", type: "EVENT", icon: "users", hint: "who and for how long" },
  { title: "Party at home", type: "EVENT", icon: "party", hint: "add the date and time" },
  { title: "Cleaner coming", type: "EVENT", icon: "sparkles", hint: "add the date and time" },
  { title: "Landlord inspection", type: "EVENT", icon: "clipboard", hint: "tidy shared rooms" },
  { title: "Furniture delivery", type: "EVENT", icon: "truck", hint: "add the date and time" },
  // Problems
  { title: "Something's broken", type: "PROBLEM", icon: "wrench", hint: "stays until fixed" },
  { title: "Water leak", type: "PROBLEM", icon: "droplet", hint: "stays until fixed" },
  {
    title: "Washing machine broken",
    type: "PROBLEM",
    icon: "washer",
    hint: "stays until fixed",
    details: "Don't use it until it's fixed.",
  },
  { title: "Wi-Fi is down", type: "PROBLEM", icon: "wifi", hint: "stays until fixed" },
  { title: "Heating not working", type: "PROBLEM", icon: "thermometer", hint: "stays until fixed" },
  { title: "Blocked sink", type: "PROBLEM", icon: "droplet", hint: "stays until fixed" },
  { title: "Light bulb out", type: "PROBLEM", icon: "lightbulb", hint: "stays until fixed" },
  { title: "Pests spotted", type: "PROBLEM", icon: "bug", hint: "stays until fixed" },
  // Heads-ups
  {
    title: "Package arrived",
    type: "HEADS_UP",
    icon: "box",
    hint: "say where you left it",
    details: "Left it inside by the door.",
  },
  { title: "Quiet please", type: "HEADS_UP", icon: "moon", hint: "exam, early start…" },
  { title: "Away for a few days", type: "HEADS_UP", icon: "plane", hint: "on the board 7 days" },
  { title: "Door code changed", type: "HEADS_UP", icon: "key", hint: "on the board 7 days" },
  { title: "Food to share", type: "HEADS_UP", icon: "utensils", hint: "help yourself" },
  { title: "House meeting", type: "HEADS_UP", icon: "megaphone", hint: "on the board 7 days" },
]

/** The chips shown before anything is typed (Figma B6). */
export const POPULAR_POST_SUGGESTIONS: readonly PostSuggestion[] = [
  "Pest control visit",
  "Maintenance visit",
  "Water or power outage",
  "Guests staying",
  "Package arrived",
  "Something's broken",
  "Quiet please",
].map((title) => POST_SUGGESTIONS.find((suggestion) => suggestion.title === title)!)

export const TYPE_LABELS: Record<BoardPostType, string> = {
  EVENT: "Event",
  PROBLEM: "Problem",
  HEADS_UP: "Heads-up",
}

/** "Event · add the date and time" under a suggestion offered while typing. */
export function describePostSuggestion(suggestion: PostSuggestion): string {
  return `${TYPE_LABELS[suggestion.type]} · ${suggestion.hint}`
}

export type PostSuggestionMatch = {
  suggestion: PostSuggestion
  /** The title split around the first case-insensitive match, for bolding the matched part. */
  before: string
  match: string
  after: string
}

/**
 * Up to {@link limit} suggestions whose title contains the query (case-insensitive, trimmed).
 * Titles with a word that starts with the query come first, then the rest, each in list order. A
 * suggestion whose title is exactly the query is left out: there is nothing left to suggest.
 */
export function matchPostSuggestions(query: string, limit = 3): PostSuggestionMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const ranked: { rank: number; index: number; match: PostSuggestionMatch }[] = []
  POST_SUGGESTIONS.forEach((suggestion, index) => {
    const title = suggestion.title
    const lower = title.toLowerCase()
    if (lower === needle) return
    const at = lower.indexOf(needle)
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

/**
 * The built-in chore this text sounds like, or null. It matches when the text (3+ characters)
 * starts a word of a chore suggestion's name ("wat" → "Water plants") or contains a whole chore
 * name ("please take out garbage").
 */
export function choreHintFor(text: string): string | null {
  const needle = text.trim().toLowerCase()
  if (needle.length < 3) return null
  const startsAWord = matchChoreSuggestions(needle, 10).find(
    ({ before }) => before === "" || before.endsWith(" "),
  )
  if (startsAWord) return startsAWord.suggestion.title
  const words = ` ${needle.replace(/[^a-z0-9']+/g, " ")} `
  return (
    CHORE_SUGGESTIONS.find((suggestion) => words.includes(` ${suggestion.title.toLowerCase()} `))
      ?.title ?? null
  )
}
