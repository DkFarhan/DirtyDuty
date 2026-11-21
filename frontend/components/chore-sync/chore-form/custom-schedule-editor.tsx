"use client"

import { Sparkles } from "lucide-react"
import {
  INTERVAL_UNIT,
  MAX_COUNT,
  MAX_INTERVAL,
  MONTHS,
  ORDINALS,
  WEEKDAYS,
  describeRecurrence,
  type Frequency,
  type MonthlyMode,
  type Recurrence,
} from "@/lib/household/recurrence"
import {
  clockLabel,
  effectiveCustomRecurrence,
  type CustomSchedule,
  type EndMode,
} from "@/lib/household/chore-quick-form"
import { Stepper, ToggleRow } from "./form-sheet"
import styles from "./chore-form.module.css"

export type CustomDraft = { custom: CustomSchedule; startsOn: string; dueTime: string }

type Repeating = Exclude<Frequency, "ONCE">

const FREQUENCIES: [Repeating, string][] = [
  ["DAILY", "Daily"],
  ["WEEKLY", "Weekly"],
  ["MONTHLY", "Monthly"],
  ["YEARLY", "Yearly"],
]

/**
 * The advanced calendar controls behind "Custom…": frequency, interval, weekdays, monthly modes,
 * a yearly date, active months, and an end date or count. The rule itself is built by
 * recurrence.ts.
 */
export function CustomScheduleEditor({
  draft,
  onChange,
}: {
  draft: CustomDraft
  onChange: (draft: CustomDraft) => void
}) {
  const { custom } = draft
  const recurrence = custom.recurrence
  const frequency = (recurrence.frequency === "ONCE" ? "WEEKLY" : recurrence.frequency) as Repeating
  const setCustom = (patch: Partial<CustomSchedule>) =>
    onChange({ ...draft, custom: { ...custom, ...patch } })
  const setRecurrence = (patch: Partial<Recurrence>) =>
    setCustom({ recurrence: { ...recurrence, ...patch } })
  const unit = INTERVAL_UNIT[frequency][recurrence.interval === 1 ? 0 : 1]
  const summary = describeRecurrence(
    effectiveCustomRecurrence(custom),
    custom.endMode === "DATE" ? custom.endsOn || null : null,
  )

  return (
    <div className={styles.customForm}>
      <fieldset className={styles.customField}>
        <legend>Repeats</legend>
        <div className={styles.segmented}>
          {FREQUENCIES.map(([value, label]) => (
            <button
              aria-pressed={frequency === value}
              className={styles.segment}
              key={value}
              onClick={() =>
                setRecurrence({
                  frequency: value,
                  interval: Math.min(recurrence.interval, MAX_INTERVAL[value]),
                })
              }
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.customGrid}>
        <div className={styles.customField}>
          <span>Every</span>
          <Stepper
            canDecrease={recurrence.interval > 1}
            canIncrease={recurrence.interval < MAX_INTERVAL[frequency]}
            label="Repeat every"
            onDecrease={() => setRecurrence({ interval: recurrence.interval - 1 })}
            onIncrease={() => setRecurrence({ interval: recurrence.interval + 1 })}
            unit={unit}
            value={recurrence.interval}
          />
        </div>
        <label className={styles.customField}>
          <span>Due time</span>
          <input
            className={styles.timeInput}
            onChange={(event) => onChange({ ...draft, dueTime: event.target.value })}
            type="time"
            value={draft.dueTime}
          />
        </label>
      </div>

      {frequency === "WEEKLY" && (
        <fieldset className={styles.customField}>
          <legend>On these days</legend>
          <div className={styles.weekdays}>
            {WEEKDAYS.map(({ key, label, short }) => {
              const selected = recurrence.weekdays.includes(key)
              return (
                <button
                  aria-label={label}
                  aria-pressed={selected}
                  className={styles.weekday}
                  key={key}
                  onClick={() =>
                    setRecurrence({
                      weekdays: selected
                        ? recurrence.weekdays.filter((day) => day !== key)
                        : [...recurrence.weekdays, key],
                    })
                  }
                  type="button"
                >
                  {short.charAt(0)}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {frequency === "MONTHLY" && (
        <fieldset className={styles.customField}>
          <legend>Monthly on</legend>
          <div className={styles.segmented} style={{ ["--segments" as string]: 3 }}>
            {(
              [
                ["DAY", "Date"],
                ["WEEKDAY", "Weekday"],
                ["LAST_DAY", "Last day"],
              ] as [MonthlyMode, string][]
            ).map(([mode, label]) => (
              <button
                aria-pressed={recurrence.monthlyMode === mode}
                className={styles.segment}
                key={mode}
                onClick={() => setRecurrence({ monthlyMode: mode })}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {recurrence.monthlyMode === "DAY" && (
            <label className={styles.customField}>
              <span>Day of the month</span>
              <select
                className={styles.select}
                onChange={(event) => setRecurrence({ monthDay: Number(event.target.value) })}
                value={recurrence.monthDay}
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              {recurrence.monthDay >= 29 && (
                <p className={styles.hint}>In shorter months this falls on the last day.</p>
              )}
            </label>
          )}
          {recurrence.monthlyMode === "WEEKDAY" && (
            <div className={styles.customGrid}>
              <label className={styles.customField}>
                <span>Which one</span>
                <select
                  className={styles.select}
                  onChange={(event) => setRecurrence({ ordinal: Number(event.target.value) })}
                  value={recurrence.ordinal}
                >
                  {ORDINALS.map((ordinal) => (
                    <option key={ordinal.value} value={ordinal.value}>
                      {ordinal.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.customField}>
                <span>Weekday</span>
                <select
                  className={styles.select}
                  onChange={(event) =>
                    setRecurrence({
                      ordinalWeekday: event.target.value as Recurrence["ordinalWeekday"],
                    })
                  }
                  value={recurrence.ordinalWeekday}
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day.key} value={day.key}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>
      )}

      {frequency === "YEARLY" && (
        <div className={styles.customGrid}>
          <label className={styles.customField}>
            <span>Month</span>
            <select
              className={styles.select}
              onChange={(event) => {
                const yearMonth = Number(event.target.value)
                setRecurrence({
                  yearMonth,
                  yearDay: Math.min(recurrence.yearDay, MONTHS[yearMonth - 1].days),
                })
              }}
              value={recurrence.yearMonth}
            >
              {MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.customField}>
            <span>Day</span>
            <select
              className={styles.select}
              onChange={(event) => setRecurrence({ yearDay: Number(event.target.value) })}
              value={recurrence.yearDay}
            >
              {Array.from(
                { length: MONTHS[recurrence.yearMonth - 1]?.days ?? 31 },
                (_, index) => index + 1,
              ).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className={styles.customField}>
        <span>Starts</span>
        <input
          className={styles.dateInput}
          onChange={(event) => onChange({ ...draft, startsOn: event.target.value })}
          type="date"
          value={draft.startsOn}
        />
      </label>

      <fieldset className={styles.customField}>
        <legend>Ends</legend>
        <div className={styles.segmented} style={{ ["--segments" as string]: 3 }}>
          {(
            [
              ["NEVER", "Never"],
              ["DATE", "On a date"],
              ["COUNT", "After N times"],
            ] as [EndMode, string][]
          ).map(([mode, label]) => (
            <button
              aria-pressed={custom.endMode === mode}
              className={styles.segment}
              key={mode}
              onClick={() => setCustom({ endMode: mode })}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {custom.endMode === "DATE" && (
          <input
            aria-label="End date"
            className={styles.dateInput}
            min={draft.startsOn || undefined}
            onChange={(event) => setCustom({ endsOn: event.target.value })}
            type="date"
            value={custom.endsOn}
          />
        )}
        {custom.endMode === "COUNT" && (
          <Stepper
            canDecrease={custom.count > 1}
            canIncrease={custom.count < MAX_COUNT}
            label="Number of times"
            onDecrease={() => setCustom({ count: custom.count - 1 })}
            onIncrease={() => setCustom({ count: custom.count + 1 })}
            unit={custom.count === 1 ? "time" : "times"}
            value={custom.count}
          />
        )}
      </fieldset>

      {frequency !== "YEARLY" && (
        <div className={styles.customField}>
          <ToggleRow
            checked={custom.seasonal}
            hint={custom.seasonal ? "Only in the months you pick" : "All year"}
            label="Active months"
            onChange={(seasonal) => setCustom({ seasonal })}
          />
          {custom.seasonal && (
            <div aria-label="Active months" className={styles.months} role="group">
              {MONTHS.map((month) => {
                const selected = recurrence.activeMonths.includes(month.value)
                return (
                  <button
                    aria-label={month.label}
                    aria-pressed={selected}
                    className={styles.month}
                    key={month.value}
                    onClick={() =>
                      setRecurrence({
                        activeMonths: selected
                          ? recurrence.activeMonths.filter((value) => value !== month.value)
                          : [...recurrence.activeMonths, month.value],
                      })
                    }
                    type="button"
                  >
                    {month.short}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <p aria-live="polite" className={styles.customSummary} data-testid="custom-summary">
        <Sparkles aria-hidden="true" size={15} />
        <span>
          {summary}
          {draft.dueTime ? ` at ${clockLabel(draft.dueTime)}` : ""}
        </span>
      </p>
    </div>
  )
}
