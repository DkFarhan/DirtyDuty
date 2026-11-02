"use client"

import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useTheme, type Theme } from "./theme-provider"
import styles from "./theme-selector.module.css"

const options: Array<{
  value: Theme
  label: string
  description?: string
  Icon: typeof Sun
}> = [
  {
    value: "light",
    label: "Light",
    description: "Bright and clear",
    Icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Easy on the eyes",
    Icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Use your device appearance",
    Icon: Monitor,
  },
]

export function ThemeSelector({ redesigned = false }: { redesigned?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <fieldset
      className={redesigned ? styles.selector : undefined}
      data-theme={redesigned ? resolvedTheme : undefined}
    >
      <legend className="sr-only">Color theme</legend>
      <div
        aria-label="Color theme"
        className={redesigned ? styles.group : undefined}
        role="radiogroup"
      >
        {options.map(({ value, label, description, Icon }, index) => {
          const selected = theme === value

          return (
            <label
              className={`${redesigned ? styles.option : "relative flex min-h-16 cursor-pointer items-center gap-3 px-2 py-2 transition-colors hover:bg-slate-100/70 focus-within:z-10 focus-within:outline-none focus-within:ring-2 focus-within:ring-inset focus-within:ring-teal-700 dark:hover:bg-slate-800/60 dark:focus-within:ring-teal-400"} ${!redesigned && index < options.length - 1 ? "border-b border-slate-200/80 dark:border-slate-800" : ""}`}
              data-selected={selected}
              data-theme={value}
              key={value}
            >
              <input
                aria-label={label}
                aria-describedby={description ? `theme-description-${value}` : undefined}
                checked={selected}
                className="sr-only"
                name="dirtyduty-theme"
                onChange={() => setTheme(value)}
                type="radio"
                value={value}
              />
              {redesigned ? (
                <span className={styles.iconTile}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className={styles.optionIcon}
                    src={`/profile-redesign/icons/theme-${value}-${resolvedTheme}.svg`}
                  />
                </span>
              ) : (
                <Icon
                  aria-hidden="true"
                  className="h-[18px] w-[18px] shrink-0 text-slate-600 dark:text-slate-300"
                  strokeWidth={1.8}
                />
              )}
              <span className={redesigned ? styles.optionCopy : "min-w-0 flex-1"}>
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {label}
                </span>
                {description && (redesigned || value === "system") && (
                  <span
                    className={
                      redesigned
                        ? styles.description
                        : "mt-0.5 block text-xs leading-4 text-slate-600 dark:text-slate-400"
                    }
                    id={`theme-description-${value}`}
                  >
                    {description}
                  </span>
                )}
              </span>
              {redesigned ? (
                <span aria-hidden="true" className={styles.radioVisual} data-selected={selected} />
              ) : (
                selected && (
                  <Check
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-teal-800 dark:text-teal-300"
                    strokeWidth={2.2}
                  />
                )
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
