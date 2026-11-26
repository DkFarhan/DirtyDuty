"use client"

import { useState, type ReactNode } from "react"
import { Bell, BellOff, BellPlus, BellRing, Check, Siren } from "lucide-react"
import { REMINDER_LEVELS, type ReminderLevel } from "@/lib/household/reminder-levels"
import { FormSheet, type FormTheme } from "./form-sheet"
import styles from "./chore-form.module.css"

const ICONS: Record<ReminderLevel, ReactNode> = {
  OFF: <BellOff size={18} />,
  FRIENDLY: <Bell size={18} />,
  STANDARD: <BellRing size={18} />,
  AGGRESSIVE: <BellPlus size={18} />,
  INTENSE: <Siren size={18} />,
}

/**
 * "Reminders" (E13): Off, Light, Standard, Full or Intense, each with what it sends. Used for one
 * chore (More options) and for the household default (settings). Done applies the choice.
 */
export function RemindersSheet({
  title = "Reminders",
  intro,
  note,
  level,
  theme,
  onChange,
  onClose,
  returnFocusTo,
}: {
  title?: string
  intro?: ReactNode
  /** Shown above the options, e.g. that a chore with no deadline sends none. */
  note?: string | null
  level: ReminderLevel
  theme: FormTheme
  onChange: (level: ReminderLevel) => void
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null
}) {
  const [next, setNext] = useState(level)
  return (
    <FormSheet
      footer={
        <button
          className={styles.sheetPrimary}
          onClick={() => {
            onChange(next)
            onClose()
          }}
          type="button"
        >
          Done
        </button>
      }
      intro={intro}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      title={title}
    >
      {note && <p className={styles.sheetNote}>{note}</p>}
      <ul aria-label={title} className={styles.options} role="radiogroup">
        {REMINDER_LEVELS.map((option) => {
          const selected = next === option.mode
          return (
            <li className={styles.optionItem} data-selected={selected} key={option.mode}>
              <button
                aria-checked={selected}
                className={styles.option}
                onClick={() => setNext(option.mode)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className={styles.optionTile}>
                  {ICONS[option.mode]}
                </span>
                <span>
                  <span className={styles.optionTitle}>{option.label}</span>
                  <span className={styles.optionHint}>{option.description}</span>
                </span>
                <span className={styles.optionEnd}>
                  <span aria-hidden="true" className={styles.radio}>
                    {selected && <Check size={14} strokeWidth={3} />}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </FormSheet>
  )
}
