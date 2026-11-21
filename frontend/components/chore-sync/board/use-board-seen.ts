"use client"

import { useCallback, useEffect, useRef } from "react"
import { boardApi } from "@/lib/board/api"

/** A card counts as seen once at least half of it has been on screen for this long. */
export const SEEN_DWELL_MS = 1_000
/** Ids seen close together go to the server in one request. */
export const SEEN_BATCH_MS = 400

/**
 * Records Seen automatically. Cards register through {@link observe}; a card at least 50% visible
 * for a second is queued, and queued ids are sent together. An id is never sent twice, and posts
 * the viewer has already seen are never observed.
 */
export function useBoardSeen(
  householdId: string | null,
  isSeen: (postId: string) => boolean,
  onSeen: (postIds: string[]) => void,
) {
  const sent = useRef(new Set<string>())
  const queued = useRef(new Set<string>())
  const dwell = useRef(new Map<string, number>())
  const elements = useRef(new Map<string, HTMLElement>())
  const flushTimer = useRef<number | null>(null)
  const observer = useRef<IntersectionObserver | null>(null)
  const latest = useRef({ householdId, isSeen, onSeen })

  useEffect(() => {
    latest.current = { householdId, isSeen, onSeen }
  })

  const flush = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    const { householdId: id, onSeen: done } = latest.current
    const ids = [...queued.current]
    queued.current.clear()
    if (!id || ids.length === 0) return
    ids.forEach((postId) => sent.current.add(postId))
    boardApi
      .seen(id, ids)
      .then(() => done(ids))
      .catch(() => {
        // Let a later sighting try again.
        ids.forEach((postId) => sent.current.delete(postId))
      })
  }, [])

  const queue = useCallback(
    (postIds: string[], immediately = false) => {
      for (const postId of postIds) {
        if (sent.current.has(postId) || latest.current.isSeen(postId)) continue
        queued.current.add(postId)
      }
      if (queued.current.size === 0) return
      if (immediately) {
        flush()
      } else if (flushTimer.current === null) {
        flushTimer.current = window.setTimeout(flush, SEEN_BATCH_MS)
      }
    },
    [flush],
  )

  const stopDwell = useCallback((postId: string) => {
    const timer = dwell.current.get(postId)
    if (timer !== undefined) window.clearTimeout(timer)
    dwell.current.delete(postId)
  }, [])

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const timers = dwell.current
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const postId = (entry.target as HTMLElement).dataset.boardPost
          if (!postId) continue
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (!timers.has(postId)) {
              timers.set(
                postId,
                window.setTimeout(() => {
                  timers.delete(postId)
                  queue([postId])
                }, SEEN_DWELL_MS),
              )
            }
          } else {
            stopDwell(postId)
          }
        }
      },
      { threshold: [0, 0.5] },
    )
    for (const element of elements.current.values()) observer.current.observe(element)
    return () => {
      observer.current?.disconnect()
      observer.current = null
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
      flush()
    }
  }, [flush, queue, stopDwell])

  /** Ref callback for a card: starts or stops watching it. */
  const observe = useCallback(
    (postId: string, element: HTMLElement | null) => {
      const previous = elements.current.get(postId)
      if (previous && previous !== element) {
        observer.current?.unobserve(previous)
        elements.current.delete(postId)
        stopDwell(postId)
      }
      if (!element || previous === element) return
      if (sent.current.has(postId) || latest.current.isSeen(postId)) return
      elements.current.set(postId, element)
      observer.current?.observe(element)
    },
    [stopDwell],
  )

  /** Seen right away (details opened). */
  const markSeen = useCallback((postIds: string[]) => queue(postIds, true), [queue])

  return { observe, markSeen }
}
