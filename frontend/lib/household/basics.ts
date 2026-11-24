import type { ChoreRequest } from "./chores"
import { CHORE_SUGGESTIONS, type ChoreSuggestion } from "./chore-suggestions"
import {
  applySuggestion,
  buildQuickRequest,
  initialQuickValues,
  type QuickContext,
} from "./chore-quick-form"

/**
 * "Start with the basics": the card a new household sees on Home and My Chores until it has a
 * chore, and the four chores "Add these 4" creates in one go.
 */

export const BASICS_TITLES = [
  "Wash dishes",
  "Take out garbage",
  "Clean bathroom",
  "Vacuum",
] as const

export const BASICS: readonly ChoreSuggestion[] = BASICS_TITLES.map((title) =>
  CHORE_SUGGESTIONS.find((suggestion) => suggestion.title === title)!,
)

/** "Every day", "When it's needed", "Every week": the short line on each row. */
export function basicsOften(suggestion: ChoreSuggestion): string {
  switch (suggestion.often.type) {
    case "DAILY":
      return "Every day"
    case "WEEKLY":
      return "Every week"
    case "BIWEEKLY":
      return "Every 2 weeks"
    case "MONTHLY":
      return "Every month"
    case "AFTER_COMPLETION":
      return "After it's done"
    case "AS_NEEDED":
      return "When it's needed"
  }
}

/**
 * The four requests, each from its built-in suggestion: the same setup Quick create would fill
 * in, with Take turns between everyone (people who join later included). Categories are matched by
 * name.
 */
export function basicsRequests<T extends { id: string; name: string }>(
  context: QuickContext,
  categories: readonly T[],
): ChoreRequest[] {
  return BASICS.map((suggestion) => {
    const filled = applySuggestion(initialQuickValues(context), suggestion, categories, context)
    const values = {
      ...filled,
      who: "TURNS" as const,
      participants: context.members.map((member) => member.userId),
      everyone: true,
      peopleNeeded: 1,
    }
    const result = buildQuickRequest(values, context)
    if ("error" in result) throw new Error(result.error.message)
    return result.request
  })
}

/** The card shows once chores are known to be none (not while loading or after an error). */
export function showBasics(hasChores: boolean | undefined | null): boolean {
  return hasChores === false
}
