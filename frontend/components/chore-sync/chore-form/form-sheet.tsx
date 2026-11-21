"use client"

import { useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, Minus, Plus, X } from "lucide-react"
import { useDialogFocus } from "../use-dialog-focus"
import sheetStyles from "../occurrence-action-sheet.module.css"
import styles from "./chore-form.module.css"

export type FormTheme = "dark" | "light"

/**
 * A bottom sheet over the chore form (a centred dialog on wide screens), built on the occurrence
 * action sheet's look. The close button calls {@link onClose}; in a sub-view the back chevron and
 * Escape call {@link onBack}.
 */
export function FormSheet({
  title,
  intro,
  theme,
  onClose,
  onBack,
  footer,
  children,
  returnFocusTo,
  titleClassName,
}: {
  title: string
  intro?: ReactNode
  theme: FormTheme
  onClose: () => void
  onBack?: () => void
  footer?: ReactNode
  children: ReactNode
  /** The control focus returns to when the sheet closes. */
  returnFocusTo?: () => HTMLElement | null
  /** Extra class for the title, e.g. the Board's smaller sheet titles. */
  titleClassName?: string
}) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const titleId = `${useId()}-title`
  useDialogFocus(dialogRef, true, onBack ?? onClose, returnFocusTo)

  const sheet = (
    <div
      className={`${sheetStyles.backdrop} ${theme === "dark" ? sheetStyles.darkTheme : sheetStyles.lightTheme}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`${sheetStyles.sheet} ${styles.sheetBody}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <span aria-hidden="true" className={sheetStyles.handle} />
        <div className={styles.sheetHeader}>
          {onBack && (
            <button aria-label="Back" className={styles.roundButton} onClick={onBack} type="button">
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
          )}
          <h2
            className={
              titleClassName ? `${styles.sheetTitle} ${titleClassName}` : styles.sheetTitle
            }
            id={titleId}
          >
            {title}
          </h2>
          <button aria-label="Close" className={styles.roundButton} onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {intro && <p className={styles.sheetIntro}>{intro}</p>}
        {children}
        {footer && <div className={styles.sheetFooter}>{footer}</div>}
      </section>
    </div>
  )
  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body)
}

/** A − value + control; the only number entry on the form. */
export function Stepper({
  label,
  value,
  display,
  unit,
  onDecrease,
  onIncrease,
  canDecrease,
  canIncrease,
}: {
  /** Names the control for screen readers, e.g. "Days between". */
  label: string
  value: number | null
  display?: string
  unit?: string
  onDecrease: () => void
  onIncrease: () => void
  canDecrease: boolean
  canIncrease: boolean
}) {
  return (
    <div aria-label={label} className={styles.stepper} role="group">
      <button
        aria-label={`Less (${label})`}
        className={styles.stepperButton}
        disabled={!canDecrease}
        onClick={onDecrease}
        type="button"
      >
        <Minus aria-hidden="true" size={16} />
      </button>
      <output aria-live="polite" className={styles.stepperValue}>
        {display ?? value}
        {unit && <small>{unit}</small>}
      </output>
      <button
        aria-label={`More (${label})`}
        className={styles.stepperButton}
        disabled={!canIncrease}
        onClick={onIncrease}
        type="button"
      >
        <Plus aria-hidden="true" size={16} />
      </button>
    </div>
  )
}

/** An on/off row: role="switch" on the whole row so the label is part of the tap target. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      aria-checked={checked}
      className={styles.toggleRow}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span aria-hidden="true" className={styles.switch} />
    </button>
  )
}

const AVATAR_COLOURS = ["#3f9c8f", "#8a63c7", "#c98a3a", "#c4566b", "#3d7cc4", "#5f8f3a"]

export function Avatar({ name, index }: { name: string; index: number }) {
  return (
    <span
      aria-hidden="true"
      className={styles.avatar}
      style={{ background: AVATAR_COLOURS[index % AVATAR_COLOURS.length] }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}
