"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { householdApi, type CreateHouseholdInput, type Household } from "./api"

export type HouseholdStatus = "loading" | "empty" | "has-households" | "error"

type HouseholdContextValue = {
  households: Household[]
  activeHousehold: Household | null
  status: HouseholdStatus
  error: string | null
  isRefreshing: boolean
  createdHouseholdInvite: Household | null
  refresh: () => Promise<Household[]>
  selectHousehold: (householdId: string) => void
  updateHousehold: (household: Household) => void
  removeHousehold: (householdId: string) => Household[]
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
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const userId = user?.userId ?? null
  const [households, setHouseholds] = useState<Household[]>([])
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null)
  const [status, setStatus] = useState<HouseholdStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [statusUserId, setStatusUserId] = useState<string | null>(null)
  const householdsRef = useRef<Household[]>([])
  const loadedUserIdRef = useRef<string | null>(null)
  const requestSequence = useRef(0)
  const [createdHouseholdInvite, setCreatedHouseholdInvite] = useState<Household | null>(null)

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current
    const requestUserId = userId
    const hasCurrentData = requestUserId !== null && loadedUserIdRef.current === requestUserId
    setStatusUserId(requestUserId)
    setError(null)
    if (!hasCurrentData) {
      setStatus("loading")
    }
    setIsRefreshing(true)
    try {
      const result = await householdApi.list()
      if (requestId !== requestSequence.current || requestUserId !== userId) return result
      householdsRef.current = result
      setHouseholds(result)
      setSelectedHouseholdId((selectedId) =>
        result.some((household) => household.id === selectedId)
          ? selectedId
          : (result[0]?.id ?? null),
      )
      setStatus(result.length === 0 ? "empty" : "has-households")
      loadedUserIdRef.current = requestUserId
      setLoadedUserId(requestUserId)
      setError(null)
      return result
    } catch (cause) {
      if (requestId === requestSequence.current && requestUserId === userId) {
        setError(messageFor(cause))
        if (!hasCurrentData) setStatus("error")
      }
      throw cause
    } finally {
      if (requestId === requestSequence.current) setIsRefreshing(false)
    }
  }, [userId])

  useEffect(() => {
    if (isAuthLoading) return
    requestSequence.current += 1
    householdsRef.current = []
    loadedUserIdRef.current = null
    setHouseholds([])
    setSelectedHouseholdId(null)
    setLoadedUserId(null)
    setCreatedHouseholdInvite(null)
    setStatusUserId(userId)
    setIsRefreshing(false)
    setError(null)
    if (!isAuthenticated) {
      setStatus("empty")
      return
    }
    setStatus("loading")
    void refresh().catch(() => undefined)
  }, [isAuthenticated, isAuthLoading, refresh, userId])

  const create = useCallback(
    async (input: CreateHouseholdInput) => {
      const created = await householdApi.create(input)
      await refresh().catch(() => undefined)
      return created
    },
    [refresh],
  )

  const join = useCallback(
    async (inviteCode: string) => {
      await householdApi.join(inviteCode)
      await refresh().catch(() => undefined)
    },
    [refresh],
  )

  const queueCreatedHouseholdInvite = useCallback((household: Household | null) => {
    setCreatedHouseholdInvite(household)
  }, [])

  const selectHousehold = useCallback(
    (householdId: string) => {
      if (households.some((household) => household.id === householdId)) {
        setSelectedHouseholdId(householdId)
      }
    },
    [households],
  )

  const updateHousehold = useCallback((updatedHousehold: Household) => {
    const nextHouseholds = householdsRef.current.map((household) =>
      household.id === updatedHousehold.id ? updatedHousehold : household,
    )
    householdsRef.current = nextHouseholds
    setHouseholds(nextHouseholds)
  }, [])

  const removeHousehold = useCallback((householdId: string) => {
    const nextHouseholds = householdsRef.current.filter((household) => household.id !== householdId)
    householdsRef.current = nextHouseholds
    setHouseholds(nextHouseholds)
    setSelectedHouseholdId((selectedId) =>
      selectedId === householdId ? (nextHouseholds[0]?.id ?? null) : selectedId,
    )
    setStatus(nextHouseholds.length === 0 ? "empty" : "has-households")
    setError(null)
    return nextHouseholds
  }, [])

  const visibleHouseholds = isAuthenticated && loadedUserId === userId ? households : []
  const activeHousehold =
    visibleHouseholds.find((household) => household.id === selectedHouseholdId) ??
    visibleHouseholds[0] ??
    null

  const visibleStatus = isAuthenticated && statusUserId !== userId ? "loading" : status
  const value = useMemo(
    () => ({
      households: visibleHouseholds,
      activeHousehold,
      status: visibleStatus,
      error,
      isRefreshing,
      createdHouseholdInvite,
      refresh,
      selectHousehold,
      updateHousehold,
      removeHousehold,
      create,
      join,
      queueCreatedHouseholdInvite,
    }),
    [
      visibleHouseholds,
      activeHousehold,
      visibleStatus,
      error,
      isRefreshing,
      createdHouseholdInvite,
      refresh,
      selectHousehold,
      updateHousehold,
      removeHousehold,
      create,
      join,
      queueCreatedHouseholdInvite,
    ],
  )

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHouseholds() {
  const context = useContext(HouseholdContext)
  if (!context) throw new Error("useHouseholds must be used within a HouseholdProvider")
  return context
}
