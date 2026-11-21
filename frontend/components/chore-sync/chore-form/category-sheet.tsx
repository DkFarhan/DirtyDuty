"use client"

import type { ReactNode } from "react"
import { Ban, Check, Plus } from "lucide-react"
import { categoryIcon, type ChoreCategory } from "@/lib/household/chores"
import { FormSheet, type FormTheme } from "./form-sheet"
import styles from "./chore-form.module.css"

/** The household's categories plus "None"; owners and admins can also start a new one. */
export function CategorySheet({
  categories,
  selectedId,
  canCreate,
  theme,
  onSelect,
  onCreate,
  onClose,
  returnFocusTo,
}: {
  categories: ChoreCategory[]
  selectedId: string | null
  canCreate: boolean
  theme: FormTheme
  onSelect: (categoryId: string | null) => void
  onCreate: () => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const choice = (id: string | null, title: string, icon: ReactNode, hint?: string) => {
    const selected = selectedId === id
    return (
      <li className={styles.optionItem} data-selected={selected} key={id ?? "none"}>
        <button
          aria-pressed={selected}
          className={styles.option}
          onClick={() => onSelect(id)}
          type="button"
        >
          <span aria-hidden="true" className={styles.optionTile}>
            {icon}
          </span>
          <span>
            <span className={styles.optionTitle}>{title}</span>
            {hint && <span className={styles.optionHint}>{hint}</span>}
          </span>
          <span className={styles.optionEnd}>
            <span aria-hidden="true" className={styles.radio}>
              {selected && <Check size={14} strokeWidth={3} />}
            </span>
          </span>
        </button>
      </li>
    )
  }
  return (
    <FormSheet onClose={onClose} returnFocusTo={returnFocusTo} theme={theme} title="Category">
      <ul aria-label="Categories" className={styles.options}>
        {categories.map((category) =>
          choice(category.id, category.name, categoryIcon(category.iconKey)),
        )}
        {choice(null, "None", <Ban size={18} />)}
        {canCreate && (
          <li className={styles.optionItem}>
            <button className={styles.option} onClick={onCreate} type="button">
              <span aria-hidden="true" className={styles.optionTile}>
                <Plus size={18} />
              </span>
              <span>
                <span className={styles.optionTitle}>New category</span>
                <span className={styles.optionHint}>Name it and pick an icon</span>
              </span>
              <span />
            </button>
          </li>
        )}
      </ul>
    </FormSheet>
  )
}
