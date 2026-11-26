"use client"

import { useRef, useState } from "react"
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react"
import {
  MAX_STEP_LENGTH,
  MAX_STEPS,
  addStep,
  clearSuggestedSteps,
  moveStep,
  removeStep,
  renameStep,
  type QuickValues,
} from "@/lib/household/chore-quick-form"
import styles from "./steps-editor.module.css"

/** Grows a step's text box to fit its (wrapped) text. */
function fitHeight(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = "auto"
  element.style.height = `${element.scrollHeight}px`
}

/**
 * "Steps (optional)" in More options (E12): a short checklist guide inside the chore. Steps can be
 * renamed in place, removed, moved with the arrows or dragged by the handle, and added with the
 * field at the bottom. Steps filled in from a built-in suggestion are marked "Suggested".
 */
export function StepsEditor({
  values,
  onChange,
}: {
  values: QuickValues
  onChange: (next: QuickValues) => void
}) {
  const [draft, setDraft] = useState("")
  const [dragKey, setDragKey] = useState<string | null>(null)
  const addRef = useRef<HTMLInputElement | null>(null)
  const steps = values.steps
  const full = steps.length >= MAX_STEPS
  const hasSuggested = steps.some((step) => step.suggested)

  const add = () => {
    const next = addStep(values, draft)
    if (next === values) return
    onChange(next)
    setDraft("")
    addRef.current?.focus()
  }

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <p className={styles.title} id="chore-steps">
          Steps <span>(optional)</span>
          {hasSuggested && <span className={styles.suggestedTag}>Suggested</span>}
        </p>
        {hasSuggested && (
          <button
            className={styles.textButton}
            onClick={() => onChange(clearSuggestedSteps(values))}
            type="button"
          >
            Remove suggested
          </button>
        )}
      </div>
      <p className={styles.hint}>
        A quick guide for whoever does it. Ticking them is never required.
      </p>
      {steps.length > 0 && (
        <ol aria-label="Steps" className={styles.list}>
          {steps.map((step, index) => (
            <li
              className={styles.item}
              data-dragging={dragKey === step.key || undefined}
              data-suggested={step.suggested || undefined}
              key={step.key}
              onDragEnter={(event) => {
                if (!dragKey || dragKey === step.key) return
                event.preventDefault()
                onChange(moveStep(values, dragKey, index))
              }}
              onDragOver={(event) => {
                if (dragKey) event.preventDefault()
              }}
            >
              <span
                aria-hidden="true"
                className={styles.grip}
                draggable
                onDragEnd={() => setDragKey(null)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData("text/plain", step.key)
                  setDragKey(step.key)
                }}
              >
                <GripVertical size={16} />
              </span>
              <span className={styles.number}>{index + 1}</span>
              <span className={styles.field}>
                {/* Wraps instead of scrolling, so a whole step stays readable on a phone. */}
                <textarea
                  aria-label={`Step ${index + 1}`}
                  className={`${styles.input} ${styles.stepText}`}
                  maxLength={MAX_STEP_LENGTH}
                  onChange={(event) => onChange(renameStep(values, step.key, event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault()
                  }}
                  ref={fitHeight}
                  rows={1}
                  value={step.text}
                />
                {step.suggested && <span className={styles.srOnly}>Suggested</span>}
              </span>
              <button
                aria-label={`Move step ${index + 1} up`}
                className={styles.iconButton}
                disabled={index === 0}
                onClick={() => onChange(moveStep(values, step.key, index - 1))}
                type="button"
              >
                <ChevronUp aria-hidden="true" size={18} />
              </button>
              <button
                aria-label={`Move step ${index + 1} down`}
                className={styles.iconButton}
                disabled={index === steps.length - 1}
                onClick={() => onChange(moveStep(values, step.key, index + 1))}
                type="button"
              >
                <ChevronDown aria-hidden="true" size={18} />
              </button>
              <button
                aria-label={`Remove step ${index + 1}: ${step.text}`}
                className={styles.iconButton}
                onClick={() => onChange(removeStep(values, step.key))}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {full ? (
        <p className={styles.hint}>That&apos;s the most steps a chore can have ({MAX_STEPS}).</p>
      ) : (
        <div className={styles.addRow}>
          <input
            aria-label="New step"
            className={styles.input}
            maxLength={MAX_STEP_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                add()
              }
            }}
            placeholder={steps.length === 0 ? "e.g. Wipe the counters" : "Add another step"}
            ref={addRef}
            value={draft}
          />
          <button
            className={styles.addButton}
            disabled={draft.trim() === ""}
            onClick={add}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            Add
          </button>
        </div>
      )}
    </div>
  )
}
