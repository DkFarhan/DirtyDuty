/**
 * Suggestions for the list's add field: names this household added before (most recent first),
 * then a built-in list of common household items. Up to three, household names first.
 */

export const MAX_ITEM_SUGGESTIONS = 3

/** Common household items, by kind; the order within a kind is the suggestion order. */
export const COMMON_ITEMS: Record<
  "groceries" | "cleaning" | "toiletries" | "kitchen" | "laundry",
  string[]
> = {
  groceries: [
    "Milk",
    "Eggs",
    "Bread",
    "Butter",
    "Cheese",
    "Yogurt",
    "Rice",
    "Pasta",
    "Pasta sauce",
    "Olive oil",
    "Cooking oil",
    "Flour",
    "Sugar",
    "Salt",
    "Black pepper",
    "Coffee",
    "Tea",
    "Cereal",
    "Oats",
    "Peanut butter",
    "Jam",
    "Honey",
    "Bananas",
    "Apples",
    "Onions",
    "Garlic",
    "Potatoes",
    "Tomatoes",
    "Lettuce",
    "Carrots",
    "Chicken",
    "Ground beef",
    "Canned tuna",
    "Canned beans",
    "Orange juice",
    "Bottled water",
    "Snacks",
  ],
  cleaning: [
    "Dish soap",
    "Dishwasher pods",
    "Dish sponges",
    "All-purpose cleaner",
    "Glass cleaner",
    "Bathroom cleaner",
    "Toilet cleaner",
    "Bleach",
    "Disinfectant wipes",
    "Paper towels",
    "Garbage bags",
    "Recycling bags",
    "Mop refills",
    "Rubber gloves",
    "Scrub brush",
  ],
  toiletries: [
    "Toilet paper",
    "Hand soap",
    "Shampoo",
    "Conditioner",
    "Body wash",
    "Toothpaste",
    "Toothbrushes",
    "Dental floss",
    "Deodorant",
    "Razors",
    "Tissues",
    "Cotton pads",
  ],
  kitchen: [
    "Aluminum foil",
    "Plastic wrap",
    "Parchment paper",
    "Zip bags",
    "Food containers",
    "Napkins",
    "Paper plates",
    "Coffee filters",
    "Light bulbs",
    "Batteries",
  ],
  laundry: [
    "Laundry detergent",
    "Fabric softener",
    "Dryer sheets",
    "Stain remover",
    "Laundry pods",
  ],
}

const BUILT_IN = Object.values(COMMON_ITEMS).flat()

export type ItemSuggestion = {
  name: string
  /** The name split around the matched part, for bold. */
  before: string
  match: string
  after: string
  source: "household" | "common"
}

const key = (name: string) => name.trim().toLocaleLowerCase()

/**
 * Where {@link query} matches {@link name}: at the start of the name (best), or at the start of a
 * later word ("soap" in "Dish soap"). -1 when it doesn't.
 */
function matchAt(name: string, query: string) {
  const lower = name.toLocaleLowerCase()
  if (lower.startsWith(query)) return 0
  for (let index = 1; index < lower.length; index++) {
    if (/[\s\-/]/.test(lower[index - 1]) && lower.startsWith(query, index)) return index
  }
  return -1
}

/**
 * Up to {@link limit} suggestions for what's typed: household names first (most recent first),
 * then the built-in items; names that start with the query come before names with a later word
 * that does. Names equal to the query or already open on the list ({@link exclude}) are left out.
 */
export function itemSuggestions(
  typed: string,
  recent: string[],
  exclude: Iterable<string> = [],
  limit = MAX_ITEM_SUGGESTIONS,
): ItemSuggestion[] {
  const query = key(typed)
  if (!query) return []
  const skip = new Set([...exclude].map(key))
  skip.add(query)
  const seen = new Set<string>()
  const ranked: (ItemSuggestion & { rank: number; order: number })[] = []
  const consider = (name: string, source: ItemSuggestion["source"], order: number) => {
    const id = key(name)
    if (!id || seen.has(id) || skip.has(id)) return
    const at = matchAt(name.trim(), query)
    if (at < 0) return
    seen.add(id)
    const trimmed = name.trim()
    ranked.push({
      name: trimmed,
      before: trimmed.slice(0, at),
      match: trimmed.slice(at, at + query.length),
      after: trimmed.slice(at + query.length),
      source,
      // Household names outrank built-in ones; within each, a name-start match outranks a word one.
      rank: (source === "household" ? 0 : 2) + (at === 0 ? 0 : 1),
      order,
    })
  }
  recent.forEach((name, index) => consider(name, "household", index))
  BUILT_IN.forEach((name, index) => consider(name, "common", index))
  return ranked
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, limit)
    .map(({ name, before, match, after, source }) => ({ name, before, match, after, source }))
}
