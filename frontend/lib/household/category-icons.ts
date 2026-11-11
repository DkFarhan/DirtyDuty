/**
 * Icon keys a chore category may store. Mirrors `ChoreCategoryIcons` in the backend; the test in
 * category-icons.test.ts fails if the two lists drift apart.
 */

export type CategoryIconOption = { key: string; label: string; emoji: string }

/** Keys offered in the icon picker, in display order. */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = [
  { key: "kitchen", label: "Kitchen", emoji: "🍽️" },
  { key: "dishes", label: "Dishes", emoji: "🧽" },
  { key: "bathroom", label: "Bathroom", emoji: "🛁" },
  { key: "laundry", label: "Laundry", emoji: "🧺" },
  { key: "cleaning", label: "Cleaning", emoji: "🧹" },
  { key: "trash", label: "Trash", emoji: "🗑️" },
  { key: "recycling", label: "Recycling", emoji: "♻️" },
  { key: "bins", label: "Bins", emoji: "🚮" },
  { key: "plants", label: "Plants & garden", emoji: "🪴" },
  { key: "outdoor", label: "Outdoor & yard", emoji: "🌳" },
  { key: "shopping", label: "Shopping", emoji: "🛒" },
  { key: "groceries", label: "Groceries", emoji: "🥕" },
  { key: "pets", label: "Pets", emoji: "🐶" },
  { key: "kids", label: "Kids", emoji: "🧸" },
  { key: "car", label: "Car", emoji: "🚗" },
  { key: "maintenance", label: "Maintenance & tools", emoji: "🔧" },
  { key: "general", label: "General", emoji: "🏠" },
]

/** Emoji that were stored or rendered directly before keys existed. */
export const LEGACY_ICON_EMOJI = [
  "🧹",
  "🗑️",
  "🛁",
  "🧺",
  "🍽️",
  "🌀",
  "🫧",
  "♻️",
  "🪴",
  "🛒",
  "🧽",
  "🪣",
  "🏠",
] as const

/** Keys still accepted: the original seeds, aliases, and the old keyword matches. */
export const LEGACY_ICON_KEYWORDS: Readonly<Record<string, string>> = {
  broom: "🧹",
  home: "🏠",
  garden: "🪴",
  yard: "🌳",
  tools: "🔧",
  bath: "🛁",
  wash: "🧺",
  garbage: "🗑️",
  dish: "🍽️",
  plant: "🪴",
  shop: "🛒",
  recycle: "♻️",
}

export const ALLOWED_ICON_KEYS: readonly string[] = [
  ...CATEGORY_ICON_OPTIONS.map((option) => option.key),
  ...Object.keys(LEGACY_ICON_KEYWORDS),
  ...LEGACY_ICON_EMOJI,
]

const EXACT: Readonly<Record<string, string>> = {
  ...LEGACY_ICON_KEYWORDS,
  ...Object.fromEntries(CATEGORY_ICON_OPTIONS.map((option) => [option.key, option.emoji])),
}

/** Renders any stored icon key, including legacy emoji and keyword values, as an emoji. */
export function categoryIcon(iconKey: string | null | undefined) {
  if (!iconKey) return "🧹"
  if ((LEGACY_ICON_EMOJI as readonly string[]).includes(iconKey)) return iconKey
  const exact = EXACT[iconKey]
  if (exact) return exact
  // Unknown keys keep the original keyword matching so nothing stored renders differently.
  const normalized = iconKey.toLowerCase()
  if (normalized.includes("bath")) return "🛁"
  if (normalized.includes("laundry") || normalized.includes("wash")) return "🧺"
  if (normalized.includes("trash") || normalized.includes("garbage")) return "🗑️"
  if (normalized.includes("kitchen") || normalized.includes("dish")) return "🍽️"
  if (normalized.includes("plant") || normalized.includes("garden")) return "🪴"
  if (normalized.includes("shop")) return "🛒"
  if (normalized.includes("recycle")) return "♻️"
  if (normalized.includes("home") || normalized.includes("general")) return "🏠"
  return "🧹"
}

/** The picker key to preselect when editing a category with a legacy key. */
export function pickerKeyFor(iconKey: string | null | undefined) {
  if (!iconKey) return "general"
  if (CATEGORY_ICON_OPTIONS.some((option) => option.key === iconKey)) return iconKey
  const emoji = categoryIcon(iconKey)
  return CATEGORY_ICON_OPTIONS.find((option) => option.emoji === emoji)?.key ?? "general"
}
