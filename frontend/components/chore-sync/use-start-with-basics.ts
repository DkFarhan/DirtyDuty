"use client"

import { useCallback, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import type { Screen } from "@/lib/chore-sync/types"
import { basicsRequests } from "@/lib/household/basics"
import { choreApi } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"

/**
 * "Start with the basics" actions for Home and My Chores: "Add these 4" creates the four chores in
 * one request (all or none) and refreshes chores everywhere; "I'll make my own" opens Quick create
 * and comes back to {@link returnTo}.
 */
export function useStartWithBasics(returnTo: Screen) {
  const { state, startChoreDraft } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const { invalidate } = useDataSync(
    household ? householdChoreResource(household.id) : "household:none:chores-and-assignments",
  )
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const canManage = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"
  const viewerId = state.currentUser.id

  const add = useCallback(async () => {
    if (!household || busy.current) return
    busy.current = true
    setAdding(true)
    setError(null)
    try {
      const options = await choreApi.options(household.id)
      const requests = basicsRequests(
        { viewerId, members: options.activeMembers, timezone: household.timezone },
        options.categories,
      )
      await choreApi.createBatch(household.id, requests)
      invalidate()
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Unable to add these chores. Please try again.",
      )
    } finally {
      busy.current = false
      setAdding(false)
    }
  }, [household, invalidate, viewerId])

  const makeOwn = useCallback(
    () => startChoreDraft({ title: "", returnTo }),
    [returnTo, startChoreDraft],
  )

  return { canManage, adding, error, add, makeOwn }
}
