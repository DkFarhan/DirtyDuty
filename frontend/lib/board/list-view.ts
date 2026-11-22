import type { BoardList, BoardListItem, BoardShoppingSummary } from "./api"

/** "You're getting it", "Rubayet's on it", or null when nobody has claimed it. */
export function claimLabel(item: BoardListItem, viewerId: string) {
  if (!item.claimedByUserId) return null
  if (item.claimedByUserId === viewerId) return "You're getting it"
  return `${item.claimedByDisplayName ?? "Former member"}'s on it`
}

/** Needed today first, then the order they were added. */
export function sortOpenItems(items: BoardListItem[]) {
  return [...items].sort(
    (left, right) =>
      Number(right.neededToday) - Number(left.neededToday) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  )
}

/** "2 bought today · Paper towels, Rice"; up to three names, then "and N more". */
export function boughtSummary(bought: BoardListItem[]) {
  if (bought.length === 0) return null
  const names = bought.slice(0, 3).map((item) => item.name)
  const more = bought.length > 3 ? ` and ${bought.length - 3} more` : ""
  return `${bought.length} bought today · ${names.join(", ")}${more}`
}

function items(count: number) {
  return count === 1 ? "1 item" : `${count} items`
}

/** Home's Shopping row: "5 items · 1 needed today", "1 item". */
export function shoppingSubtitle(summary: Pick<BoardShoppingSummary, "openCount" | "todayCount">) {
  const today = summary.todayCount > 0 ? ` · ${summary.todayCount} needed today` : ""
  return `${items(summary.openCount)}${today}`
}

/** Home shows the Shopping row while something is on it. */
export function showShoppingRow(summary: BoardShoppingSummary | undefined | null) {
  return Boolean(summary && summary.openCount > 0)
}

/** The list counts after one item changes locally (optimistic add, buy, undo, today). */
export function withItemCounts(
  list: BoardList,
  before: BoardListItem | null,
  after: BoardListItem | null,
): BoardList {
  const open = (item: BoardListItem | null) => (item && !item.boughtAt ? 1 : 0)
  const today = (item: BoardListItem | null) => (item && !item.boughtAt && item.neededToday ? 1 : 0)
  return {
    ...list,
    openCount: Math.max(0, list.openCount + open(after) - open(before)),
    todayCount: Math.max(0, list.todayCount + today(after) - today(before)),
  }
}

/** The selected list: the one asked for, else the one remembered on this device, else Shopping. */
export function chooseList(
  lists: BoardList[],
  requested: string | null,
  remembered: string | null,
) {
  return (
    lists.find((list) => list.id === requested) ??
    lists.find((list) => list.id === remembered) ??
    lists.find((list) => list.defaultList) ??
    lists[0] ??
    null
  )
}

const storageKey = (householdId: string) => `dirtyduty.board.list.${householdId}`

/** The last list selected on this device for the household (null when storage is unavailable). */
export function rememberedListId(householdId: string) {
  try {
    return window.localStorage.getItem(storageKey(householdId))
  } catch {
    return null
  }
}

export function rememberListId(householdId: string, listId: string) {
  try {
    window.localStorage.setItem(storageKey(householdId), listId)
  } catch {
    // Private mode or blocked storage: the default list shows next time.
  }
}

/** Quick picks on New list (B11). */
export const LIST_QUICK_PICKS = [
  "Groceries",
  "Party",
  "Trip",
  "Moving out",
  "Costco run",
  "Cleaning supplies",
]

export const MAX_LIST_NAME = 40
export const MAX_ITEM_NAME = 80
export const MAX_ITEM_NOTE = 60
export const MAX_LISTS = 20

/** The reason a list name can't be saved yet, or null. */
export function listNameError(name: string, lists: BoardList[], exceptId: string | null = null) {
  const trimmed = name.trim()
  if (!trimmed) return "Enter a name for the list."
  if (trimmed.length > MAX_LIST_NAME) return `Keep list names to ${MAX_LIST_NAME} characters.`
  const taken = lists.find(
    (list) =>
      list.id !== exceptId && list.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  )
  return taken ? `There's already a list called ${taken.name}.` : null
}
