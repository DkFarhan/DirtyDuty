"use client"

import { useEffect, useState } from "react"
import { Check, ChevronRight, History } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { boardApi, type BoardPost } from "@/lib/board/api"
import { groupPast, pastSubtitle } from "@/lib/board/board-view"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdBoardResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { useHouseholds } from "@/lib/household/household-context"
import { TYPE_ICONS } from "../board/post-sheets"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import designStyles from "../redesign/household-secondary-design-preview.module.css"
import formStyles from "../chore-form/chore-form.module.css"
import styles from "../board/board-post-form.module.css"

/** Past posts (B12): fixed problems, finished events and older heads-ups, kept for 30 days. */
export function BoardPastScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { navigate, openBoardPost } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const householdId = household?.id ?? null
  const timeZone = household?.timezone ?? "UTC"
  const { revision } = useDataSync(
    householdId ? householdBoardResource(householdId) : "household:none:board",
  )
  const [posts, setPosts] = useState<BoardPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    boardApi
      .past(householdId)
      .then((loaded) => {
        if (!cancelled) setPosts(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof ApiError ? cause.message : "Past posts couldn't be loaded right now.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [householdId, revision])

  const rootClass = `flex min-h-screen flex-col ${designStyles.liveRoot} ${designStyles.choreForm} ${designStyles[theme]} ${formStyles.page}`
  return (
    <div className={rootClass} data-theme={theme}>
      <HouseholdLiveDesignHeader
        eyebrow="Board · Past"
        heroDescription="Fixed problems, finished events and older heads-ups."
        heroEyebrow="Kept for 30 days"
        heroIconNode={<History size={28} />}
        heroTitle="What already happened."
        household={household?.name ?? "Your household"}
        onBack={() => navigate("board")}
        title="Past posts"
      />
      <main className={`${designStyles.liveContent} ${formStyles.main}`}>
        {error && (
          <p className={`${formStyles.card} ${formStyles.inputError}`} role="alert">
            {error}
          </p>
        )}
        {!error && posts === null && (
          <div
            aria-label="Loading past posts"
            className={`${formStyles.card} h-36 animate-pulse`}
          />
        )}
        {posts?.length === 0 && <p className={formStyles.card}>Nothing in Past yet.</p>}
        {posts &&
          groupPast(posts).map((group) => (
            <section aria-label={group.title} key={group.title}>
              <h2 className={styles.pastGroupTitle}>{group.title}</h2>
              <div className={`${formStyles.card} ${formStyles.rows}`}>
                {group.posts.map((post) => (
                  <div className={formStyles.rowWrap} key={post.id}>
                    <button
                      className={formStyles.row}
                      onClick={() => openBoardPost(post.id, "board-past")}
                      style={{ gridTemplateColumns: "36px minmax(0, 1fr) 18px" }}
                      type="button"
                    >
                      <span aria-hidden="true" className={formStyles.tile}>
                        {post.type === "PROBLEM" && post.fixedAt ? (
                          <Check size={18} />
                        ) : (
                          TYPE_ICONS[post.type](18)
                        )}
                      </span>
                      <span className={formStyles.rowLabel}>
                        {post.title}
                        <small>{pastSubtitle(post, timeZone)}</small>
                      </span>
                      <ChevronRight aria-hidden="true" size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        <p className={styles.pastFootnote}>
          Past posts are removed after 30 days. Pinned house info never moves here.
        </p>
      </main>
    </div>
  )
}
