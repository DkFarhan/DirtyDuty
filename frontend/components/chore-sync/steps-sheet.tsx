"use client"

import { useId, useRef } from "react"
import { createPortal } from "react-dom"
import { Check, ListChecks, X } from "lucide-react"
import type { AssignmentDTO } from "@/lib/household/chores"
import {
  markDoneAnywayText,
  showsWhoTicked,
  tickedByLabel,
  type StepsChipView,
} from "@/lib/household/steps"
import { useDialogFocus } from "./use-dialog-focus"
import sheetStyles from "./occurrence-action-sheet.module.css"
import styles from "./steps-sheet.module.css"

type Theme = "dark" | "light"

/**
 * "2 of 5 steps" on a chore card (E12). On a to-do occurrence it opens the tick sheet; on a done
 * one it quietly shows how much of the checklist was ticked. Colours come from the card's screen
 * (--accent, --main-text, --secondary-text), like the week chip.
 */
export function StepsChip({
  chip,
  title,
  onOpen,
}: {
  chip: StepsChipView | null | undefined
  title: string
  onOpen?: () => void
}) {
  if (!chip) return null
  const content = (
    <>
      {chip.complete ? (
        <Check aria-hidden="true" size={12} strokeWidth={2.6} />
      ) : (
        <ListChecks aria-hidden="true" size={12} strokeWidth={2.4} />
      )}
      <span>{chip.text}</span>
    </>
  )
  if (!chip.interactive || !onOpen) {
    return (
      <p className={styles.chip} data-complete={chip.complete} data-testid="steps-chip">
        {content}
      </p>
    )
  }
  return (
    <button
      aria-haspopup="dialog"
      aria-label={`Steps for ${title}: ${chip.text}`}
      className={styles.chip}
      data-complete={chip.complete}
      data-steps-chip
      data-testid="steps-chip"
      onClick={onOpen}
      type="button"
    >
      {content}
    </button>
  )
}

/** Focus goes back to this chore's steps chip (or its More button) wherever it now shows. */
function returnFocusFor(assignmentId: string) {
  return () =>
    document.querySelector<HTMLElement>(
      [
        `[data-occurrence-card="${assignmentId}"] [data-steps-chip]`,
        `[data-household-job="${assignmentId}"] [data-steps-chip]`,
        `[data-occurrence-card="${assignmentId}"] [data-occurrence-more]`,
      ].join(", "),
    ) ?? document.querySelector<HTMLElement>("main")
}

/**
 * The tick sheet: the chore's title, one row per step (tap to tick or untick; shared by everyone
 * doing it, with who ticked on group chores) and "I did it" at the bottom, which always works.
 */
export function StepsSheet({
  assignment,
  viewerId,
  householdTimezone,
  theme,
  error,
  pendingStepIds,
  completing,
  onTick,
  onComplete,
  onClose,
}: {
  assignment: AssignmentDTO
  viewerId: string
  householdTimezone: string
  theme: Theme
  /** The last tick that failed, shown under its row. */
  error: { stepId: string; message: string } | null
  pendingStepIds: ReadonlySet<string>
  completing?: boolean
  onTick: (stepId: string, ticked: boolean) => void
  onComplete: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const titleId = `${useId()}-title`
  useDialogFocus(dialogRef, true, onClose, returnFocusFor(assignment.id))
  const steps = assignment.steps
  const items = steps?.items ?? []
  const canTick = Boolean(steps?.canTick) && assignment.status === "PENDING"
  const showWho = showsWhoTicked(assignment)
  const canComplete = assignment.status === "PENDING" && assignment.canComplete

  const sheet = (
    <div
      className={`${sheetStyles.backdrop} ${theme === "dark" ? sheetStyles.darkTheme : sheetStyles.lightTheme}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={sheetStyles.sheet}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <span aria-hidden="true" className={sheetStyles.handle} />
        <p className={sheetStyles.eyebrow}>
          {steps ? `${steps.ticked} of ${steps.total} ${steps.total === 1 ? "step" : "steps"}` : ""}
        </p>
        <h2 className={sheetStyles.title} id={titleId}>
          {assignment.title}
        </h2>
        <p className={sheetStyles.subtitle}>
          {canTick
            ? "Tick them off as you go. You can mark it done any time."
            : "Only the people doing this chore can tick its steps."}
        </p>
        <ul aria-label="Steps" className={styles.list}>
          {items.map((item) => {
            const who = showWho ? tickedByLabel(item, viewerId, householdTimezone) : null
            const rowError = error?.stepId === item.id ? error.message : null
            return (
              <li key={item.id}>
                <button
                  aria-busy={pendingStepIds.has(item.id) || undefined}
                  aria-checked={item.ticked}
                  className={styles.row}
                  disabled={!canTick}
                  onClick={() => onTick(item.id, !item.ticked)}
                  role="checkbox"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.box}>
                    {item.ticked && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className={styles.copy}>
                    <span className={styles.text}>{item.text}</span>
                    {who && <span className={styles.who}>{who}</span>}
                  </span>
                </button>
                {rowError && (
                  <p className={styles.rowError} role="alert">
                    {rowError}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        {canComplete && (
          <div className={sheetStyles.actions}>
            <button
              aria-busy={completing || undefined}
              className={sheetStyles.primary}
              disabled={completing}
              onClick={onComplete}
              type="button"
            >
              {completing ? "Completing..." : "I did it"}
            </button>
          </div>
        )}
        <button aria-label="Close" className={sheetStyles.close} onClick={onClose} type="button">
          <X aria-hidden="true" size={20} />
        </button>
      </section>
    </div>
  )
  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body)
}

/** "2 steps not ticked. Mark done anyway?": asked once, only when some steps are unticked. */
export function MarkDoneAnywayDialog({
  unticked,
  theme,
  assignmentId,
  onConfirm,
  onCancel,
}: {
  unticked: number
  theme: Theme
  assignmentId: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const titleId = `${useId()}-title`
  useDialogFocus(dialogRef, true, onCancel, returnFocusFor(assignmentId))
  const dialog = (
    <div
      className={`${sheetStyles.backdrop} ${styles.confirmBackdrop} ${theme === "dark" ? sheetStyles.darkTheme : sheetStyles.lightTheme}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`${sheetStyles.sheet} ${styles.confirm}`}
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <h2 className={styles.confirmTitle} id={titleId}>
          {markDoneAnywayText(unticked)}
        </h2>
        <div className={sheetStyles.actions}>
          <button className={sheetStyles.secondary} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={sheetStyles.primary} onClick={onConfirm} type="button">
            Mark done
          </button>
        </div>
      </section>
    </div>
  )
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body)
}
