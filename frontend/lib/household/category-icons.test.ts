import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ALLOWED_ICON_KEYS,
  CATEGORY_ICON_OPTIONS,
  LEGACY_ICON_EMOJI,
  LEGACY_ICON_KEYWORDS,
  categoryIcon,
  pickerKeyFor,
} from "./category-icons"

/** The renderer before shared icon keys existed, kept verbatim as the legacy reference. */
function previousCategoryIcon(iconKey: string | null | undefined) {
  if (!iconKey) return "🧹"
  const icons = new Set([
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
  ])
  if (icons.has(iconKey)) return iconKey
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

describe("category icons", () => {
  // The six default seeds, every legacy emoji, every keyword the old renderer matched, and a
  // few free-form keys that only the old substring matching handled.
  const legacyKeys = [
    "kitchen",
    "bathroom",
    "laundry",
    "trash",
    "broom",
    "home",
    ...LEGACY_ICON_EMOJI,
    "bath",
    "wash",
    "garbage",
    "dish",
    "plant",
    "garden",
    "shop",
    "recycle",
    "general",
    "Kitchen-Deep-Clean",
    "WASHING",
    "unknown-key",
    "",
    null,
    undefined,
  ]

  it.each(legacyKeys.map((key) => [key]))("renders legacy key %j exactly as before", (key) => {
    expect(categoryIcon(key)).toBe(previousCategoryIcon(key))
  })

  it("renders every picker key with its own emoji", () => {
    for (const option of CATEGORY_ICON_OPTIONS) {
      expect(categoryIcon(option.key), option.key).toBe(option.emoji)
    }
    expect(new Set(CATEGORY_ICON_OPTIONS.map((option) => option.emoji)).size).toBe(
      CATEGORY_ICON_OPTIONS.length,
    )
  })

  it("renders the new aliases", () => {
    expect(categoryIcon("yard")).toBe("🌳")
    expect(categoryIcon("tools")).toBe("🔧")
    expect(categoryIcon("garden")).toBe("🪴")
  })

  it("preselects the matching picker icon for legacy keys", () => {
    expect(pickerKeyFor("broom")).toBe("cleaning")
    expect(pickerKeyFor("home")).toBe("general")
    expect(pickerKeyFor("🧺")).toBe("laundry")
    expect(pickerKeyFor("pets")).toBe("pets")
    expect(pickerKeyFor(null)).toBe("general")
  })

  it("matches the backend allowed list exactly", () => {
    const java = readFileSync(
      join(
        __dirname,
        "../../../backend/src/main/java/com/dirtyduty/app/service/ChoreCategoryIcons.java",
      ),
      "utf8",
    )
    const listLiterals = (name: string) => {
      const match = new RegExp(`${name}\\s*=\\s*List\\.of\\(([^;]*)\\);`, "s").exec(java)
      expect(match, name).not.toBeNull()
      return Array.from(match![1].matchAll(/"([^"]*)"/g), (literal) => literal[1])
    }
    expect(listLiterals("PICKER")).toEqual(CATEGORY_ICON_OPTIONS.map((option) => option.key))
    expect(new Set(listLiterals("LEGACY"))).toEqual(
      new Set([...Object.keys(LEGACY_ICON_KEYWORDS), ...LEGACY_ICON_EMOJI]),
    )
    expect(new Set([...listLiterals("PICKER"), ...listLiterals("LEGACY")])).toEqual(
      new Set(ALLOWED_ICON_KEYS),
    )
  })
})
