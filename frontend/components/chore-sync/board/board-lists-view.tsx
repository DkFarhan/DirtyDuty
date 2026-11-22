"use client"

import { useMemo, useRef, useState } from "react"
import { Bell, Check, ChevronDown, Ellipsis, List, Plus, ShoppingCart, X } from "lucide-react"
import type { BoardList, BoardListItem } from "@/lib/board/api"
import { itemSuggestions } from "@/lib/board/item-suggestions"
import { initialOf } from "@/lib/board/board-view"
import {
  LIST_QUICK_PICKS,
  MAX_ITEM_NAME,
  MAX_LIST_NAME,
  MAX_LISTS,
  boughtSummary,
  claimLabel,
  listNameError,
} from "@/lib/board/list-view"
import type { FormTheme } from "../chore-form/form-sheet"
import { EditItemSheet, ItemMenuSheet, ListOptionsSheet } from "./list-sheets"
import type { BoardListsState } from "./use-board-lists"
import styles from "./board-lists.module.css"

function ListIcon({ list, size }: { list: BoardList; size: number }) {
  return list.defaultList ? (
    <ShoppingCart aria-hidden="true" size={size} />
  ) : (
    <List aria-hidden="true" size={size} />
  )
}

/** B11: name, quick picks, Create list. */
function NewListCard({
  lists,
  onCreate,
  onClose,
}: {
  lists: BoardList[]
  onCreate: (name: string) => Promise<unknown>
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const full = lists.length >= MAX_LISTS
  const create = async () => {
    const problem = full
      ? `You can have at most ${MAX_LISTS} lists. Archive one to make room.`
      : listNameError(name, lists)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await onCreate(name)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't go through. Please try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="board-new-list" className={`${styles.card} ${styles.newList}`}>
      <div className={styles.newListHead}>
        <h2 id="board-new-list">New list</h2>
        <button
          aria-label="Close new list"
          className={styles.iconButton}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <label className={styles.fieldLabel} htmlFor="board-new-list-name">
        Name
      </label>
      <input
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        autoFocus
        className={styles.nameField}
        id="board-new-list-name"
        maxLength={MAX_LIST_NAME}
        onChange={(event) => {
          setName(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void create()
          if (event.key === "Escape") onClose()
        }}
        placeholder="Party Saturday"
        value={name}
      />
      <p className={styles.fieldLabel} id="board-quick-picks">
        Quick picks
      </p>
      <div aria-labelledby="board-quick-picks" className={styles.quickPicks} role="group">
        {LIST_QUICK_PICKS.map((pick) => (
          <button
            aria-pressed={name.trim() === pick}
            className={styles.quickPick}
            key={pick}
            onClick={() => {
              setName(pick)
              setError(null)
            }}
            type="button"
          >
            {pick}
          </button>
        ))}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.newListNote}>Everyone can add to and tick off any list.</p>
      <button
        aria-busy={busy}
        className={styles.createButton}
        disabled={busy}
        onClick={() => void create()}
        type="button"
      >
        Create list
      </button>
    </section>
  )
}

function ItemRow({
  item,
  viewerId,
  busy,
  highlighted,
  error,
  onBuy,
  onClaim,
  onMore,
}: {
  item: BoardListItem
  viewerId: string
  busy: boolean
  highlighted: boolean
  error: string | null
  onBuy: () => void
  onClaim: () => void
  onMore: (button: HTMLElement) => void
}) {
  const claim = claimLabel(item, viewerId)
  return (
    <li className={styles.item} data-highlight={highlighted || undefined} data-list-item={item.id}>
      <div className={styles.itemRow}>
        <button
          aria-busy={busy}
          aria-label={`Mark bought: ${item.name}`}
          className={styles.checkbox}
          disabled={busy}
          onClick={onBuy}
          type="button"
        />
        <div className={styles.itemCopy}>
          <div className={styles.itemNameRow}>
            <span className={styles.itemName}>{item.name}</span>
            {item.neededToday && (
              <span className={styles.todayChip}>
                <Bell aria-hidden="true" size={13} strokeWidth={2.2} />
                Today
              </span>
            )}
          </div>
          {item.note && <span className={styles.itemNote}>{item.note}</span>}
        </div>
        {claim ? (
          <span className={styles.getting}>
            <span aria-hidden="true" className={styles.avatar}>
              {initialOf(item.claimedByDisplayName ?? "?")}
            </span>
            {claim}
          </span>
        ) : (
          <button
            aria-busy={busy}
            aria-label={`I'll get it: ${item.name}`}
            className={styles.claimButton}
            disabled={busy}
            onClick={onClaim}
            type="button"
          >
            I&apos;ll get it
          </button>
        )}
        <button
          aria-haspopup="dialog"
          aria-label={`More actions for ${item.name}`}
          className={styles.more}
          data-item-more
          onClick={(event) => onMore(event.currentTarget)}
          type="button"
        >
          <Ellipsis aria-hidden="true" size={18} />
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

/** The Board's Lists tab (B2): the switcher, the add field, the selected list and bought today. */
export function BoardListsView({
  state,
  theme,
  viewerId,
}: {
  state: BoardListsState
  theme: FormTheme
  viewerId: string
}) {
  const [typed, setTyped] = useState("")
  const [newListOpen, setNewListOpen] = useState(false)
  const [menuItemId, setMenuItemId] = useState<string | null>(null)
  const [editItemId, setEditItemId] = useState<string | null>(null)
  const [listOptions, setListOptions] = useState(false)
  const [boughtOpen, setBoughtOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { lists, selected, items, boughtToday } = state

  const suggestions = useMemo(
    () =>
      itemSuggestions(
        typed,
        state.recent,
        (items ?? []).map((item) => item.name),
      ),
    [items, state.recent, typed],
  )
  const allItems = [...(items ?? []), ...boughtToday]
  const menuItem = allItems.find((item) => item.id === menuItemId) ?? null
  const editItem = allItems.find((item) => item.id === editItemId) ?? null
  const bought = boughtSummary(boughtToday)

  const add = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setTyped("")
    const added = await state.addItem({ name: trimmed, note: null })
    if (!added) setTyped(trimmed)
    inputRef.current?.focus()
  }

  if (state.status === "loading" && !lists) {
    return (
      <div aria-label="Loading lists" className={styles.stack}>
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    )
  }
  if (!lists) {
    return (
      <div className={`${styles.card} ${styles.errorCard}`}>
        <p role="alert">{state.error ?? "Lists are unavailable right now. Please try again."}</p>
        <button className={styles.linkButton} onClick={state.retry} type="button">
          Try again
        </button>
      </div>
    )
  }

  const switcher = (
    <div aria-label="Lists" className={styles.switcher} role="group">
      {lists.map((list) => {
        const isSelected = !newListOpen && list.id === selected?.id
        return (
          <span className={styles.chipWrap} key={list.id}>
            <button
              aria-pressed={isSelected}
              className={styles.listChip}
              onClick={() => {
                setNewListOpen(false)
                setTyped("")
                setBoughtOpen(false)
                state.select(list.id)
              }}
              type="button"
            >
              <ListIcon list={list} size={15} />
              <span>{list.name}</span>
              <span className={styles.chipCount}>{list.openCount}</span>
            </button>
            {isSelected && !list.defaultList && (
              <button
                aria-haspopup="dialog"
                aria-label={`Options for ${list.name}`}
                className={styles.chipMore}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget
                  setListOptions(true)
                }}
                type="button"
              >
                <Ellipsis aria-hidden="true" size={16} />
              </button>
            )}
          </span>
        )
      })}
      {!newListOpen && (
        <button className={styles.newListChip} onClick={() => setNewListOpen(true)} type="button">
          <Plus aria-hidden="true" size={14} />
          List
        </button>
      )}
    </div>
  )

  return (
    <div className={styles.stack}>
      {newListOpen ? (
        <>
          <NewListCard
            lists={lists}
            onClose={() => setNewListOpen(false)}
            onCreate={state.createList}
          />
          {switcher}
        </>
      ) : (
        <>
          {switcher}

          {selected && (
            <div className={`${styles.card} ${styles.addCard}`}>
              <form
                className={styles.addField}
                onSubmit={(event) => {
                  event.preventDefault()
                  void add(typed)
                }}
              >
                <input
                  aria-label={`Add to ${selected.name}`}
                  autoComplete="off"
                  className={styles.addInput}
                  enterKeyHint="done"
                  maxLength={MAX_ITEM_NAME}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={`Add to ${selected.name}…`}
                  ref={inputRef}
                  value={typed}
                />
                <button
                  aria-label="Add item"
                  className={styles.addButton}
                  disabled={!typed.trim()}
                  type="submit"
                >
                  <Plus aria-hidden="true" size={18} strokeWidth={2.4} />
                </button>
              </form>
              {suggestions.length > 0 && (
                <ul aria-label="Suggestions" className={styles.suggestions}>
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.name}>
                      <button
                        aria-label={`Add ${suggestion.name}`}
                        className={styles.suggestion}
                        onClick={() => void add(suggestion.name)}
                        type="button"
                      >
                        <Plus aria-hidden="true" size={13} strokeWidth={2.4} />
                        <span>
                          {suggestion.before}
                          <strong>{suggestion.match}</strong>
                          {suggestion.after}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {state.feedback && state.feedback.itemId === null && (
                <p className={styles.error} role="alert">
                  {state.feedback.message}
                </p>
              )}
            </div>
          )}

          {state.undo && (
            <div aria-live="polite" className={styles.undoBar} role="status">
              <Check aria-hidden="true" size={15} strokeWidth={2.4} />
              <span>{state.undo.name} bought</span>
              <button
                className={styles.undoButton}
                onClick={() => void state.undoBuy()}
                type="button"
              >
                Undo
              </button>
            </div>
          )}

          {selected && items && items.length > 0 && (
            <ul aria-label={`${selected.name} items`} className={`${styles.card} ${styles.items}`}>
              {items.map((item) => (
                <ItemRow
                  busy={state.busyIds.includes(item.id)}
                  error={state.feedback?.itemId === item.id ? state.feedback.message : null}
                  highlighted={state.highlightId === item.id}
                  item={item}
                  key={item.id}
                  onBuy={() => void state.buy(item.id)}
                  onClaim={() => void state.claim(item.id)}
                  onMore={(button) => {
                    returnFocus.current = button
                    setMenuItemId(item.id)
                  }}
                  viewerId={viewerId}
                />
              ))}
            </ul>
          )}

          {selected && items && items.length === 0 && (
            <div className={`${styles.card} ${styles.emptyCard}`}>
              <p>
                Nothing on {selected.name}
                {boughtToday.length > 0 ? " right now." : " yet."}
              </p>
              <span>Add what the house needs; anyone can tick it off.</span>
            </div>
          )}

          {bought && (
            <div className={styles.bought}>
              <button
                aria-expanded={boughtOpen}
                className={styles.boughtToggle}
                onClick={() => setBoughtOpen((open) => !open)}
                type="button"
              >
                <Check aria-hidden="true" size={15} strokeWidth={2.2} />
                <span>{bought}</span>
                <ChevronDown aria-hidden="true" data-open={boughtOpen || undefined} size={15} />
              </button>
              {boughtOpen && (
                <ul aria-label="Bought today" className={styles.boughtList}>
                  {boughtToday.map((item) => (
                    <li key={item.id}>
                      <span className={styles.boughtName}>{item.name}</span>
                      <span className={styles.boughtBy}>
                        {item.boughtByUserId === viewerId ? "You" : item.boughtByDisplayName}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {menuItem && (
        <ItemMenuSheet
          item={menuItem}
          onClaim={() => {
            setMenuItemId(null)
            void state.claim(menuItem.id)
          }}
          onClose={() => setMenuItemId(null)}
          onDelete={() => {
            setMenuItemId(null)
            void state.deleteItem(menuItem.id)
          }}
          onEdit={() => {
            setMenuItemId(null)
            setEditItemId(menuItem.id)
          }}
          onRelease={() => {
            setMenuItemId(null)
            void state.release(menuItem.id)
          }}
          onToday={(on) => {
            setMenuItemId(null)
            void state.neededToday(menuItem.id, on)
          }}
          returnFocusTo={() => returnFocus.current}
          theme={theme}
          viewerId={viewerId}
        />
      )}
      {editItem && (
        <EditItemSheet
          item={editItem}
          onClose={() => setEditItemId(null)}
          onSave={(name, note) => {
            setEditItemId(null)
            void state.editItem(editItem.id, { name, note })
          }}
          returnFocusTo={() => returnFocus.current}
          theme={theme}
        />
      )}
      {listOptions && selected && !selected.defaultList && (
        <ListOptionsSheet
          list={selected}
          lists={lists}
          onArchive={() => state.archiveList(selected.id)}
          onClose={() => setListOptions(false)}
          onRename={(name) => state.renameList(selected.id, name)}
          returnFocusTo={() => returnFocus.current}
          theme={theme}
        />
      )}
    </div>
  )
}
