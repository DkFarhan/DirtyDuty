import type { AssignmentDTO, MyWeek } from "./chores"
import { shortDate } from "./chore-quick-form"

/**
 * Week by week chores on cards and Home: whose week an occurrence falls in ("Your week · until Sun,
 * Dec 7") and the viewer's own weeks ("Your weeks: Kitchen chores").
 */

export type WeekChipView = {
  /** "Your week · until Sun, Dec 7" or "Rubayet's week · until Sun, Dec 7". */
  text: string
  /** The viewer's own week (accent chip, no avatar). */
  mine: boolean
  /** The owner's initial for the avatar, on someone else's week. */
  initial: string | null
}

/** The chip for a pending Week by week occurrence, or null for any other. */
export function weekChip(
  assignment: Pick<AssignmentDTO, "week" | "status">,
  viewerId: string,
): WeekChipView | null {
  const week = assignment.week
  if (!week || (assignment.status && assignment.status !== "PENDING")) return null
  const until = `until ${shortDate(week.until)}`
  if (week.owner.userId === viewerId) {
    return { text: `Your week · ${until}`, mine: true, initial: null }
  }
  const name = week.owner.displayName.trim() || "Someone"
  return { text: `${name}'s week · ${until}`, mine: false, initial: name.charAt(0).toUpperCase() }
}

export type MyWeeksLine = { title: string; detail: string }

/**
 * Home's one line about the viewer's Week by week chores this period: "Your weeks: Wash dishes",
 * "Your weeks: Kitchen chores" when they share a category, else the first chore and how many more.
 * The detail is when the first period ends and who takes over.
 */
export function myWeeksLine(weeks: readonly MyWeek[] | undefined): MyWeeksLine | null {
  if (!weeks || weeks.length === 0) return null
  const first = weeks[0]
  const category = first.categoryName
  const sameCategory =
    weeks.length > 1 && category !== null && weeks.every((week) => week.categoryName === category)
  const what =
    weeks.length === 1
      ? first.title
      : sameCategory
        ? `${category} chores`
        : `${first.title} +${weeks.length - 1}`
  const until = `Until ${shortDate(first.until)}`
  return {
    title: `Your weeks: ${what}`,
    detail: first.next ? `${until} · then ${first.next.displayName} takes over` : until,
  }
}
