"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { requestApi, requestItem, type ChoreRequestDTO } from "@/lib/household/requests"
import type { RequestsCardFeedback } from "./requests-card"

/**
 * Open hand-off and swap requests for the viewer (E11), reloaded whenever the household's chores
 * change, with Take it / Swap, Decline and Cancel. Every answer refreshes the chores, since accepting
 * changes who does what.
 */
export function useChoreRequests(householdId: string | null, timeZone: string) {
  const resource = householdId
    ? householdChoreResource(householdId)
    : "household:none:chores-and-assignments"
  const { revision, invalidate } = useDataSync(resource)
  const [forMe, setForMe] = useState<ChoreRequestDTO[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<RequestsCardFeedback | null>(null)
  const sequence = useRef(0)

  const load = useCallback(async () => {
    if (!householdId) {
      setForMe([])
      return
    }
    const id = ++sequence.current
    try {
      const list = await requestApi.list(householdId)
      if (id === sequence.current) setForMe(list.forMe)
    } catch {
      // The card simply stays as it was; the chores themselves report load errors.
    }
  }, [householdId])

  useEffect(() => {
    void load()
  }, [load, revision])

  useEffect(() => {
    // Confirmations, and "Already taken by…" once the request has gone, clear themselves.
    if (!feedback || (feedback.tone !== "success" && feedback.requestId !== null)) return
    const timer = window.setTimeout(
      () => setFeedback(null),
      feedback.tone === "success" ? 4000 : 6000,
    )
    return () => window.clearTimeout(timer)
  }, [feedback])

  const answer = useCallback(
    async (requestId: string, kind: "accept" | "decline") => {
      if (!householdId || busyId) return
      const request = forMe.find((item) => item.id === requestId)
      setBusyId(requestId)
      setFeedback(null)
      try {
        if (kind === "accept") {
          await requestApi.accept(householdId, requestId)
          setFeedback({
            requestId: null,
            tone: "success",
            message:
              request?.type === "SWAP"
                ? `Swapped with ${request.requester.displayName}.`
                : `${request?.occurrence.title ?? "It"} is yours now.`,
          })
        } else {
          await requestApi.decline(householdId, requestId)
          setFeedback({
            requestId: null,
            tone: "success",
            message: `Declined. ${request?.requester.displayName ?? "They"} keeps it.`,
          })
        }
        setForMe((current) => current.filter((item) => item.id !== requestId))
        invalidate()
      } catch (cause) {
        const message =
          cause instanceof ApiError
            ? cause.message
            : "Unable to answer this request. Please try again."
        if (cause instanceof ApiError && cause.status === 409) {
          // Taken, closed or changed: the request goes, and the reason stays on the card a moment.
          setForMe((current) => current.filter((item) => item.id !== requestId))
          setFeedback({ requestId: null, tone: "error", message })
          invalidate()
        } else {
          setFeedback({ requestId, tone: "error", message })
        }
      } finally {
        setBusyId(null)
      }
    },
    [busyId, forMe, householdId, invalidate],
  )

  const cancel = useCallback(
    async (requestId: string) => {
      if (!householdId) return null
      try {
        await requestApi.cancel(householdId, requestId)
        invalidate()
        return null
      } catch (cause) {
        invalidate()
        return cause instanceof ApiError ? cause.message : "Unable to cancel this request."
      }
    },
    [householdId, invalidate],
  )

  return {
    items: forMe.map((request) => requestItem(request, timeZone)),
    busyId,
    feedback,
    accept: (requestId: string) => void answer(requestId, "accept"),
    decline: (requestId: string) => void answer(requestId, "decline"),
    cancel,
    reload: load,
    invalidate,
  }
}
