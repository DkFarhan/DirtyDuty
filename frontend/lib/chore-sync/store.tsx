"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { AppState, Chore, Member, Screen } from "./types"
import { initialState } from "./mock-data"

const validReturnScreens = new Set<Screen>([
  "dashboard",
  "my-chores",
  "board",
  "household",
  "admin",
  "profile",
  "household-settings",
])

/** Whose away mode the Away mode screen shows: yourself (null) or a member an admin picked. */
export type AwayTarget = { userId: string; displayName: string } | null

/**
 * A chore the Board asks Create a chore to start with: the title, and for an event a one-time date
 * and time. Saving or leaving the form returns to {@link returnTo}.
 */
export type ChoreDraft = {
  title: string
  once?: { date: string; time: string }
  returnTo: Screen
}

/**
 * Central client store + navigation. This is the ONLY place that owns app data
 * and mutations. When the Spring Boot backend is wired up, replace the mock
 * seed and the action bodies here (with fetch/mutation calls) — screens consume
 * the context and never need to change.
 */
interface ChoreSyncContextValue {
  state: AppState
  screen: Screen
  adminTab: "members" | "chores"
  editingChoreId: string | null
  /** The post Board details shows, and where its back button goes. */
  boardPostId: string | null
  boardPostReturn: Screen
  /** The post the Board form edits; null for a new post. */
  editingBoardPostId: string | null
  /** The Board's Posts | Lists tab, kept while moving between screens. */
  boardTab: "posts" | "lists"
  /** A list the Board should open (Home's Shopping row, a "needed today" notification). */
  requestedBoardListId: string | null
  choreDraft: ChoreDraft | null
  /** Whose away mode is open, and where Back goes. */
  awayTarget: AwayTarget
  awayReturn: Screen
  openAwayMode: (target: AwayTarget, returnTo: Screen) => void
  pendingAccountDeletionUserId: string | null
  navigate: (screen: Screen, adminTab?: "members" | "chores") => void
  beginAccountDeletion: (userId: string) => void
  clearAccountDeletion: () => void
  openNotifications: (returnTo: Screen) => void
  returnFromNotifications: () => void
  editChore: (choreId: string) => void
  openBoardPost: (postId: string, returnTo?: Screen) => void
  openBoardPostForm: (postId: string | null) => void
  setBoardTab: (tab: "posts" | "lists") => void
  /** The Board on its Lists tab, on {@link listId} when given. */
  openBoardLists: (listId?: string | null) => void
  startChoreDraft: (draft: ChoreDraft) => void
  clearChoreDraft: () => void
  setCurrentUser: (user: Member) => void
  resetUserData: () => void
  markComplete: (choreId: string) => void
  addChore: (chore: Chore) => void
  removeChore: (choreId: string) => void
}

const ChoreSyncContext = createContext<ChoreSyncContextValue | null>(null)

export function ChoreSyncProvider({
  children,
  initialScreen = "login",
}: {
  children: React.ReactNode
  initialScreen?: Screen
}) {
  const [state, setState] = useState<AppState>(initialState)
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [adminTab, setAdminTab] = useState<"members" | "chores">("chores")
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null)
  const [boardPostId, setBoardPostId] = useState<string | null>(null)
  const [boardPostReturn, setBoardPostReturn] = useState<Screen>("board")
  const [editingBoardPostId, setEditingBoardPostId] = useState<string | null>(null)
  const [boardTab, setBoardTab] = useState<"posts" | "lists">("posts")
  const [requestedBoardListId, setRequestedBoardListId] = useState<string | null>(null)
  const [choreDraft, setChoreDraft] = useState<ChoreDraft | null>(null)
  const [awayTarget, setAwayTarget] = useState<AwayTarget>(null)
  const [awayReturn, setAwayReturn] = useState<Screen>("profile")
  const [notificationReturnScreen, setNotificationReturnScreen] = useState<Screen | null>(null)
  const [pendingAccountDeletionUserId, setPendingAccountDeletionUserId] = useState<string | null>(
    null,
  )

  const navigate = useCallback((next: Screen, nextAdminTab?: "members" | "chores") => {
    if (nextAdminTab) setAdminTab(nextAdminTab)
    setScreen(next)
  }, [])

  const beginAccountDeletion = useCallback((userId: string) => {
    setPendingAccountDeletionUserId(userId)
  }, [])

  const clearAccountDeletion = useCallback(() => {
    setPendingAccountDeletionUserId(null)
  }, [])

  const openNotifications = useCallback((returnTo: Screen) => {
    setNotificationReturnScreen(validReturnScreens.has(returnTo) ? returnTo : null)
    setScreen("notifications")
  }, [])

  const returnFromNotifications = useCallback(() => {
    const target =
      notificationReturnScreen && validReturnScreens.has(notificationReturnScreen)
        ? notificationReturnScreen
        : "dashboard"
    setNotificationReturnScreen(null)
    setScreen(target)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      params.delete("screen")
      params.delete("returnTo")
      const query = params.toString()
      window.history.replaceState(
        {},
        "",
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      )
    }
  }, [notificationReturnScreen])

  const editChore = useCallback((choreId: string) => {
    setEditingChoreId(choreId)
    setChoreDraft(null)
    setScreen("edit-chore")
  }, [])

  const openBoardPost = useCallback((postId: string, returnTo: Screen = "board") => {
    setBoardPostId(postId)
    setBoardPostReturn(returnTo)
    setScreen("board-post")
  }, [])

  const openBoardPostForm = useCallback((postId: string | null) => {
    setEditingBoardPostId(postId)
    setScreen("board-post-form")
  }, [])

  const openBoardLists = useCallback((listId: string | null = null) => {
    setBoardTab("lists")
    setRequestedBoardListId(listId)
    setScreen("board")
  }, [])

  const openAwayMode = useCallback((target: AwayTarget, returnTo: Screen) => {
    setAwayTarget(target)
    setAwayReturn(returnTo)
    setScreen("away-mode")
  }, [])

  const startChoreDraft = useCallback((draft: ChoreDraft) => {
    setChoreDraft(draft)
    setScreen("create-chore")
  }, [])

  const clearChoreDraft = useCallback(() => setChoreDraft(null), [])

  const setCurrentUser = useCallback((user: Member) => {
    setState((s) => ({ ...s, currentUser: user }))
  }, [])

  const resetUserData = useCallback(() => {
    setState(initialState)
    setEditingChoreId(null)
    setBoardPostId(null)
    setEditingBoardPostId(null)
    setBoardTab("posts")
    setRequestedBoardListId(null)
    setChoreDraft(null)
    setAwayTarget(null)
    setPendingAccountDeletionUserId(null)
  }, [])

  const markComplete = useCallback((choreId: string) => {
    setState((s) => ({
      ...s,
      chores: s.chores.map((c) => (c.id === choreId ? { ...c, status: "completed" } : c)),
    }))
  }, [])

  const addChore = useCallback((chore: Chore) => {
    setState((s) => ({ ...s, chores: [...s.chores, chore] }))
  }, [])

  const removeChore = useCallback((choreId: string) => {
    setState((s) => ({ ...s, chores: s.chores.filter((c) => c.id !== choreId) }))
  }, [])

  const value = useMemo(
    () => ({
      state,
      screen,
      adminTab,
      editingChoreId,
      boardPostId,
      boardPostReturn,
      editingBoardPostId,
      boardTab,
      requestedBoardListId,
      choreDraft,
      awayTarget,
      awayReturn,
      openAwayMode,
      pendingAccountDeletionUserId,
      navigate,
      beginAccountDeletion,
      clearAccountDeletion,
      openNotifications,
      returnFromNotifications,
      editChore,
      openBoardPost,
      openBoardPostForm,
      setBoardTab,
      openBoardLists,
      startChoreDraft,
      clearChoreDraft,
      setCurrentUser,
      resetUserData,
      markComplete,
      addChore,
      removeChore,
    }),
    [
      state,
      screen,
      adminTab,
      editingChoreId,
      boardPostId,
      boardPostReturn,
      editingBoardPostId,
      boardTab,
      requestedBoardListId,
      choreDraft,
      awayTarget,
      awayReturn,
      openAwayMode,
      pendingAccountDeletionUserId,
      navigate,
      beginAccountDeletion,
      clearAccountDeletion,
      openNotifications,
      returnFromNotifications,
      editChore,
      openBoardPost,
      openBoardPostForm,
      openBoardLists,
      startChoreDraft,
      clearChoreDraft,
      setCurrentUser,
      resetUserData,
      markComplete,
      addChore,
      removeChore,
    ],
  )

  return <ChoreSyncContext.Provider value={value}>{children}</ChoreSyncContext.Provider>
}

export function useChoreSync() {
  const ctx = useContext(ChoreSyncContext)
  if (!ctx) throw new Error("useChoreSync must be used within a ChoreSyncProvider")
  return ctx
}
