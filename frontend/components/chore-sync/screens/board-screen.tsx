"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { boardApi, type BoardPost } from "@/lib/board/api"
import { groupBoard } from "@/lib/board/board-view"
import { choreDueForEvent } from "@/lib/board/post-form"
import { useChoreSync } from "@/lib/chore-sync/store"
import { CONFIRMATION_MS, type CardFeedbackView } from "@/lib/household/card-feedback"
import { useHouseholds } from "@/lib/household/household-context"
import { BoardListsView } from "../board/board-lists-view"
import { BoardScreenView, type BoardTheme } from "../board/board-screen-view"
import { useBoard } from "../board/use-board"
import { useBoardLists } from "../board/use-board-lists"
import { useBoardSeen } from "../board/use-board-seen"

type Feedback = { postId: string; view: CardFeedbackView }

/** The Board tab: posts (Seen, Got it, Mark fixed) and the shared lists. */
export function BoardScreen({ theme }: { theme: BoardTheme }) {
  const {
    state: appState,
    navigate,
    openBoardPost,
    openBoardPostForm,
    startChoreDraft,
    boardTab = "posts",
    setBoardTab,
    requestedBoardListId = null,
  } = useChoreSync()
  const { activeHousehold } = useHouseholds()
  const householdId = activeHousehold?.id ?? null
  const timeZone = activeHousehold?.timezone ?? "UTC"
  const { board, status, error, retry, invalidate, replacePost, markSeenLocally } =
    useBoard(householdId)
  const listsState = useBoardLists(householdId, {
    active: boardTab === "lists",
    requestedListId: requestedBoardListId,
    // To buy and Home's Shopping row come with the board.
    onChanged: invalidate,
  })
  const toBuyCount = listsState.lists
    ? listsState.lists.reduce((total, list) => total + list.openCount, 0)
    : (board?.toBuyCount ?? null)
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const feedbackTimer = useRef<number | null>(null)

  const posts = useMemo(() => board?.posts ?? [], [board])
  const groups = useMemo(() => groupBoard(posts), [posts])
  const seenIds = useMemo(
    () => new Set(posts.filter((post) => post.viewer.seen).map((post) => post.id)),
    [posts],
  )
  const { observe } = useBoardSeen(
    householdId,
    useCallback((postId: string) => seenIds.has(postId), [seenIds]),
    useCallback(
      (postIds: string[]) => {
        markSeenLocally(postIds)
        // The Board tab's dot and Home's section follow.
        invalidate()
      },
      [invalidate, markSeenLocally],
    ),
  )

  useEffect(
    () => () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    },
    [],
  )

  const show = (postId: string, message: string, tone: "error" | "success") => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    setFeedback({ postId, view: { message, tone } })
    if (tone === "success") {
      feedbackTimer.current = window.setTimeout(() => setFeedback(null), CONFIRMATION_MS)
    }
  }

  const run = async (postId: string, action: () => Promise<BoardPost>, success: string | null) => {
    if (!householdId || busyIds.includes(postId)) return
    setBusyIds((ids) => [...ids, postId])
    setFeedback((current) => (current?.postId === postId ? null : current))
    try {
      const next = await action()
      replacePost(next)
      if (success) show(postId, success, "success")
      invalidate()
    } catch (cause) {
      show(
        postId,
        cause instanceof ApiError ? cause.message : "That didn't go through. Please try again.",
        "error",
      )
      if (cause instanceof ApiError && cause.status === 409) invalidate()
    } finally {
      setBusyIds((ids) => ids.filter((id) => id !== postId))
    }
  }

  const makeChore = (postId: string) => {
    const post = posts.find((candidate) => candidate.id === postId)
    if (!post) return
    startChoreDraft({
      title: post.title,
      once:
        post.type === "EVENT" && post.eventDate
          ? choreDueForEvent(post.eventDate, timeZone)
          : undefined,
      returnTo: "board",
    })
  }

  return (
    <BoardScreenView
      busyIds={busyIds}
      errorMessage={error}
      feedback={feedback}
      groups={groups}
      householdName={activeHousehold?.name ?? "Your household"}
      listsContent={
        <BoardListsView state={listsState} theme={theme} viewerId={appState.currentUser.id} />
      }
      observe={observe}
      onCompose={() => openBoardPostForm(null)}
      onFix={(postId) =>
        void run(postId, () => boardApi.fix(householdId ?? "", postId), "Marked fixed.")
      }
      onGotIt={(postId) => void run(postId, () => boardApi.gotIt(householdId ?? "", postId), null)}
      onMakeChore={makeChore}
      onNavigate={(destination) => navigate(destination)}
      onOpenPast={() => navigate("board-past")}
      onOpenPost={(postId) => openBoardPost(postId, "board")}
      onRetry={retry}
      pastCount={board?.pastCount ?? 0}
      onSelectTab={(tab) => setBoardTab?.(tab)}
      status={status}
      tab={boardTab}
      theme={theme}
      toBuyCount={toBuyCount}
      unseenCount={board?.unseenCount ?? 0}
      viewerIsAdmin={board?.viewerIsAdmin ?? false}
    />
  )
}
