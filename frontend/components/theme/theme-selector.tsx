"use client"

import { useTheme, type Theme } from "./theme-provider"

const options: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()

  return (
    <fieldset className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <legend className="px-1 text-sm font-bold text-slate-900">Appearance</legend>
      <p className="mb-4 mt-1 text-xs text-slate-500">Choose how DirtyDuty looks on this device.</p>
      <div aria-label="Color theme" className="grid grid-cols-3 gap-2" role="radiogroup">
        {options.map((option) => (
          <label
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-200 px-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-500 focus-within:ring-offset-2 data-[selected=true]:border-teal-600 data-[selected=true]:bg-teal-50 data-[selected=true]:text-teal-800 dark:border-slate-600 dark:text-slate-200 dark:focus-within:ring-offset-slate-900 dark:data-[selected=true]:border-teal-500 dark:data-[selected=true]:bg-teal-950/60 dark:data-[selected=true]:text-teal-200"
            key={option.value}
            data-selected={theme === option.value}
          >
            <input
              aria-label={option.label}
              checked={theme === option.value}
              className="sr-only"
              name="dirtyduty-theme"
              onChange={() => setTheme(option.value)}
              type="radio"
              value={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
