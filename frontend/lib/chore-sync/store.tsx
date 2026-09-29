"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { AppState, Chore, Member, Screen } from "./types"
import { initialState } from "./mock-data"

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
  navigate: (screen: Screen, adminTab?: "members" | "chores") => void
  editChore: (choreId: string) => void
  setCurrentUser: (user: Member) => void
  markComplete: (choreId: string) => void
  addChore: (chore: Chore) => void
  removeChore: (choreId: string) => void
}

const ChoreSyncContext = createContext<ChoreSyncContextValue | null>(null)

export function ChoreSyncProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState)
  const [screen, setScreen] = useState<Screen>("login")
  const [adminTab, setAdminTab] = useState<"members" | "chores">("members")
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null)

  const navigate = useCallback((next: Screen, nextAdminTab?: "members" | "chores") => {
    if (nextAdminTab) setAdminTab(nextAdminTab)
    setScreen(next)
  }, [])

  const editChore = useCallback((choreId: string) => {
    setEditingChoreId(choreId)
    setScreen("edit-chore")
  }, [])

  const setCurrentUser = useCallback((user: Member) => {
    setState((s) => ({ ...s, currentUser: user }))
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
    () => ({ state, screen, adminTab, editingChoreId, navigate, editChore, setCurrentUser, markComplete, addChore, removeChore }),
    [state, screen, adminTab, editingChoreId, navigate, editChore, setCurrentUser, markComplete, addChore, removeChore],
  )

  return <ChoreSyncContext.Provider value={value}>{children}</ChoreSyncContext.Provider>
}

export function useChoreSync() {
  const ctx = useContext(ChoreSyncContext)
  if (!ctx) throw new Error("useChoreSync must be used within a ChoreSyncProvider")
  return ctx
}
