"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  Bell,
  BellRing,
  Check,
  ChevronRight,
  Eye,
  Hand,
  ListChecks,
  Pencil,
  Trash2,
} from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { boardApi, type BoardPost } from "@/lib/board/api"
import {
  heroEyebrow,
  initialOf,
  readerStatus,
  remindLabel,
  seenByLabel,
  unseenReaders,
} from "@/lib/board/board-view"
import { choreDueForEvent } from "@/lib/board/post-form"
import { TYPE_LABELS } from "@/lib/board/post-suggestions"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdBoardResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { timeAgo } from "@/lib/household/household-jobs"
import { useHouseholds } from "@/lib/household/household-context"
import { TYPE_ICONS } from "../board/post-sheets"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import { useDialogFocus } from "../use-dialog-focus"
import designStyles from "../redesign/household-secondary-design-preview.module.css"
import formStyles from "../chore-form/chore-form.module.css"
import styles from "../board/board-post-form.module.css"

type Action = "got-it" | "handle" | "release" | "fix" | "remind" | "delete"

function clockTime(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }).format(
      new Date(iso),
    )
  } catch {
    return new Date(iso).toLocaleTimeString()
  }
}

/** Board details (B4): what was posted, who has seen it, and what can be done with it. */
export function BoardPostScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { navigate, boardPostId, boardPostReturn, openBoardPostForm, startChoreDraft } =
    useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const householdId = household?.id ?? null
  const timeZone = household?.timezone ?? "UTC"
  const admin = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"
  const { invalidate } = useDataSync(
    householdId ? householdBoardResource(householdId) : "household:none:board",
  )
  const [post, setPost] = useState<BoardPost | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Action | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [remindEnded, setRemindEnded] = useState<string | null>(null)
  const deleteRef = useRef<HTMLElement | null>(null)
  const hintId = useId()

  useDialogFocus(
    deleteRef,
    confirmDelete,
    () => setConfirmDelete(false),
    () => document.querySelector<HTMLElement>("[data-board-delete]"),
  )

  useEffect(() => {
    if (!householdId || !boardPostId) return
    let cancelled = false
    boardApi
      .get(householdId, boardPostId)
      .then((loaded) => {
        if (cancelled) return
        setPost(loaded)
        // Opening the details counts as seeing it.
        if (!loaded.viewer.seen) {
          boardApi
            .seen(householdId, [loaded.id])
            .then(() => invalidate())
            .catch(() => undefined)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            cause instanceof ApiError
              ? cause.message
              : "This post couldn't be opened. Please try again.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [boardPostId, householdId, invalidate])

  // "Reminder sent" turns back into Remind when the 2-hour window ends.
  const remindAgainAt = post?.viewer.remindAgainAt ?? null
  useEffect(() => {
    if (!remindAgainAt) return
    const timer = window.setTimeout(
      () => setRemindEnded(remindAgainAt),
      Math.max(0, new Date(remindAgainAt).getTime() - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [remindAgainAt])

  const back = () => navigate(boardPostReturn)

  const run = async (action: Action, call: () => Promise<BoardPost | void>) => {
    if (!householdId || !post || busy) return
    setBusy(action)
    setMessage(null)
    try {
      const next = await call()
      invalidate()
      if (action === "delete") {
        back()
        return
      }
      if (next) setPost(next)
    } catch (cause) {
      setMessage(
        cause instanceof ApiError ? cause.message : "That didn't go through. Please try again.",
      )
      if (cause instanceof ApiError && cause.status === 409) {
        boardApi
          .get(householdId, post.id)
          .then(setPost)
          .catch(() => undefined)
      }
    } finally {
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  const rootClass = `flex min-h-screen flex-col ${designStyles.liveRoot} ${designStyles.choreForm} ${designStyles[theme]} ${formStyles.page}`

  if (!post) {
    return (
      <div className={rootClass} data-theme={theme}>
        <HouseholdLiveDesignHeader
          eyebrow="Board"
          heroEyebrow="Board"
          heroTitle={loadError ? "Not on the board" : "Loading…"}
          household={household?.name ?? "Your household"}
          onBack={back}
          title="Post"
        />
        <div className={designStyles.liveContent}>
          {loadError ? (
            <>
              <p className={`${formStyles.card} ${formStyles.inputError}`} role="alert">
                {loadError}
              </p>
              <button className={formStyles.secondaryButton} onClick={back} type="button">
                Back
              </button>
            </>
          ) : (
            <div aria-label="Loading post" className={`${formStyles.card} h-36 animate-pulse`} />
          )}
        </div>
      </div>
    )
  }

  const id = householdId ?? ""
  const active = post.pastAt === null
  const problem = post.type === "PROBLEM"
  const waiting = post.viewer.remindAgainAt !== null && remindEnded !== post.viewer.remindAgainAt
  const remind = post.viewer.canRemind ? remindLabel(post) : null
  const unseen = unseenReaders(post)
  const makeChore = () =>
    startChoreDraft({
      title: post.title,
      once:
        post.type === "EVENT" && post.eventDate
          ? choreDueForEvent(post.eventDate, timeZone)
          : undefined,
      returnTo: "board-post",
    })
  const actionRow = (
    icon: React.ReactNode,
    label: string,
    value: string,
    onClick: () => void,
    data?: string,
  ) => (
    <div className={formStyles.rowWrap}>
      <button
        aria-label={value ? `${label}: ${value}` : label}
        className={formStyles.row}
        data-board-action={data}
        onClick={onClick}
        type="button"
      >
        <span aria-hidden="true" className={formStyles.tile}>
          {icon}
        </span>
        <span className={formStyles.rowLabel}>{label}</span>
        <span className={formStyles.rowValue}>{value}</span>
        <ChevronRight aria-hidden="true" size={18} />
      </button>
    </div>
  )
  const showActions = active && (admin || post.viewer.canEdit || (problem && post.handlerUserId))

  return (
    <div className={rootClass} data-theme={theme}>
      <HouseholdLiveDesignHeader
        eyebrow={`Board · ${active ? TYPE_LABELS[post.type] : "Past"}${post.urgent ? " · Urgent" : ""}`}
        heroDetails={
          // One paragraph: the hero styles its last paragraph as the quiet line under the title.
          <p>
            Posted by {post.viewer.author ? "you" : post.authorDisplayName} ·{" "}
            {timeAgo(post.createdAt)}
            {post.editedAt ? " · Edited" : ""}
            {problem && post.fixedAt && (
              <>
                <br />
                Fixed by {post.fixedByDisplayName}
              </>
            )}
            {problem && !post.fixedAt && post.handlerDisplayName && (
              <>
                <br />
                {post.handlerDisplayName} is handling it
              </>
            )}
          </p>
        }
        heroEyebrow={heroEyebrow(post)}
        heroIconNode={TYPE_ICONS[post.type](28)}
        heroTitle={post.title}
        household={household?.name ?? "Your household"}
        onBack={back}
        title={post.title}
      />
      <main className={`${designStyles.liveContent} ${formStyles.main}`}>
        {post.details && (
          <section aria-label="Details" className={formStyles.card}>
            <p className={styles.cardLabel}>Details</p>
            <p className={styles.detailText}>{post.details}</p>
          </section>
        )}

        <section aria-labelledby="board-seen-title" className={formStyles.card}>
          <div className={styles.seenHead}>
            <h2 id="board-seen-title">{seenByLabel(post)}</h2>
            {post.gotItCount > 0 && <span>{post.gotItCount} got it</span>}
          </div>
          <ul className={styles.readers}>
            {post.readers.map((reader) => {
              const status = readerStatus(reader)
              return (
                <li className={styles.reader} data-status={status.kind} key={reader.userId}>
                  <span aria-hidden="true" className={styles.readerAvatar}>
                    {initialOf(reader.displayName)}
                  </span>
                  <span className={styles.readerName}>{reader.displayName}</span>
                  <span className={styles.readerStatus}>
                    {status.kind === "got-it" && <Check aria-hidden="true" size={15} />}
                    {status.kind === "seen" && <Eye aria-hidden="true" size={15} />}
                    {status.label}
                  </span>
                </li>
              )
            })}
          </ul>
          {active && post.viewer.canRemind && (waiting || remind) && (
            <>
              {waiting ? (
                <button
                  aria-describedby={hintId}
                  aria-disabled="true"
                  className={styles.remind}
                  type="button"
                >
                  <BellRing aria-hidden="true" size={17} />
                  Reminder sent
                </button>
              ) : (
                <button
                  aria-busy={busy === "remind"}
                  className={styles.remind}
                  disabled={busy !== null}
                  onClick={() => void run("remind", () => boardApi.remind(id, post.id))}
                  type="button"
                >
                  <Bell aria-hidden="true" size={17} />
                  {busy === "remind" ? "Sending…" : remind}
                </button>
              )}
              {waiting && post.viewer.remindAgainAt && (
                <p className={styles.remindHint} id={hintId}>
                  {unseen.length === 0 ? (
                    "Everyone has seen it now."
                  ) : (
                    <>
                      You can remind {unseen.length === 1 ? unseen[0].displayName : "them"} again at{" "}
                      {clockTime(post.viewer.remindAgainAt, timeZone)}.
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </section>

        {showActions && (
          <section aria-label="Actions" className={`${formStyles.card} ${formStyles.rows}`}>
            {admin &&
              actionRow(
                <ListChecks size={18} />,
                "Make it a chore",
                post.type === "EVENT" ? "One-time chore" : "",
                makeChore,
              )}
            {problem &&
              post.handlerUserId &&
              actionRow(
                <Hand size={18} />,
                "Stop handling it",
                post.handlerDisplayName ?? "",
                () => void run("release", () => boardApi.release(id, post.id)),
              )}
            {post.viewer.canEdit &&
              actionRow(<Pencil size={18} />, "Edit post", "", () => openBoardPostForm(post.id))}
          </section>
        )}

        {message && (
          <p className={formStyles.inputError} role="alert">
            {message}
          </p>
        )}

        {post.viewer.canDelete && (
          <button
            className={styles.deleteLink}
            data-board-delete
            onClick={() => setConfirmDelete(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
            Delete post
          </button>
        )}
      </main>

      {active && (
        <div className={formStyles.footer}>
          <div className={formStyles.footerInner}>
            {problem ? (
              <div
                className={`${formStyles.footerButtons} ${post.handlerUserId ? styles.singleFooter : ""}`}
              >
                {!post.handlerUserId && (
                  <button
                    className={formStyles.secondaryButton}
                    disabled={busy !== null}
                    onClick={() => void run("handle", () => boardApi.handle(id, post.id))}
                    type="button"
                  >
                    I&apos;ll handle it
                  </button>
                )}
                <button
                  className={formStyles.primaryButton}
                  disabled={busy !== null}
                  onClick={() => void run("fix", () => boardApi.fix(id, post.id))}
                  type="button"
                >
                  {busy === "fix" ? "Saving…" : "Mark fixed"}
                </button>
              </div>
            ) : post.viewer.author ? null : post.viewer.gotIt ? (
              <p className={styles.gotItDone} role="status">
                <Check aria-hidden="true" size={18} />
                You got it
              </p>
            ) : (
              <div className={`${formStyles.footerButtons} ${styles.singleFooter}`}>
                <button
                  className={formStyles.primaryButton}
                  disabled={busy !== null}
                  onClick={() => void run("got-it", () => boardApi.gotIt(id, post.id))}
                  type="button"
                >
                  <Check aria-hidden="true" size={17} /> Got it
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className={formStyles.dialogBackdrop} role="presentation">
          <section
            aria-labelledby="board-delete-title"
            aria-modal="true"
            className={formStyles.dialog}
            ref={deleteRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="board-delete-title">Delete this post?</h2>
            <p>&ldquo;{post.title}&rdquo; will be removed from the board for everyone.</p>
            <div className={formStyles.dialogButtons}>
              <button
                className={formStyles.secondaryButton}
                disabled={busy === "delete"}
                onClick={() => setConfirmDelete(false)}
                type="button"
              >
                Keep it
              </button>
              <button
                className={formStyles.dangerButton}
                disabled={busy === "delete"}
                onClick={() => void run("delete", () => boardApi.remove(id, post.id))}
                type="button"
              >
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
