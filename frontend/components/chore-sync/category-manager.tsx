"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Pencil, Tags, Trash2 } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { categoryIcon } from "@/lib/household/category-icons"
import { categoryApi, type ChoreCategory } from "@/lib/household/chores"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { CategoryDialog } from "./category-dialog"
import { useDialogFocus } from "./use-dialog-focus"
import designStyles from "./redesign/household-secondary-design-preview.module.css"

type Editor = { mode: "create" } | { mode: "edit"; category: ChoreCategory }

function choreCountLabel(count: number) {
  return count === 1 ? "1 chore" : `${count} chores`
}

export function deleteCategoryMessage(category: Pick<ChoreCategory, "name" | "choreCount">) {
  if (category.choreCount === 0) return `No chores use ${category.name}.`
  return category.choreCount === 1
    ? `1 chore uses ${category.name}. It'll keep working without a category.`
    : `${category.choreCount} chores use ${category.name}. They'll keep working without a category.`
}

/** Household Settings section for OWNER/ADMIN: list, add, edit, reorder and delete categories. */
export function CategoryManager({ householdId }: { householdId: string }) {
  const [categories, setCategories] = useState<ChoreCategory[]>([])
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChoreCategory | null>(null)
  const [deleteError, setDeleteError] = useState("")
  const deleteDialogRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const requestSequence = useRef(0)
  const { revision, invalidate } = useDataSync(householdChoreResource(householdId))

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    try {
      const result = await categoryApi.list(householdId)
      if (requestId !== requestSequence.current) return
      setCategories(result)
      setStatus("loaded")
      setError("")
    } catch (cause) {
      if (requestId !== requestSequence.current) return
      setError(cause instanceof ApiError ? cause.message : "Unable to load categories.")
      setStatus((current) => (current === "loaded" ? current : "error"))
    }
  }, [householdId])

  // Reload when chores change elsewhere, so the counts stay current.
  useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load, revision])

  const changed = () => {
    invalidate()
  }

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (busy || target < 0 || target >= categories.length) return
    const previous = categories
    const next = [...categories]
    ;[next[index], next[target]] = [next[target], next[index]]
    const movedId = next[target].id
    setCategories(next)
    setBusy(true)
    setError("")
    try {
      setCategories(
        await categoryApi.reorder(
          householdId,
          next.map((category) => category.id),
        ),
      )
      changed()
    } catch (cause) {
      setCategories(previous)
      setError(cause instanceof ApiError ? cause.message : "Unable to reorder categories.")
    } finally {
      setBusy(false)
      // Keep keyboard focus on the moved row; switch arrows once it reaches an end.
      requestAnimationFrame(() => {
        const row = listRef.current?.querySelector<HTMLElement>(`[data-category-row="${movedId}"]`)
        const same = row?.querySelector<HTMLButtonElement>(
          `[data-move="${direction === -1 ? "up" : "down"}"]`,
        )
        const other = row?.querySelector<HTMLButtonElement>(
          `[data-move="${direction === -1 ? "down" : "up"}"]`,
        )
        ;(same && !same.disabled ? same : other)?.focus()
      })
    }
  }

  const remove = async () => {
    if (!deleteTarget || busy) return
    setBusy(true)
    setDeleteError("")
    try {
      await categoryApi.remove(householdId, deleteTarget.id)
      setCategories((current) => current.filter((category) => category.id !== deleteTarget.id))
      setDeleteTarget(null)
      changed()
    } catch (cause) {
      setDeleteError(cause instanceof ApiError ? cause.message : "Unable to delete this category.")
    } finally {
      setBusy(false)
    }
  }

  useDialogFocus(
    deleteDialogRef,
    deleteTarget !== null,
    () => {
      if (!busy) setDeleteTarget(null)
    },
    () => document.querySelector<HTMLElement>("[data-add-category]"),
  )

  // Dialogs render beside the section, not inside it: the card's backdrop-filter would
  // otherwise become the containing block for their fixed positioning.
  return (
    <>
      <section
        aria-labelledby="household-categories-title"
        className={`${designStyles.settingsCard} ${designStyles.categoryManager}`}
      >
        <div className={designStyles.cardHeading}>
          <div>
            <p className={designStyles.eyebrow}>Chore categories</p>
            <h2 id="household-categories-title">Categories</h2>
          </div>
          <Tags aria-hidden="true" className={designStyles.headingIcon} size={20} />
        </div>

        {status === "loading" && <p className={designStyles.helperText}>Loading categories…</p>}
        {error && (
          <div className={designStyles.statusBanner}>
            <p className="flex-1" role="alert">
              {error}
            </p>
            <button className={designStyles.textButton} onClick={() => void load()} type="button">
              Retry
            </button>
          </div>
        )}
        {status === "loaded" && categories.length === 0 && (
          <p className={designStyles.permissionNote}>No categories yet. Add one to group chores.</p>
        )}
        {status === "loaded" && categories.length > 0 && (
          <ul aria-label="Categories" className={designStyles.categoryList} ref={listRef}>
            {categories.map((category, index) => (
              <li
                className={designStyles.categoryRow}
                data-category-row={category.id}
                key={category.id}
              >
                <span aria-hidden="true" className={designStyles.categoryMark}>
                  {categoryIcon(category.iconKey)}
                </span>
                <span className={designStyles.categoryDetails}>
                  <strong>{category.name}</strong>
                  <small>{choreCountLabel(category.choreCount)}</small>
                </span>
                <span className={designStyles.categoryActions}>
                  <button
                    aria-label={`Move ${category.name} up`}
                    className={designStyles.iconAction}
                    data-move="up"
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                    type="button"
                  >
                    <ChevronUp aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label={`Move ${category.name} down`}
                    className={designStyles.iconAction}
                    data-move="down"
                    disabled={busy || index === categories.length - 1}
                    onClick={() => void move(index, 1)}
                    type="button"
                  >
                    <ChevronDown aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label={`Edit ${category.name}`}
                    className={designStyles.iconAction}
                    data-edit-category={category.id}
                    disabled={busy}
                    onClick={() => setEditor({ mode: "edit", category })}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={17} />
                  </button>
                  <button
                    aria-label={`Delete ${category.name}`}
                    className={`${designStyles.iconAction} ${designStyles.iconActionDanger}`}
                    data-delete-category={category.id}
                    disabled={busy}
                    onClick={() => {
                      setDeleteError("")
                      setDeleteTarget(category)
                    }}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={17} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <button
          className={designStyles.secondaryButton}
          data-add-category
          disabled={busy || status !== "loaded"}
          onClick={() => setEditor({ mode: "create" })}
          type="button"
        >
          Add category
        </button>
        <p className={designStyles.helperText}>
          Categories group chores on Home and My Chores. The order here is the order in the chore
          form.
        </p>
      </section>

      {editor && (
        <CategoryDialog
          category={editor.mode === "edit" ? editor.category : undefined}
          getFallbackFocus={() =>
            editor.mode === "edit"
              ? document.querySelector<HTMLElement>(`[data-edit-category="${editor.category.id}"]`)
              : document.querySelector<HTMLElement>("[data-add-category]")
          }
          householdId={householdId}
          onCancel={() => setEditor(null)}
          onSaved={(saved) => {
            setCategories((current) =>
              current.some((category) => category.id === saved.id)
                ? current.map((category) => (category.id === saved.id ? saved : category))
                : [...current, saved],
            )
            setEditor(null)
            changed()
          }}
        />
      )}

      {deleteTarget && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 ${designStyles.safeDialogBackdrop}`}
          role="presentation"
        >
          <section
            aria-describedby="delete-category-message"
            aria-labelledby="delete-category-title"
            aria-modal="true"
            className={`w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl ${designStyles.safeDialog} ${designStyles.categoryDialog}`}
            ref={deleteDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2
              className="font-display text-lg font-black text-slate-900"
              id="delete-category-title"
            >
              Delete {deleteTarget.name}?
            </h2>
            <p className="mt-2 text-sm text-slate-500" id="delete-category-message">
              {deleteCategoryMessage(deleteTarget)}
            </p>
            {deleteError && (
              <p className="mt-3 text-sm text-rose-600" role="alert">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                disabled={busy}
                onClick={() => void remove()}
                type="button"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
