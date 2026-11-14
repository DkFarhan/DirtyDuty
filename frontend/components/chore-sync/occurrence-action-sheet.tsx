"use client"

import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CalendarClock, Check, Ellipsis, RotateCcw, SkipForward, UsersRound, X } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import {
  dayLabel,
  localTime,
  movedFromLabel,
  type OccurrenceAction,
} from "@/lib/household/occurrence-actions"
import { useDialogFocus } from "./use-dialog-focus"
import styles from "./occurrence-action-sheet.module.css"

type Theme = "dark" | "light"
type Panel = "menu" | "move" | "skip" | "reassign"

/**
 * The quiet "More" icon button in a chore card's top-right corner; opens the occurrence action
 * sheet. Its colours come from the card's screen: --more-text and --more-accent.
 */
export function OccurrenceMoreButton({
  title,
  className,
  onClick,
}: {
  title: string
  className?: string
  onClick: () => void
}) {
  return (
    <button
      aria-haspopup="dialog"
      aria-label={`More actions for ${title}`}
      className={`${styles.moreButton} ${className ?? ""}`}
      data-occurrence-more
      onClick={onClick}
      type="button"
    >
      <Ellipsis aria-hidden="true" size={20} />
    </button>
  )
}

/**
 * Move, skip, undo a skip, or reassign one chore occurrence. Only the actions the server allows
 * this viewer are listed. Choosing one hands it to {@link onSubmit}, which applies it optimistically.
 */
export function OccurrenceActionSheet({
  assignment,
  householdId,
  householdTimezone,
  theme,
  viewerId,
  onClose,
  onSubmit,
}: {
  assignment: AssignmentDTO
  householdId: string
  householdTimezone: string
  theme: Theme
  /** The signed-in user, shown as "You". */
  viewerId?: string
  onClose: () => void
  onSubmit: (action: OccurrenceAction) => void
}) {
  const actions = assignment.actions
  const [panel, setPanel] = useState<Panel>("menu")
  const [date, setDate] = useState(() => clampDate(assignment.scheduledFor, actions))
  const currentTime = localTime(assignment.dueAt, householdTimezone)
  const [time, setTime] = useState(currentTime ?? "")
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<{ userId: string; displayName: string }[] | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>(() =>
    assignment.assignees.map((assignee) => assignee.userId),
  )
  const dialogRef = useRef<HTMLElement | null>(null)
  const ids = useId()
  const titleId = `${ids}-title`
  const maxPeople = Math.max(1, actions?.maxAssignees ?? 1)

  // Focus returns to this chore's "More" button, wherever the chore now shows. If it left the
  // list (skipped, or given to someone else), focus goes to the screen's main region instead.
  useDialogFocus(dialogRef, true, onClose, () => {
    const more = document.querySelector<HTMLElement>(
      `[data-occurrence-card="${assignment.id}"] [data-occurrence-more]`,
    )
    if (more) return more
    const main = document.querySelector<HTMLElement>("main")
    if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1")
    return main
  })

  // Each panel starts with focus on its first control; while the member list loads, focus stays
  // on the dialog itself and moves to the first member once it appears.
  const membersLoaded = members !== null
  useEffect(() => {
    if (panel === "menu") return
    const start = dialogRef.current?.querySelector<HTMLElement>("[data-panel-start]")
    ;(start ?? dialogRef.current)?.focus()
  }, [panel, membersLoaded])

  useEffect(() => {
    if (panel !== "reassign" || members) return
    let cancelled = false
    choreApi
      .options(householdId)
      .then((options) => {
        if (!cancelled) setMembers(options.activeMembers)
      })
      .catch((cause) => {
        if (!cancelled) {
          setMembersError(
            cause instanceof ApiError ? cause.message : "Unable to load household members.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [householdId, members, panel])

  if (!actions) return null
  const names = assignment.assignees
    .map((assignee) => (assignee.userId === viewerId ? "You" : assignee.displayName))
    .join(" and ")
  const turnOwner =
    assignment.assignees.length === 1 && assignment.assignees[0].userId === viewerId
      ? "your"
      : names
        ? `${names}'s`
        : "this"
  const moved = movedFromLabel(assignment)

  const submitMove = () => {
    if (!date) {
      setError("Choose a day.")
      return
    }
    if (actions.moveEarliest && date < actions.moveEarliest) {
      setError(`Choose ${dayLabel(actions.moveEarliest)} or later.`)
      return
    }
    if (actions.moveLatest && date > actions.moveLatest) {
      setError(`Choose ${dayLabel(actions.moveLatest)} or earlier.`)
      return
    }
    onSubmit({
      kind: "move",
      date,
      time: time && time !== currentTime ? time : null,
    })
  }

  const toggleMember = (userId: string) => {
    setError(null)
    setSelected((current) => {
      if (maxPeople === 1) return [userId]
      if (current.includes(userId)) return current.filter((id) => id !== userId)
      if (current.length >= maxPeople) return current
      return [...current, userId]
    })
  }

  const submitReassign = () => {
    if (selected.length === 0) {
      setError("Choose at least one person.")
      return
    }
    const chosen = (members ?? [])
      .filter((member) => selected.includes(member.userId))
      .map((member) => ({ userId: member.userId, displayName: member.displayName }))
    onSubmit({ kind: "reassign", assignees: chosen })
  }

  const sheet = (
    <div
      className={`${styles.backdrop} ${theme === "dark" ? styles.darkTheme : styles.lightTheme}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.sheet}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <span aria-hidden="true" className={styles.handle} />
        <p className={styles.eyebrow}>{dayLabel(assignment.scheduledFor)}</p>
        <h2 className={styles.title} id={titleId}>
          {assignment.title}
        </h2>
        <p className={styles.subtitle}>
          {assignment.status === "SKIPPED"
            ? "Skipped"
            : names
              ? `Assigned to ${names}`
              : "No one is assigned"}
          {moved ? `. ${moved}` : ""}
        </p>

        {panel === "menu" && (
          <ul className={styles.menu}>
            {actions.canMove && (
              <li>
                <button className={styles.menuItem} onClick={() => setPanel("move")} type="button">
                  <CalendarClock aria-hidden="true" size={20} />
                  Move to another day
                </button>
              </li>
            )}
            {actions.canReassign && (
              <li>
                <button
                  className={styles.menuItem}
                  onClick={() => setPanel("reassign")}
                  type="button"
                >
                  <UsersRound aria-hidden="true" size={20} />
                  Reassign this day
                </button>
              </li>
            )}
            {actions.canSkip && (
              <li>
                <button
                  className={`${styles.menuItem} ${styles.dangerItem}`}
                  onClick={() => setPanel("skip")}
                  type="button"
                >
                  <SkipForward aria-hidden="true" size={20} />
                  Skip this day
                </button>
              </li>
            )}
            {actions.canUnskip && (
              <li>
                <button
                  className={styles.menuItem}
                  onClick={() => onSubmit({ kind: "unskip" })}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={20} />
                  Undo skip
                </button>
              </li>
            )}
          </ul>
        )}

        {panel === "move" && (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              submitMove()
            }}
          >
            <label className={styles.field}>
              Day
              <input
                data-panel-start
                max={actions.moveLatest ?? undefined}
                min={actions.moveEarliest ?? undefined}
                onChange={(event) => {
                  setDate(event.target.value)
                  setError(null)
                }}
                required
                type="date"
                value={date}
              />
            </label>
            {actions.moveLatest && (
              <p className={styles.hint}>
                You can choose {dayLabel(actions.moveEarliest ?? assignment.scheduledFor)} to{" "}
                {dayLabel(actions.moveLatest)}.
              </p>
            )}
            {currentTime && (
              <label className={styles.field}>
                Due time
                <input onChange={(event) => setTime(event.target.value)} type="time" value={time} />
              </label>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => back()} type="button">
                Back
              </button>
              <button className={styles.primary} type="submit">
                Move
              </button>
            </div>
          </form>
        )}

        {panel === "skip" && (
          <div>
            <p className={styles.subtitle}>
              Skip {assignment.title} on {dayLabel(assignment.scheduledFor)}? It still counts as{" "}
              {turnOwner} turn. You can undo it until that day has passed.
            </p>
            <div className={styles.actions}>
              <button className={styles.secondary} data-panel-start onClick={back} type="button">
                Back
              </button>
              <button
                className={styles.danger}
                onClick={() => onSubmit({ kind: "skip" })}
                type="button"
              >
                Skip this day
              </button>
            </div>
          </div>
        )}

        {panel === "reassign" && (
          <div>
            <p className={styles.hint}>
              {maxPeople === 1
                ? "Choose who does it on this day."
                : `Choose up to ${maxPeople} people for this day.`}
            </p>
            {membersError && (
              <p className={styles.error} role="alert">
                {membersError}
              </p>
            )}
            {!members && !membersError && <p className={styles.hint}>Loading members…</p>}
            {members && (
              <div
                aria-label="Household members"
                className={styles.members}
                role={maxPeople === 1 ? "radiogroup" : "group"}
              >
                {members.map((member, index) => {
                  const checked = selected.includes(member.userId)
                  const limitReached = maxPeople > 1 && !checked && selected.length >= maxPeople
                  return (
                    <button
                      aria-checked={maxPeople === 1 ? checked : undefined}
                      aria-disabled={limitReached || undefined}
                      aria-pressed={maxPeople === 1 ? undefined : checked}
                      className={styles.member}
                      data-panel-start={index === 0 ? true : undefined}
                      key={member.userId}
                      onClick={() => toggleMember(member.userId)}
                      role={maxPeople === 1 ? "radio" : undefined}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`${styles.memberMark} ${maxPeople === 1 ? styles.radioMark : ""}`}
                      >
                        {checked && <Check size={14} />}
                      </span>
                      {member.displayName}
                    </button>
                  )
                })}
              </div>
            )}
            {maxPeople > 1 && members && (
              <p className={styles.hint} aria-live="polite">
                {selected.length} of {maxPeople} chosen
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={back} type="button">
                Back
              </button>
              <button
                className={styles.primary}
                disabled={!members}
                onClick={submitReassign}
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        )}
        {/* Last in the DOM so focus starts on the first action; it is positioned top right. */}
        <button aria-label="Close" className={styles.close} onClick={onClose} type="button">
          <X aria-hidden="true" size={20} />
        </button>
      </section>
    </div>
  )

  function back() {
    setError(null)
    setPanel("menu")
    requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>(`.${styles.menuItem}`)?.focus(),
    )
  }

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body)
}

function clampDate(date: string, actions: AssignmentDTO["actions"]) {
  if (!actions) return date
  if (actions.moveEarliest && date < actions.moveEarliest) return actions.moveEarliest
  if (actions.moveLatest && date > actions.moveLatest) return actions.moveLatest
  return date
}
