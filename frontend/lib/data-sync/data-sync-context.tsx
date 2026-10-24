"use client"

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react"
import { useAuth } from "@/lib/auth/auth-context"

type ResourceSyncStore = {
  subscribe: (resource: string, listener: () => void) => () => void
  revision: (resource: string) => number
  invalidate: (resource: string) => void
  claim: (resource: string, operation: string) => boolean
  release: (resource: string, operation: string) => void
}

type ResourceSyncValue = {
  store: ResourceSyncStore
}

const ResourceSyncContext = createContext<ResourceSyncValue | null>(null)

function createResourceSyncStore(): ResourceSyncStore {
  const revisions = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()
  const operations = new Set<string>()

  return {
    subscribe(resource, listener) {
      const resourceListeners = listeners.get(resource) ?? new Set()
      resourceListeners.add(listener)
      listeners.set(resource, resourceListeners)
      return () => {
        resourceListeners.delete(listener)
        if (resourceListeners.size === 0) listeners.delete(resource)
      }
    },
    revision(resource) {
      return revisions.get(resource) ?? 0
    },
    invalidate(resource) {
      revisions.set(resource, (revisions.get(resource) ?? 0) + 1)
      listeners.get(resource)?.forEach((listener) => listener())
    },
    claim(resource, operation) {
      const key = `${resource}:${operation}`
      if (operations.has(key)) return false
      operations.add(key)
      return true
    },
    release(resource, operation) {
      operations.delete(`${resource}:${operation}`)
    },
  }
}

const isolatedResourceSyncStore = createResourceSyncStore()

export function DataSyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const store = useMemo(() => createResourceSyncStore(), [user?.userId])
  const value = useMemo(() => ({ store }), [store])
  return <ResourceSyncContext.Provider value={value}>{children}</ResourceSyncContext.Provider>
}

export function useDataSync(resource: string) {
  const context = useContext(ResourceSyncContext)
  const store = context?.store ?? isolatedResourceSyncStore
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(resource, listener),
    [resource, store],
  )
  const getSnapshot = useCallback(() => store.revision(resource), [resource, store])
  const revision = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const invalidate = useCallback(() => store.invalidate(resource), [resource, store])
  const claim = useCallback(
    (operation: string) => store.claim(resource, operation),
    [resource, store],
  )
  const release = useCallback(
    (operation: string) => store.release(resource, operation),
    [resource, store],
  )

  return { revision, invalidate, claim, release }
}

export function householdChoreResource(householdId: string) {
  return `household:${householdId}:chores-and-assignments`
}

export const notificationResource = "notifications"
