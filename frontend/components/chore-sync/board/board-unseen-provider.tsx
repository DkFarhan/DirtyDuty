"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@/lib/auth/auth-context"
import { boardApi } from "@/lib/board/api"
import { householdBoardResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { useHouseholds } from "@/lib/household/household-context"
import { BoardUnseenContext } from "../bottom-nav"

const REFRESH_MS = 120_000

/**
 * Keeps the Board tab's dot current: unseen active posts in the active household. Refreshes when
 * the board changes in this app, when the window regains focus, and every two minutes.
 */
export function BoardUnseenProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const { activeHousehold } = useHouseholds()
  const householdId = isAuthenticated ? (activeHousehold?.id ?? null) : null
  const { revision } = useDataSync(
    householdId ? householdBoardResource(householdId) : "household:none:board",
  )
  const [state, setState] = useState<{ householdId: string; unseen: boolean } | null>(null)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    const load = () => {
      boardApi
        .unseen(householdId)
        .then((result) => {
          if (!cancelled) setState({ householdId, unseen: result.unseenCount > 0 })
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener("focus", load)
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      window.removeEventListener("focus", load)
      window.clearInterval(timer)
    }
  }, [householdId, revision])

  const unseen = state !== null && state.householdId === householdId && state.unseen
  return <BoardUnseenContext.Provider value={unseen}>{children}</BoardUnseenContext.Provider>
}
