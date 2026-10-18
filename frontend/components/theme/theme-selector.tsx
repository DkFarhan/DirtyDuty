"use client"

import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useTheme, type Theme } from "./theme-provider"

const options: Array<{
  value: Theme
  label: string
  description: string
  Icon: typeof Sun
}> = [
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
    Icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
    Icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Match your device appearance automatically.",
    Icon: Monitor,
  },
]

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()

  return (
    <fieldset className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <legend className="sr-only">Color theme</legend>
      <div aria-label="Color theme" role="radiogroup">
        {options.map(({ value, label, description, Icon }, index) => {
          const selected = theme === value

          return (
            <label
              className={`relative flex min-h-[88px] cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50 focus-within:z-10 focus-within:outline-none focus-within:ring-2 focus-within:ring-inset focus-within:ring-teal-600 dark:hover:bg-slate-800/70 dark:focus-within:ring-teal-400 ${index < options.length - 1 ? "border-b border-slate-200 dark:border-slate-800" : ""}`}
              data-selected={selected}
              key={value}
            >
              <input
                aria-label={label}
                aria-describedby={`theme-description-${value}`}
                checked={selected}
                className="sr-only"
                name="dirtyduty-theme"
                onChange={() => setTheme(value)}
                type="radio"
                value={value}
              />
              <Icon
                aria-hidden="true"
                className="h-6 w-6 shrink-0 text-slate-600 dark:text-slate-300"
                strokeWidth={1.8}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-slate-900 dark:text-slate-100">
                  {label}
                </span>
                <span
                  className="mt-0.5 block text-sm leading-5 text-slate-600 dark:text-slate-400"
                  id={`theme-description-${value}`}
                >
                  {description}
                </span>
              </span>
              {selected && (
                <Check
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-teal-700 dark:text-teal-300"
                  strokeWidth={2.2}
                />
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
