"use client"

import { useTheme, type Theme } from "./theme-provider"
import styles from "./theme-selector.module.css"

const options: Array<{
  value: Theme
  label: string
  description?: string
}> = [
  {
    value: "light",
    label: "Light",
    description: "Bright and clear",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Easy on the eyes",
  },
  {
    value: "system",
    label: "System",
    description: "Use your device appearance",
  },
]

export function ThemeSelector() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <fieldset className={styles.selector} data-theme={resolvedTheme}>
      <legend className="sr-only">Color theme</legend>
      <div aria-label="Color theme" className={styles.group} role="radiogroup">
        {options.map(({ value, label, description }) => {
          const selected = theme === value

          return (
            <label
              className={styles.option}
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
              <span className={styles.iconTile}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className={styles.optionIcon}
                  src={`/profile-redesign/icons/theme-${value}-${resolvedTheme}.svg`}
                />
              </span>
              <span className={styles.optionCopy}>
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {label}
                </span>
                {description && (
                  <span className={styles.description} id={`theme-description-${value}`}>
                    {description}
                  </span>
                )}
              </span>
              <span aria-hidden="true" className={styles.radioVisual} data-selected={selected} />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
