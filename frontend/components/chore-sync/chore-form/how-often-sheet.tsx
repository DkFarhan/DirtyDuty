"use client"

import { useState, type ReactNode } from "react"
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Flag,
  RefreshCw,
  SlidersHorizontal,
  Sun,
} from "lucide-react"
import {
  MAX_AFTER,
  MAX_BACKSTOP_DAYS,
  customScheduleError,
  oftenLabel,
  ordinalDay,
  weekdayShort,
  withOften,
  type CustomSchedule,
  type OftenChoice,
  type QuickValues,
} from "@/lib/household/chore-quick-form"
import { defaultRecurrence, type Recurrence } from "@/lib/household/recurrence"
import { CustomScheduleEditor, type CustomDraft } from "./custom-schedule-editor"
import { FormSheet, Stepper, type FormTheme } from "./form-sheet"
import styles from "./chore-form.module.css"

/** The "Custom…" editor's starting point: the current choice, written as a calendar rule. */
function draftFrom(values: QuickValues): CustomDraft {
  const base = { startsOn: values.startsOn, dueTime: values.dueTime || "18:00" }
  if (values.often === "CUSTOM" && values.keptRule === null) {
    return { ...base, custom: values.custom }
  }
  const seed: Recurrence = {
    ...defaultRecurrence(values.startsOn),
    weekdays: [values.anchorWeekday],
  }
  const custom: CustomSchedule = { ...values.custom, seasonal: false, endMode: "NEVER", endsOn: "" }
  switch (values.often) {
    case "DAILY":
      return { ...base, custom: { ...custom, recurrence: { ...seed, frequency: "DAILY" } } }
    case "WEEKLY":
    case "BIWEEKLY":
      return {
        ...base,
        custom: {
          ...custom,
          recurrence: { ...seed, frequency: "WEEKLY", interval: values.often === "WEEKLY" ? 1 : 2 },
        },
      }
    case "MONTHLY":
      return {
        ...base,
        custom: {
          ...custom,
          recurrence: {
            ...seed,
            frequency: "MONTHLY",
            monthlyMode: "DAY",
            monthDay: values.anchorMonthDay,
          },
        },
      }
    default:
      return { ...base, custom: { ...custom, recurrence: seed } }
  }
}

type Option = {
  value: OftenChoice
  title: string
  hint?: string
  icon: ReactNode
  pill?: string
}

/**
 * "How often?": tap-once choices that apply immediately, with small inline controls on the
 * selected one, and "Custom…" for the full calendar editor.
 */
export function HowOftenSheet({
  values,
  theme,
  onChange,
  onClose,
  returnFocusTo,
}: {
  values: QuickValues
  theme: FormTheme
  onChange: (values: QuickValues) => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [draft, setDraft] = useState<CustomDraft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  if (draft) {
    const apply = () => {
      const message = customScheduleError(draft.custom, draft.startsOn)
      if (message) {
        setDraftError(message)
        return
      }
      onChange(
        withOften(values, "CUSTOM", {
          custom: draft.custom,
          startsOn: draft.startsOn,
          dueTime: draft.dueTime,
          keptRule: null,
          keptEndsOn: null,
        }),
      )
      setDraft(null)
      setDraftError(null)
    }
    return (
      // Keyed so the sub-view opens scrolled to its top.
      <FormSheet
        footer={
          <>
            {draftError && (
              <p className={styles.sheetError} role="alert">
                {draftError}
              </p>
            )}
            <button className={styles.sheetPrimary} onClick={apply} type="button">
              Use this schedule
            </button>
          </>
        }
        onBack={() => {
          // Back leaves the current choice exactly as it was.
          setDraft(null)
          setDraftError(null)
        }}
        onClose={onClose}
        key="custom"
        returnFocusTo={returnFocusTo}
        theme={theme}
        title="Custom schedule"
      >
        {values.often === "CUSTOM" && values.keptRule !== null && (
          <p className={styles.sheetNote}>
            This chore&apos;s current schedule can&apos;t be shown here. It stays as it is unless
            you use a new one.
          </p>
        )}
        <CustomScheduleEditor
          draft={draft}
          onChange={(next) => {
            setDraft(next)
            setDraftError(null)
          }}
        />
      </FormSheet>
    )
  }

  const choose = (often: OftenChoice) => {
    if (often === "CUSTOM") {
      setDraft(draftFrom(values))
      return
    }
    if (often === values.often) return
    const patch: Partial<QuickValues> = {}
    // A deadline needs a time; keep the one already chosen.
    if (often !== "AS_NEEDED" && !values.dueTime) patch.dueTime = "18:00"
    onChange(withOften(values, often, patch))
  }
  const set = (patch: Partial<QuickValues>) => onChange(withOften(values, values.often, patch))

  const timeControl = (label = "Due time") => (
    <label className={styles.inlineControls}>
      <span className={styles.panelLabel}>By</span>
      <input
        aria-label={label}
        className={styles.timeInput}
        onChange={(event) => set({ dueTime: event.target.value })}
        type="time"
        value={values.dueTime}
      />
    </label>
  )

  const options: Option[] = [
    { value: "DAILY", title: "Every day", icon: <Sun size={18} /> },
    {
      value: "WEEKLY",
      title: "Every week",
      icon: <CalendarDays size={18} />,
      pill: weekdayShort(values.anchorWeekday),
    },
    {
      value: "BIWEEKLY",
      title: "Every 2 weeks",
      icon: <CalendarDays size={18} />,
      pill: weekdayShort(values.anchorWeekday),
    },
    {
      value: "MONTHLY",
      title: "Every month",
      icon: <CalendarDays size={18} />,
      pill: ordinalDay(values.anchorMonthDay),
    },
    {
      value: "AFTER_COMPLETION",
      title: "Every few days, after it's done",
      hint: "Counts from the last time it was done",
      icon: <RefreshCw size={18} />,
    },
    {
      value: "AS_NEEDED",
      title: "When it's needed",
      hint: "Anyone can flag it. Turns rotate.",
      icon: <Bell size={18} />,
    },
    { value: "ONCE", title: "Just once", hint: "By a date you choose", icon: <Flag size={18} /> },
  ]

  const panel = (often: OftenChoice) => {
    switch (often) {
      case "DAILY":
      case "WEEKLY":
      case "BIWEEKLY":
      case "MONTHLY":
        return <div className={styles.optionPanel}>{timeControl()}</div>
      case "AFTER_COMPLETION": {
        const max = MAX_AFTER[values.afterUnit]
        return (
          <div className={styles.optionPanel}>
            <p className={styles.panelLabel}>Due again after it&apos;s done</p>
            <div className={styles.inlineControls}>
              <Stepper
                canDecrease={values.afterCount > 1}
                canIncrease={values.afterCount < max}
                label="Interval after it's done"
                onDecrease={() => set({ afterCount: values.afterCount - 1 })}
                onIncrease={() => set({ afterCount: values.afterCount + 1 })}
                unit={
                  values.afterUnit === "WEEK"
                    ? values.afterCount === 1
                      ? "week"
                      : "weeks"
                    : values.afterCount === 1
                      ? "day"
                      : "days"
                }
                value={values.afterCount}
              />
              <div className={styles.segmented} style={{ ["--segments" as string]: 2 }}>
                {(["DAY", "WEEK"] as const).map((unit) => (
                  <button
                    aria-pressed={values.afterUnit === unit}
                    className={styles.segment}
                    key={unit}
                    onClick={() =>
                      set({
                        afterUnit: unit,
                        afterCount: Math.min(values.afterCount, MAX_AFTER[unit]),
                      })
                    }
                    type="button"
                  >
                    {unit === "DAY" ? "Days" : "Weeks"}
                  </button>
                ))}
              </div>
            </div>
            {timeControl()}
            <label className={styles.inlineControls}>
              <span className={styles.panelLabel}>First due</span>
              <input
                aria-label="First due date"
                className={styles.dateInput}
                onChange={(event) => set({ startsOn: event.target.value })}
                type="date"
                value={values.startsOn}
              />
            </label>
          </div>
        )
      }
      case "AS_NEEDED":
        return (
          <div className={styles.optionPanel}>
            {values.backstopEnabled ? (
              <>
                <p className={styles.panelLabel}>Do at least every</p>
                <div className={styles.inlineControls}>
                  <Stepper
                    canDecrease={values.backstopDays > 1}
                    canIncrease={values.backstopDays < MAX_BACKSTOP_DAYS}
                    label="Do at least every"
                    onDecrease={() => set({ backstopDays: values.backstopDays - 1 })}
                    onIncrease={() => set({ backstopDays: values.backstopDays + 1 })}
                    unit={values.backstopDays === 1 ? "day" : "days"}
                    value={values.backstopDays}
                  />
                  <input
                    aria-label="Deadline time"
                    className={styles.timeInput}
                    onChange={(event) => set({ dueTime: event.target.value })}
                    type="time"
                    value={values.dueTime}
                  />
                </div>
                <button
                  className={styles.linkButton}
                  onClick={() => set({ backstopEnabled: false })}
                  type="button"
                >
                  No deadline
                </button>
              </>
            ) : (
              <>
                <p className={styles.panelLabel}>
                  No deadline. It&apos;s done whenever someone flags it.
                </p>
                <button
                  className={styles.linkButton}
                  onClick={() => set({ backstopEnabled: true, dueTime: values.dueTime || "20:00" })}
                  type="button"
                >
                  Add a deadline
                </button>
              </>
            )}
          </div>
        )
      case "ONCE":
        return (
          <div className={styles.optionPanel}>
            <label className={styles.inlineControls}>
              <span className={styles.panelLabel}>On</span>
              <input
                aria-label="Date"
                className={styles.dateInput}
                onChange={(event) => set({ startsOn: event.target.value })}
                type="date"
                value={values.startsOn}
              />
            </label>
            {timeControl()}
          </div>
        )
      default:
        return null
    }
  }

  const customSelected = values.often === "CUSTOM"
  return (
    <FormSheet
      footer={
        <button className={styles.sheetPrimary} onClick={onClose} type="button">
          Done
        </button>
      }
      key="choices"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      title="How often?"
    >
      <ul aria-label="How often" className={styles.options}>
        {options.map((option) => {
          const selected = values.often === option.value
          return (
            <li className={styles.optionItem} data-selected={selected} key={option.value}>
              <button
                aria-pressed={selected}
                className={styles.option}
                onClick={() => choose(option.value)}
                type="button"
              >
                <span aria-hidden="true" className={styles.optionTile}>
                  {option.icon}
                </span>
                <span>
                  <span className={styles.optionTitle}>{option.title}</span>
                  {option.hint && <span className={styles.optionHint}>{option.hint}</span>}
                </span>
                <span className={styles.optionEnd}>
                  {option.pill && <span className={styles.pill}>{option.pill}</span>}
                  <span aria-hidden="true" className={styles.radio}>
                    {selected && <Check size={14} strokeWidth={3} />}
                  </span>
                </span>
              </button>
              {selected && panel(option.value)}
            </li>
          )
        })}
        <li className={styles.optionItem} data-selected={customSelected}>
          <button
            aria-haspopup="dialog"
            className={styles.option}
            onClick={() => choose("CUSTOM")}
            type="button"
          >
            <span aria-hidden="true" className={styles.optionTile}>
              <SlidersHorizontal size={18} />
            </span>
            <span>
              <span className={styles.optionTitle}>Custom…</span>
              <span className={styles.optionHint}>
                {customSelected
                  ? oftenLabel(values).replace(/^Custom · /, "")
                  : "Weekdays, monthly patterns, seasons, end dates"}
              </span>
            </span>
            <span className={styles.optionEnd}>
              <ChevronRight aria-hidden="true" size={18} />
            </span>
          </button>
        </li>
      </ul>
    </FormSheet>
  )
}
