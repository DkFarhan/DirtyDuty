"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { householdApi, type CreateHouseholdInput, type Household } from "./api"

export type HouseholdStatus = "loading" | "empty" | "has-households" | "error"

type HouseholdContextValue = {
  households: Household[]
  status: HouseholdStatus
  error: string | null
  createdHouseholdInvite: Household | null
  refresh: () => Promise<Household[]>
  create: (input: CreateHouseholdInput) => Promise<Household>
  join: (inviteCode: string) => Promise<void>
  queueCreatedHouseholdInvite: (household: Household | null) => void
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

function messageFor(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "Unable to load your households. Please try again."
}

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const [households, setHouseholds] = useState<Household[]>([])
  const [status, setStatus] = useState<HouseholdStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [createdHouseholdInvite, setCreatedHouseholdInvite] = useState<Household | null>(null)

  const refresh = useCallback(async () => {
    setStatus("loading")
    setError(null)
    try {
      const result = await householdApi.list()
      setHouseholds(result)
      setStatus(result.length === 0 ? "empty" : "has-households")
      setHasLoaded(true)
      return result
    } catch (cause) {
      setError(messageFor(cause))
      setStatus("error")
      setHasLoaded(true)
      throw cause
    }
  }, [])

  useEffect(() => {
    if (isAuthLoading) return
    if (!isAuthenticated) {
      setHouseholds([])
      setError(null)
      setStatus("empty")
      setHasLoaded(false)
      return
    }
    void refresh().catch(() => undefined)
  }, [isAuthenticated, isAuthLoading, refresh])

  const create = useCallback(async (input: CreateHouseholdInput) => {
    const created = await householdApi.create(input)
    await refresh().catch(() => undefined)
    return created
  }, [refresh])

  const join = useCallback(async (inviteCode: string) => {
    await householdApi.join(inviteCode)
    await refresh().catch(() => undefined)
  }, [refresh])

  const queueCreatedHouseholdInvite = useCallback((household: Household | null) => {
    setCreatedHouseholdInvite(household)
  }, [])

  const visibleStatus = isAuthenticated && !hasLoaded ? "loading" : status
  const value = useMemo(
    () => ({
      households,
      status: visibleStatus,
      error,
      createdHouseholdInvite,
      refresh,
      create,
      join,
      queueCreatedHouseholdInvite,
    }),
    [households, visibleStatus, error, createdHouseholdInvite, refresh, create, join, queueCreatedHouseholdInvite],
  )

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHouseholds() {
  const context = useContext(HouseholdContext)
  if (!context) throw new Error("useHouseholds must be used within a HouseholdProvider")
  return context
}
