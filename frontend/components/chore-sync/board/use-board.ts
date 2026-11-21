"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { boardApi, type Board, type BoardPost } from "@/lib/board/api"
import { householdBoardResource, useDataSync } from "@/lib/data-sync/data-sync-context"

type Loaded = { householdId: string; board: Board | null; error: string | null }

/**
 * The active household's board. It reloads whenever the board resource is invalidated (by any
 * screen) and keeps showing what it has while it does.
 */
export function useBoard(householdId: string | null) {
  const resource = householdId ? householdBoardResource(householdId) : "household:none:board"
  const { revision, invalidate } = useDataSync(resource)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    boardApi
      .board(householdId)
      .then((board) => {
        if (!cancelled) setLoaded({ householdId, board, error: null })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const error =
          cause instanceof ApiError
            ? cause.message
            : "The board is unavailable right now. Please try again."
        setLoaded((current) =>
          current?.householdId === householdId && current.board
            ? current
            : { householdId, board: null, error },
        )
      })
    return () => {
      cancelled = true
    }
  }, [attempt, householdId, revision])

  const mine = loaded?.householdId === householdId ? loaded : null
  const status: "loading" | "error" | "loaded" = mine?.board
    ? "loaded"
    : mine?.error
      ? "error"
      : "loading"

  /** Puts a post the server returned in place (or adds it). */
  const replacePost = useCallback((post: BoardPost) => {
    setLoaded((current) => {
      if (!current?.board) return current
      const posts = current.board.posts.some((candidate) => candidate.id === post.id)
        ? current.board.posts.map((candidate) => (candidate.id === post.id ? post : candidate))
        : [post, ...current.board.posts]
      return {
        ...current,
        board: { ...current.board, posts: posts.filter((candidate) => candidate.pastAt === null) },
      }
    })
  }, [])

  /** Marks posts seen locally after the server recorded it. */
  const markSeenLocally = useCallback((postIds: string[]) => {
    setLoaded((current) => {
      if (!current?.board) return current
      let newlySeen = 0
      const posts = current.board.posts.map((post) => {
        if (!postIds.includes(post.id) || post.viewer.seen) return post
        newlySeen++
        return { ...post, viewer: { ...post.viewer, seen: true } }
      })
      return {
        ...current,
        board: {
          ...current.board,
          posts,
          unseenCount: Math.max(0, current.board.unseenCount - newlySeen),
        },
      }
    })
  }, [])

  return {
    board: mine?.board ?? null,
    status,
    error: mine?.error ?? null,
    retry: () => setAttempt((value) => value + 1),
    invalidate,
    replacePost,
    markSeenLocally,
  }
}
