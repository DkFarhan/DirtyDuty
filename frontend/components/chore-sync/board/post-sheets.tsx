"use client"

import { useState, type ReactNode } from "react"
import {
  BellOff,
  CalendarDays,
  Check,
  Megaphone,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react"
import type { BoardMember, BoardPostType, NotifyMode } from "@/lib/board/api"
import { todayIn } from "@/lib/household/chore-quick-form"
import { TYPE_LABELS } from "@/lib/board/post-suggestions"
import type { PostFormValues } from "@/lib/board/post-form"
import { FormSheet, ToggleRow, type FormTheme } from "../chore-form/form-sheet"
import formStyles from "../chore-form/chore-form.module.css"
import styles from "./board-post-form.module.css"

export const TYPE_ICONS: Record<BoardPostType, (size: number) => ReactNode> = {
  EVENT: (size) => <CalendarDays size={size} />,
  PROBLEM: (size) => <Wrench size={size} />,
  HEADS_UP: (size) => <Megaphone size={size} />,
}

const TYPE_HINTS: Record<BoardPostType, string> = {
  EVENT: "Something on a date, with reminders",
  PROBLEM: "Stays on top until someone fixes it",
  HEADS_UP: "Good to know, on the board for 7 days",
}

function Option({
  selected,
  icon,
  title,
  hint,
  onClick,
  role = "radio",
}: {
  selected: boolean
  icon: ReactNode
  title: string
  hint: string
  onClick: () => void
  role?: "radio"
}) {
  return (
    <li className={formStyles.optionItem} data-selected={selected}>
      <button
        aria-checked={selected}
        className={formStyles.option}
        onClick={onClick}
        role={role}
        type="button"
      >
        <span aria-hidden="true" className={formStyles.optionTile}>
          {icon}
        </span>
        <span>
          <span className={formStyles.optionTitle}>{title}</span>
          <span className={formStyles.optionHint}>{hint}</span>
        </span>
        <span className={formStyles.optionEnd}>
          <span aria-hidden="true" className={formStyles.radio}>
            {selected && <Check size={14} strokeWidth={3} />}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Event, Problem or Heads-up, before the name card shows the segmented control. */
export function TypeSheet({
  value,
  theme,
  onChoose,
  onClose,
  returnFocusTo,
}: {
  value: BoardPostType | null
  theme: FormTheme
  onChoose: (type: BoardPostType) => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  return (
    <FormSheet
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      titleClassName={styles.sheetTitle}
      title="What kind of post?"
    >
      <ul aria-label="Post type" className={formStyles.options} role="radiogroup">
        {(["EVENT", "PROBLEM", "HEADS_UP"] as const).map((type) => (
          <Option
            hint={TYPE_HINTS[type]}
            icon={TYPE_ICONS[type](18)}
            key={type}
            onClick={() => onChoose(type)}
            selected={value === type}
            title={TYPE_LABELS[type]}
          />
        ))}
      </ul>
    </FormSheet>
  )
}

/** An event's date and optional time range (all day when off). */
export function WhenSheet({
  values,
  timeZone,
  theme,
  onChange,
  onClose,
  returnFocusTo,
}: {
  values: Pick<PostFormValues, "eventDate" | "startTime" | "endTime">
  timeZone: string
  theme: FormTheme
  onChange: (patch: Pick<PostFormValues, "eventDate" | "startTime" | "endTime">) => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const today = todayIn(timeZone)
  const [date, setDate] = useState(values.eventDate || today)
  const [allDay, setAllDay] = useState(!values.startTime)
  const [start, setStart] = useState(values.startTime || "10:00")
  const [end, setEnd] = useState(values.endTime)
  const [error, setError] = useState<string | null>(null)

  const done = () => {
    if (!date) return setError("Choose a date.")
    if (!allDay && end && end <= start)
      return setError("The end time must be after the start time.")
    onChange({
      eventDate: date,
      startTime: allDay ? "" : start,
      endTime: allDay ? "" : end,
    })
    onClose()
  }

  return (
    <FormSheet
      footer={
        <button className={formStyles.sheetPrimary} onClick={done} type="button">
          Done
        </button>
      }
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      titleClassName={styles.sheetTitle}
      title="When is it?"
    >
      <div className={styles.whenFields}>
        <label className={styles.whenField}>
          <span className={formStyles.panelLabel}>Date</span>
          <input
            className={formStyles.dateInput}
            min={today}
            onChange={(event) => {
              setDate(event.target.value)
              setError(null)
            }}
            type="date"
            value={date}
          />
        </label>
        <ToggleRow
          checked={allDay}
          hint="No particular time"
          label="All day"
          onChange={setAllDay}
        />
        {!allDay && (
          <div className={styles.timeRow}>
            <label className={styles.whenField}>
              <span className={formStyles.panelLabel}>From</span>
              <input
                className={formStyles.timeInput}
                onChange={(event) => {
                  setStart(event.target.value)
                  setError(null)
                }}
                type="time"
                value={start}
              />
            </label>
            <label className={styles.whenField}>
              <span className={formStyles.panelLabel}>Until (optional)</span>
              <input
                className={formStyles.timeInput}
                onChange={(event) => {
                  setEnd(event.target.value)
                  setError(null)
                }}
                type="time"
                value={end}
              />
            </label>
          </div>
        )}
      </div>
      {error && (
        <p className={formStyles.sheetError} role="alert">
          {error}
        </p>
      )}
    </FormSheet>
  )
}

/** "Who gets a notification?" (Figma B10): Everyone, Pick people (at least one) or No one. */
export function NotifySheet({
  mode,
  recipients,
  members,
  theme,
  onChange,
  onClose,
  returnFocusTo,
}: {
  mode: NotifyMode
  recipients: string[]
  /** Everyone who could be notified: the household without the author. */
  members: BoardMember[]
  theme: FormTheme
  onChange: (mode: NotifyMode, recipients: string[]) => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [nextMode, setNextMode] = useState(mode)
  const [picked, setPicked] = useState(recipients)
  const [error, setError] = useState<string | null>(null)
  const people = members.length

  const done = () => {
    if (nextMode === "PICKED" && picked.length === 0) {
      setError("Pick at least one person.")
      return
    }
    onChange(nextMode, nextMode === "PICKED" ? picked : [])
    onClose()
  }

  return (
    <FormSheet
      footer={
        <>
          <p className={styles.sheetFootnote}>
            Everyone in the house can always see the post on the board.
          </p>
          <button className={formStyles.sheetPrimary} onClick={done} type="button">
            Done
          </button>
        </>
      }
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      titleClassName={styles.sheetTitle}
      title="Who gets a notification?"
    >
      <ul aria-label="Who gets a notification" className={formStyles.options} role="radiogroup">
        <Option
          hint={
            people === 1
              ? "The other person in the house gets a notification"
              : `All ${people} people get a notification`
          }
          icon={<UsersRound size={18} />}
          onClick={() => {
            setNextMode("EVERYONE")
            setError(null)
          }}
          selected={nextMode === "EVERYONE"}
          title="Everyone"
        />
        <Option
          hint="Only the people you choose"
          icon={<UserRound size={18} />}
          onClick={() => setNextMode("PICKED")}
          selected={nextMode === "PICKED"}
          title="Pick people"
        />
        {nextMode === "PICKED" && (
          <li className={styles.pickList}>
            <div aria-label="People to notify" role="group">
              {members.map((member) => {
                const checked = picked.includes(member.userId)
                return (
                  <div
                    className={formStyles.memberRow}
                    key={member.userId}
                    style={{ gridTemplateColumns: "1fr" }}
                  >
                    <button
                      aria-checked={checked}
                      className={formStyles.memberToggle}
                      onClick={() => {
                        setError(null)
                        setPicked((current) =>
                          checked
                            ? current.filter((id) => id !== member.userId)
                            : [...current, member.userId],
                        )
                      }}
                      role="checkbox"
                      type="button"
                    >
                      <span aria-hidden="true" className={styles.pickAvatar}>
                        {member.displayName.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <span className={styles.pickName}>{member.displayName}</span>
                      <span aria-hidden="true" className={formStyles.checkbox}>
                        {checked && <Check size={14} strokeWidth={3} />}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </li>
        )}
        <Option
          hint="Posts quietly. It just appears on the board."
          icon={<BellOff size={18} />}
          onClick={() => {
            setNextMode("NONE")
            setError(null)
          }}
          selected={nextMode === "NONE"}
          title="No one"
        />
      </ul>
      {error && (
        <p className={formStyles.sheetError} role="alert">
          {error}
        </p>
      )}
    </FormSheet>
  )
}
