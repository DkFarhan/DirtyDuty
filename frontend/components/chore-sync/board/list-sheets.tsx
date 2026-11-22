"use client"

import { useState, type ReactNode } from "react"
import { Archive, Bell, BellOff, Hand, Pencil, Trash2, Undo2 } from "lucide-react"
import type { BoardList, BoardListItem } from "@/lib/board/api"
import { MAX_ITEM_NAME, MAX_ITEM_NOTE, MAX_LIST_NAME, listNameError } from "@/lib/board/list-view"
import { FormSheet, type FormTheme } from "../chore-form/form-sheet"
import formStyles from "../chore-form/chore-form.module.css"
import postStyles from "./board-post-form.module.css"
import styles from "./board-lists.module.css"

function MenuOption({
  icon,
  title,
  hint,
  danger,
  onClick,
}: {
  icon: ReactNode
  title: string
  hint?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <li className={formStyles.optionItem}>
      <button
        className={`${formStyles.option} ${danger ? styles.dangerOption : ""}`}
        onClick={onClick}
        type="button"
      >
        <span aria-hidden="true" className={formStyles.optionTile}>
          {icon}
        </span>
        <span>
          <span className={formStyles.optionTitle}>{title}</span>
          {hint && <span className={formStyles.optionHint}>{hint}</span>}
        </span>
      </button>
    </li>
  )
}

/** An item's "…" menu: Need it today on or off, claim or release, Edit, Delete. */
export function ItemMenuSheet({
  item,
  viewerId,
  theme,
  onToday,
  onClaim,
  onRelease,
  onEdit,
  onDelete,
  onClose,
  returnFocusTo,
}: {
  item: BoardListItem
  viewerId: string
  theme: FormTheme
  onToday: (on: boolean) => void
  onClaim: () => void
  onRelease: () => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const claimedByOther = item.claimedByUserId !== null && item.claimedByUserId !== viewerId
  return (
    <FormSheet
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      title={item.name}
      titleClassName={postStyles.sheetTitle}
    >
      <ul aria-label={`Actions for ${item.name}`} className={formStyles.options}>
        {item.neededToday ? (
          <MenuOption
            hint="It stops showing as needed today."
            icon={<BellOff size={18} />}
            onClick={() => onToday(false)}
            title="Not needed today"
          />
        ) : (
          <MenuOption
            hint="Everyone else gets one notification."
            icon={<Bell size={18} />}
            onClick={() => onToday(true)}
            title="Need it today"
          />
        )}
        {claimedByOther && (
          <MenuOption
            hint={`Take it over from ${item.claimedByDisplayName ?? "them"}.`}
            icon={<Hand size={18} />}
            onClick={onClaim}
            title="I'll get it instead"
          />
        )}
        {item.claimedByUserId !== null && (
          <MenuOption
            hint="Nobody is getting it."
            icon={<Undo2 size={18} />}
            onClick={onRelease}
            title={claimedByOther ? "Release" : "I'm not getting it"}
          />
        )}
        <MenuOption icon={<Pencil size={18} />} onClick={onEdit} title="Edit" />
        <MenuOption danger icon={<Trash2 size={18} />} onClick={onDelete} title="Delete" />
      </ul>
    </FormSheet>
  )
}

/** Edit an item's name and note (quantity, brand…). */
export function EditItemSheet({
  item,
  theme,
  onSave,
  onClose,
  returnFocusTo,
}: {
  item: BoardListItem
  theme: FormTheme
  onSave: (name: string, note: string | null) => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [name, setName] = useState(item.name)
  const [note, setNote] = useState(item.note ?? "")
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    if (!name.trim()) {
      setError("Enter an item.")
      return
    }
    onSave(name.trim(), note.trim() || null)
  }
  return (
    <FormSheet
      footer={
        <button className={formStyles.sheetPrimary} onClick={save} type="button">
          Save
        </button>
      }
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      title="Edit item"
      titleClassName={postStyles.sheetTitle}
    >
      <div className={styles.sheetFields}>
        <label className={styles.sheetLabel}>
          Item
          <input
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className={styles.sheetInput}
            maxLength={MAX_ITEM_NAME}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") save()
            }}
            value={name}
          />
        </label>
        <label className={styles.sheetLabel}>
          Note or quantity
          <input
            autoComplete="off"
            className={styles.sheetInput}
            maxLength={MAX_ITEM_NOTE}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save()
            }}
            placeholder="2%, 2L"
            value={note}
          />
        </label>
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
      </div>
    </FormSheet>
  )
}

/** Rename or archive a list (not Shopping). Archiving one with open items asks first. */
export function ListOptionsSheet({
  list,
  lists,
  theme,
  onRename,
  onArchive,
  onClose,
  returnFocusTo,
}: {
  list: BoardList
  lists: BoardList[]
  theme: FormTheme
  onRename: (name: string) => Promise<void>
  onArchive: () => Promise<void>
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [panel, setPanel] = useState<"menu" | "rename" | "archive">("menu")
  const [name, setName] = useState(list.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't go through. Please try again.")
    } finally {
      setBusy(false)
    }
  }
  const rename = () => {
    const problem = listNameError(name, lists, list.id)
    if (problem) {
      setError(problem)
      return
    }
    void submit(() => onRename(name))
  }
  const archive = () => {
    if (list.openCount > 0 && panel !== "archive") {
      setPanel("archive")
      return
    }
    void submit(onArchive)
  }

  if (panel === "rename") {
    return (
      <FormSheet
        footer={
          <button
            aria-busy={busy}
            className={formStyles.sheetPrimary}
            disabled={busy}
            onClick={rename}
            type="button"
          >
            Save
          </button>
        }
        onBack={() => setPanel("menu")}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        theme={theme}
        title="Rename list"
        titleClassName={postStyles.sheetTitle}
      >
        <div className={styles.sheetFields}>
          <label className={styles.sheetLabel}>
            Name
            <input
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              className={styles.sheetInput}
              maxLength={MAX_LIST_NAME}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") rename()
              }}
              value={name}
            />
          </label>
          {error && (
            <p className={styles.sheetError} role="alert">
              {error}
            </p>
          )}
        </div>
      </FormSheet>
    )
  }

  if (panel === "archive") {
    const items = list.openCount === 1 ? "1 item" : `${list.openCount} items`
    return (
      <FormSheet
        footer={
          <button
            aria-busy={busy}
            className={`${formStyles.sheetPrimary} ${styles.dangerPrimary}`}
            disabled={busy}
            onClick={archive}
            type="button"
          >
            Archive list
          </button>
        }
        intro={`${list.name} still has ${items} on it. Archiving takes the list and its items off the board for everyone.`}
        onBack={() => setPanel("menu")}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        theme={theme}
        title={`Archive ${list.name}?`}
        titleClassName={postStyles.sheetTitle}
      >
        {error ? (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        ) : null}
      </FormSheet>
    )
  }

  return (
    <FormSheet
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      title={list.name}
      titleClassName={postStyles.sheetTitle}
    >
      <ul aria-label={`Options for ${list.name}`} className={formStyles.options}>
        <MenuOption icon={<Pencil size={18} />} onClick={() => setPanel("rename")} title="Rename" />
        <MenuOption
          danger
          hint="Takes it off the board for everyone."
          icon={<Archive size={18} />}
          onClick={archive}
          title="Archive"
        />
      </ul>
      {error && (
        <p className={styles.sheetError} role="alert">
          {error}
        </p>
      )}
    </FormSheet>
  )
}
