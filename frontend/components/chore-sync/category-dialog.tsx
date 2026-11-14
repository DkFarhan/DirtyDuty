"use client"

import { useId, useRef, useState, type FormEvent } from "react"
import { ApiError } from "@/lib/auth/api"
import { CATEGORY_ICON_OPTIONS, pickerKeyFor } from "@/lib/household/category-icons"
import { categoryApi, type ChoreCategory } from "@/lib/household/chores"
import { cn } from "@/lib/utils"
import { useDialogFocus } from "./use-dialog-focus"
import designStyles from "./redesign/household-secondary-design-preview.module.css"

export const MAX_CATEGORY_NAME_LENGTH = 40

type FieldErrors = { name?: string; icon?: string; form?: string }

const NAME_MESSAGES = new Set([
  "Enter a category name.",
  `Category names can be at most ${MAX_CATEGORY_NAME_LENGTH} characters.`,
  "A category with this name already exists.",
])

/** Create a category, or rename it and change its icon. Errors are shown inline. */
export function CategoryDialog({
  householdId,
  category,
  onCancel,
  onSaved,
  getFallbackFocus,
}: {
  householdId: string
  /** The category to edit; omit to create one. */
  category?: ChoreCategory
  onCancel: () => void
  onSaved: (category: ChoreCategory) => void
  getFallbackFocus?: () => HTMLElement | null
}) {
  const editing = Boolean(category)
  const [name, setName] = useState(category?.name ?? "")
  // Keep a legacy key unless the user picks a different icon.
  const [iconKey, setIconKey] = useState<string | null>(category?.iconKey ?? null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const ids = useId()
  const titleId = `${ids}-title`
  const nameId = `${ids}-name`
  const nameErrorId = `${ids}-name-error`
  const iconLabelId = `${ids}-icon-label`
  const iconErrorId = `${ids}-icon-error`
  const selectedPickerKey = iconKey ? pickerKeyFor(iconKey) : null

  useDialogFocus(
    dialogRef,
    true,
    () => {
      if (!saving) onCancel()
    },
    getFallbackFocus,
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const trimmed = name.trim()
    const nextErrors: FieldErrors = {}
    if (!trimmed) nextErrors.name = "Enter a category name."
    else if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
      nextErrors.name = `Category names can be at most ${MAX_CATEGORY_NAME_LENGTH} characters.`
    }
    if (!iconKey) nextErrors.icon = "Choose an icon for this category."
    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.icon || !iconKey) {
      if (nextErrors.name) nameRef.current?.focus()
      else dialogRef.current?.querySelector<HTMLElement>("[data-icon]")?.focus()
      return
    }
    setSaving(true)
    try {
      const request = { name: trimmed, iconKey }
      const saved = category
        ? await categoryApi.update(householdId, category.id, request)
        : await categoryApi.create(householdId, request)
      onSaved(saved)
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? cause.message
          : "Unable to save this category. Please try again."
      if (NAME_MESSAGES.has(message)) {
        setErrors({ name: message })
        nameRef.current?.focus()
      } else if (message === "Choose an icon for this category.") {
        setErrors({ icon: message })
      } else {
        setErrors({ form: message })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 ${designStyles.safeDialogBackdrop}`}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl",
          designStyles.safeDialog,
          designStyles.categoryDialog,
        )}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="font-display text-lg font-black text-slate-900" id={titleId}>
          {editing ? "Edit category" : "New category"}
        </h2>
        <form className="mt-4 space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor={nameId}>
              Name
            </label>
            <input
              aria-describedby={errors.name ? nameErrorId : undefined}
              aria-invalid={Boolean(errors.name)}
              autoComplete="off"
              autoFocus
              className={cn(
                "w-full rounded-xl border bg-white px-3.5 py-3 text-[15px] text-slate-900 outline-none transition focus:ring-2",
                errors.name
                  ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100"
                  : "border-slate-200 focus:border-teal-400 focus:ring-teal-100",
              )}
              id={nameId}
              maxLength={MAX_CATEGORY_NAME_LENGTH}
              onChange={(event) => {
                setName(event.target.value)
                if (errors.name || errors.form)
                  setErrors((current) => ({ ...current, name: undefined, form: undefined }))
              }}
              placeholder="e.g. Pets"
              ref={nameRef}
              value={name}
            />
            {errors.name && (
              <p className="mt-1.5 text-sm font-medium text-rose-600" id={nameErrorId} role="alert">
                {errors.name}
              </p>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700" id={iconLabelId}>
              Icon
            </p>
            <div
              aria-describedby={errors.icon ? iconErrorId : undefined}
              aria-labelledby={iconLabelId}
              className="grid grid-cols-6 gap-1.5"
              role="group"
            >
              {CATEGORY_ICON_OPTIONS.map((option) => {
                const selected = selectedPickerKey === option.key
                return (
                  <button
                    aria-label={option.label}
                    aria-pressed={selected}
                    className={cn(
                      "flex aspect-square min-h-11 w-full items-center justify-center rounded-2xl text-xl transition",
                      selected
                        ? "bg-teal-50 ring-2 ring-teal-500"
                        : "bg-slate-100 hover:bg-slate-200",
                    )}
                    data-icon={option.key}
                    key={option.key}
                    onClick={() => {
                      setIconKey(option.key)
                      if (errors.icon) setErrors((current) => ({ ...current, icon: undefined }))
                    }}
                    type="button"
                  >
                    <span aria-hidden="true">{option.emoji}</span>
                  </button>
                )
              })}
            </div>
            {errors.icon && (
              <p className="mt-1.5 text-sm font-medium text-rose-600" id={iconErrorId} role="alert">
                {errors.icon}
              </p>
            )}
          </div>
          {errors.form && (
            <p
              className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
              role="alert"
            >
              {errors.form}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700"
              disabled={saving}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="min-h-11 flex-1 rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving…" : editing ? "Save category" : "Add category"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
