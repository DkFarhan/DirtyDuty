"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import {
  boardListApi,
  type BoardList,
  type BoardListItem,
  type BoardListItemInput,
} from "@/lib/board/api"
import {
  chooseList,
  rememberListId,
  rememberedListId,
  sortOpenItems,
  withItemCounts,
} from "@/lib/board/list-view"

/** How long "Undo" stays next to an item that was just marked bought. */
export const UNDO_MS = 5000
/** How long an item that was added again stays highlighted. */
export const HIGHLIGHT_MS = 2400

export type ItemFeedback = { itemId: string | null; message: string }

type Detail = { listId: string; items: BoardListItem[]; boughtToday: BoardListItem[] }

const failure = (cause: unknown, fallback = "That didn't go through. Please try again.") =>
  cause instanceof ApiError ? cause.message : fallback

/**
 * The Board's Lists tab: the active lists, the selected one's items, and household names for
 * suggestions. Every change is sent to the server; buying shows at once with an Undo, and the
 * board (To buy, Home's Shopping row) is refreshed after each change through {@link onChanged}.
 */
export function useBoardLists(
  householdId: string | null,
  options: { active: boolean; requestedListId: string | null; onChanged: () => void },
) {
  const { active, requestedListId, onChanged } = options
  const [lists, setLists] = useState<BoardList[] | null>(null)
  const [status, setStatus] = useState<"loading" | "error" | "loaded">("loading")
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<ItemFeedback | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [undo, setUndo] = useState<BoardListItem | null>(null)
  const [attempt, setAttempt] = useState(0)
  const undoTimer = useRef<number | null>(null)
  const highlightTimer = useRef<number | null>(null)
  const changed = useRef(onChanged)
  useEffect(() => {
    changed.current = onChanged
  }, [onChanged])

  // The lists (creating Shopping on first use) and the household's names for suggestions.
  useEffect(() => {
    if (!householdId || !active) return
    let cancelled = false
    Promise.all([boardListApi.lists(householdId), boardListApi.recentNames(householdId)])
      .then(([loaded, names]) => {
        if (cancelled) return
        setLists(loaded.lists)
        setRecent(names)
        setSelectedId(
          (current) =>
            chooseList(loaded.lists, requestedListId ?? current, rememberedListId(householdId))
              ?.id ?? null,
        )
        setStatus("loaded")
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(failure(cause, "Lists are unavailable right now. Please try again."))
        setStatus((current) => (current === "loaded" ? current : "error"))
      })
    return () => {
      cancelled = true
    }
  }, [active, attempt, householdId, requestedListId])

  // The selected list's items.
  useEffect(() => {
    if (!householdId || !active || !selectedId) return
    let cancelled = false
    boardListApi
      .items(householdId, selectedId)
      .then((loaded) => {
        if (cancelled) return
        setDetail({ listId: selectedId, items: loaded.items, boughtToday: loaded.boughtToday })
        setLists(
          (current) =>
            current?.map((list) => (list.id === loaded.list.id ? loaded.list : list)) ?? current,
        )
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        if (cause instanceof ApiError && cause.status === 404) {
          // Archived by someone else: back to the lists.
          setAttempt((value) => value + 1)
          return
        }
        setFeedback({ itemId: null, message: failure(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [active, householdId, selectedId])

  useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
    },
    [],
  )

  const select = useCallback(
    (listId: string) => {
      if (!householdId) return
      rememberListId(householdId, listId)
      setSelectedId(listId)
      setFeedback(null)
      setUndo(null)
    },
    [householdId],
  )

  /** Puts one item in place (open, bought today, or gone when null) and updates the counts. */
  const place = useCallback((before: BoardListItem | null, after: BoardListItem | null) => {
    const id = after?.id ?? before?.id
    setDetail((current) => {
      if (!current) return current
      const open = current.items.filter((item) => item.id !== id && item.id !== before?.id)
      const bought = current.boughtToday.filter((item) => item.id !== id && item.id !== before?.id)
      if (after && !after.boughtAt) open.push(after)
      if (after?.boughtAt) bought.unshift(after)
      return { ...current, items: sortOpenItems(open), boughtToday: bought }
    })
    const listId = after?.listId ?? before?.listId
    setLists(
      (current) =>
        current?.map((list) => (list.id === listId ? withItemCounts(list, before, after) : list)) ??
        current,
    )
  }, [])

  const find = useCallback(
    (itemId: string) =>
      detail?.items.find((item) => item.id === itemId) ??
      detail?.boughtToday.find((item) => item.id === itemId) ??
      null,
    [detail],
  )

  const run = useCallback(
    async (itemId: string, action: () => Promise<BoardListItem | null>) => {
      if (!householdId || busyIds.includes(itemId)) return
      const before = find(itemId)
      setBusyIds((ids) => [...ids, itemId])
      setFeedback((current) => (current?.itemId === itemId ? null : current))
      try {
        const after = await action()
        place(before, after)
        changed.current()
      } catch (cause) {
        setFeedback({ itemId, message: failure(cause) })
        if (cause instanceof ApiError && cause.status === 404) place(before, null)
      } finally {
        setBusyIds((ids) => ids.filter((id) => id !== itemId))
      }
    },
    [busyIds, find, householdId, place],
  )

  const highlight = useCallback((itemId: string) => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
    setHighlightId(itemId)
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
  }, [])

  /** Adds an item; a name already open on the list highlights that item instead. */
  const addItem = useCallback(
    async (input: BoardListItemInput) => {
      if (!householdId || !selectedId) return false
      setFeedback(null)
      try {
        const result = await boardListApi.add(householdId, selectedId, input)
        if (result.existing) {
          highlight(result.item.id)
        } else {
          place(null, result.item)
          setRecent((names) => [
            result.item.name,
            ...names.filter(
              (name) => name.toLocaleLowerCase() !== result.item.name.toLocaleLowerCase(),
            ),
          ])
          changed.current()
        }
        return true
      } catch (cause) {
        setFeedback({ itemId: null, message: failure(cause) })
        return false
      }
    },
    [highlight, householdId, place, selectedId],
  )

  /** Marks it bought at once, with Undo for {@link UNDO_MS}. */
  const buy = useCallback(
    async (itemId: string) => {
      const before = find(itemId)
      if (!householdId || !before || before.boughtAt || busyIds.includes(itemId)) return
      const optimistic: BoardListItem = {
        ...before,
        boughtAt: new Date().toISOString(),
        neededToday: false,
      }
      place(before, optimistic)
      setUndo(optimistic)
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
      setBusyIds((ids) => [...ids, itemId])
      try {
        const confirmed = await boardListApi.buy(householdId, itemId)
        place(optimistic, confirmed)
        setUndo((current) => (current?.id === itemId ? confirmed : current))
        changed.current()
      } catch (cause) {
        place(optimistic, before)
        setUndo((current) => (current?.id === itemId ? null : current))
        setFeedback({ itemId, message: failure(cause) })
      } finally {
        setBusyIds((ids) => ids.filter((id) => id !== itemId))
      }
    },
    [busyIds, find, householdId, place],
  )

  const undoBuy = useCallback(async () => {
    const item = undo
    if (!householdId || !item) return
    setUndo(null)
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    await run(item.id, async () => {
      const restored = await boardListApi.unbuy(householdId, item.id)
      // Undo of a name added again meanwhile keeps the open one and removes the bought copy.
      if (restored.id !== item.id) place(item, null)
      return restored
    })
  }, [householdId, place, run, undo])

  const createList = useCallback(
    async (name: string) => {
      if (!householdId) return null
      const created = await boardListApi.create(householdId, name.trim())
      setLists((current) => [...(current ?? []), created])
      select(created.id)
      return created
    },
    [householdId, select],
  )

  const renameList = useCallback(
    async (listId: string, name: string) => {
      if (!householdId) return
      const renamed = await boardListApi.rename(householdId, listId, name.trim())
      setLists((current) => current?.map((list) => (list.id === listId ? renamed : list)) ?? null)
    },
    [householdId],
  )

  const archiveList = useCallback(
    async (listId: string) => {
      if (!householdId) return
      await boardListApi.archive(householdId, listId)
      const remaining = (lists ?? []).filter((list) => list.id !== listId)
      setLists(remaining)
      const next = chooseList(remaining, null, null)
      if (next) select(next.id)
      changed.current()
    },
    [householdId, lists, select],
  )

  const id = householdId ?? ""
  return {
    lists,
    status,
    error,
    selectedId,
    selected: lists?.find((list) => list.id === selectedId) ?? null,
    items: detail?.listId === selectedId ? detail.items : null,
    boughtToday: detail?.listId === selectedId ? detail.boughtToday : [],
    recent,
    busyIds,
    feedback,
    highlightId,
    undo,
    retry: () => setAttempt((value) => value + 1),
    select,
    addItem,
    buy,
    undoBuy,
    claim: (itemId: string) => run(itemId, () => boardListApi.claim(id, itemId)),
    release: (itemId: string) => run(itemId, () => boardListApi.release(id, itemId)),
    neededToday: (itemId: string, on: boolean) =>
      run(itemId, () => boardListApi.neededToday(id, itemId, on)),
    editItem: (itemId: string, input: BoardListItemInput) =>
      run(itemId, () => boardListApi.update(id, itemId, input)),
    deleteItem: (itemId: string) =>
      run(itemId, async () => {
        await boardListApi.remove(id, itemId)
        return null
      }),
    createList,
    renameList,
    archiveList,
    clearFeedback: () => setFeedback(null),
  }
}

export type BoardListsState = ReturnType<typeof useBoardLists>
