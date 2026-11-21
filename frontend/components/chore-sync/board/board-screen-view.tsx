"use client"

import type { ReactNode } from "react"
import {
  CalendarDays,
  Check,
  ChevronRight,
  ListChecks,
  Megaphone,
  Package,
  Phone,
  Pin,
  Plus,
  StickyNote,
  Trash2,
  Wifi,
  Wrench,
} from "lucide-react"
import type { BoardPost } from "@/lib/board/api"
import {
  dateBlock,
  eventEyebrow,
  firstLine,
  initialOf,
  isEmptyBoard,
  postedLabel,
  seenByLabel,
  type BoardGroups,
} from "@/lib/board/board-view"
import { timeAgo } from "@/lib/household/household-jobs"
import type { CardFeedbackView } from "@/lib/household/card-feedback"
import { BottomNav, type NavKey } from "../bottom-nav"
import { CardFeedbackMessage } from "../card-feedback"
import { OccurrenceMoreButton } from "../occurrence-action-sheet"
import styles from "./board-screen-view.module.css"

export type BoardTheme = "light" | "dark"

export type BoardScreenViewProps = {
  theme: BoardTheme
  householdName: string
  status: "loading" | "error" | "loaded"
  errorMessage?: string | null
  groups: BoardGroups
  unseenCount: number
  pastCount: number
  /** OWNER/ADMIN: "Make it a chore" on events. */
  viewerIsAdmin: boolean
  busyIds: string[]
  feedback: { postId: string; view: CardFeedbackView } | null
  /** The Posts | Lists switch and the "To buy" counter, for the Lists part of the Board. */
  listsEnabled?: boolean
  now?: number
  onCompose: () => void
  onOpenPost: (postId: string) => void
  onGotIt: (postId: string) => void
  onFix: (postId: string) => void
  onMakeChore: (postId: string) => void
  onOpenPast: () => void
  onRetry: () => void
  onNavigate: (destination: NavKey) => void
  /** Registers a card for automatic Seen (IntersectionObserver in the screen). */
  observe?: (postId: string, element: HTMLElement | null) => void
}

/** A house-info row's icon, from what the post is about. */
function infoIcon(post: BoardPost) {
  const text = `${post.title} ${post.details ?? ""}`.toLowerCase()
  if (/wi-?fi|internet|password/.test(text)) return <Wifi size={16} />
  if (/landlord|phone|call|contact|plumber|emergency/.test(text)) return <Phone size={16} />
  if (/bin|trash|garbage|recycl/.test(text)) return <Trash2 size={16} />
  if (post.type === "EVENT") return <CalendarDays size={16} />
  if (post.type === "PROBLEM") return <Wrench size={16} />
  return <Pin size={16} />
}

function Avatar({ name, seen }: { name: string; seen?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={styles.avatar}
      data-seen={seen === false ? "false" : undefined}
    >
      {initialOf(name)}
    </span>
  )
}

/** Everyone the post is for, faded until they've seen it, and "Seen by N of M". */
function SeenBy({ post }: { post: BoardPost }) {
  return (
    <>
      <span aria-hidden="true" className={styles.avatars}>
        {post.readers.slice(0, 5).map((reader) => (
          <Avatar
            key={reader.userId}
            name={reader.displayName}
            seen={reader.author || reader.seenAt !== null}
          />
        ))}
      </span>
      <span className={styles.seenBy}>{seenByLabel(post)}</span>
    </>
  )
}

function YouGotIt() {
  return (
    <span className={styles.gotIt}>
      <Check aria-hidden="true" size={16} strokeWidth={2.4} />
      You got it
    </span>
  )
}

function GotItButton({
  post,
  busy,
  compact,
  onGotIt,
}: {
  post: BoardPost
  busy: boolean
  compact?: boolean
  onGotIt: (postId: string) => void
}) {
  return (
    <button
      aria-busy={busy}
      aria-label={`Got it: ${post.title}`}
      className={`${styles.primary} ${compact ? styles.compact : ""}`}
      disabled={busy}
      onClick={() => onGotIt(post.id)}
      type="button"
    >
      <Check aria-hidden="true" size={16} strokeWidth={2.4} />
      Got it
    </button>
  )
}

function Edited({ post }: { post: BoardPost }) {
  return post.editedAt ? <span className={styles.edited}> · Edited</span> : null
}

type CardProps = {
  post: BoardPost
  theme: BoardTheme
  busy: boolean
  feedback?: CardFeedbackView
  viewerIsAdmin: boolean
  now: number
  onOpenPost: (postId: string) => void
  onGotIt: (postId: string) => void
  onFix: (postId: string) => void
  onMakeChore: (postId: string) => void
  observe?: (postId: string, element: HTMLElement | null) => void
}

function CardShell({
  post,
  theme,
  feedback,
  observe,
  children,
}: Pick<CardProps, "post" | "theme" | "feedback" | "observe"> & { children: ReactNode }) {
  return (
    <div>
      <article
        aria-label={post.title}
        className={styles.card}
        data-board-post={post.id}
        data-type={post.type}
        data-unseen={!post.viewer.seen || undefined}
        ref={observe ? (element) => observe(post.id, element) : undefined}
      >
        {children}
      </article>
      <CardFeedbackMessage feedback={feedback} theme={theme} />
    </div>
  )
}

function Title({ post, onOpenPost }: Pick<CardProps, "post" | "onOpenPost">) {
  return (
    <button className={styles.titleButton} onClick={() => onOpenPost(post.id)} type="button">
      {post.title}
    </button>
  )
}

function ProblemCard(props: CardProps) {
  const { post, busy, onOpenPost, onFix, now } = props
  return (
    <CardShell {...props}>
      <div className={styles.top}>
        <span className={styles.chip} data-tone="problem">
          <Wrench aria-hidden="true" size={13} strokeWidth={2.2} />
          Problem
        </span>
        <span className={styles.grow} />
        <OccurrenceMoreButton
          className={styles.more}
          onClick={() => onOpenPost(post.id)}
          title={post.title}
        />
      </div>
      <Title onOpenPost={onOpenPost} post={post} />
      {post.details && <p className={styles.details}>{post.details}</p>}
      <div className={styles.meta}>
        <Avatar name={post.authorDisplayName} />
        <span className={styles.metaText}>
          {postedLabel(post, now)}
          <Edited post={post} />
        </span>
      </div>
      {post.handlerDisplayName && (
        <div className={styles.handlerRow}>
          <span className={styles.chip} data-tone="handler">
            <Check aria-hidden="true" size={13} strokeWidth={2.4} />
            {post.handlerDisplayName} is handling it
          </span>
        </div>
      )}
      <div className={styles.actions}>
        <button
          aria-busy={busy}
          aria-label={`Mark fixed: ${post.title}`}
          className={styles.secondary}
          disabled={busy}
          onClick={() => onFix(post.id)}
          type="button"
        >
          <Check aria-hidden="true" size={16} strokeWidth={2.4} />
          Mark fixed
        </button>
      </div>
    </CardShell>
  )
}

function EventCard(props: CardProps) {
  const { post, busy, viewerIsAdmin, onOpenPost, onGotIt, onMakeChore } = props
  const block = post.eventDate ? dateBlock(post.eventDate) : null
  const canGotIt = !post.viewer.author && !post.viewer.gotIt
  return (
    <CardShell {...props}>
      <div className={styles.eventRow}>
        {block && (
          <div aria-hidden="true" className={styles.dateBlock}>
            <span>{block.weekday}</span>
            <span>{block.day}</span>
          </div>
        )}
        <div>
          <div className={styles.top}>
            <span className={styles.eventEyebrow}>{eventEyebrow(post)}</span>
            <OccurrenceMoreButton
              className={styles.more}
              onClick={() => onOpenPost(post.id)}
              title={post.title}
            />
          </div>
          <Title onOpenPost={onOpenPost} post={post} />
          {post.details && <p className={styles.details}>{post.details}</p>}
        </div>
      </div>
      <div className={styles.meta}>
        <SeenBy post={post} />
        <span className={styles.grow} />
        {post.viewer.gotIt ? (
          <YouGotIt />
        ) : (
          <span className={styles.metaText}>
            by {post.authorDisplayName}
            <Edited post={post} />
          </span>
        )}
      </div>
      {(canGotIt || viewerIsAdmin) && (
        <div className={styles.actions}>
          {canGotIt && <GotItButton busy={busy} onGotIt={onGotIt} post={post} />}
          {viewerIsAdmin && (
            <button className={styles.secondary} onClick={() => onMakeChore(post.id)} type="button">
              <ListChecks aria-hidden="true" size={16} />
              Make it a chore
            </button>
          )}
        </div>
      )}
    </CardShell>
  )
}

function HeadsUpCard(props: CardProps) {
  const { post, busy, onOpenPost, onGotIt, now } = props
  const canGotIt = !post.viewer.author && !post.viewer.gotIt
  return (
    <CardShell {...props}>
      <div className={styles.top}>
        {post.viewer.forYou ? (
          <span className={styles.chip} data-tone="for-you">
            <Package aria-hidden="true" size={13} strokeWidth={2.2} />
            For you
          </span>
        ) : (
          <span className={styles.chip}>
            <Megaphone aria-hidden="true" size={13} strokeWidth={2.2} />
            Heads-up
          </span>
        )}
        <span className={styles.grow} />
        <span className={styles.when}>{timeAgo(post.createdAt, now)}</span>
      </div>
      <Title onOpenPost={onOpenPost} post={post} />
      {post.details && <p className={styles.details}>{post.details}</p>}
      <div className={styles.meta}>
        {canGotIt ? (
          <>
            <Avatar name={post.authorDisplayName} />
            <span className={styles.metaText}>
              {post.authorDisplayName}
              <Edited post={post} />
            </span>
            <span className={styles.grow} />
            <GotItButton busy={busy} compact onGotIt={onGotIt} post={post} />
          </>
        ) : (
          <>
            <SeenBy post={post} />
            <span className={styles.grow} />
            {post.viewer.gotIt && <YouGotIt />}
          </>
        )}
      </div>
    </CardShell>
  )
}

function PostCard(props: CardProps) {
  if (props.post.type === "PROBLEM") return <ProblemCard {...props} />
  if (props.post.type === "EVENT") return <EventCard {...props} />
  return <HeadsUpCard {...props} />
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string
  title: string
  count?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={styles.list}>
      <div className={styles.sectionHead}>
        <h2 id={id}>{title}</h2>
        {count && <span>{count}</span>}
      </div>
      {children}
    </section>
  )
}

/** The Board tab (B1): composer, house info, problems, events, heads-ups and Past. */
export function BoardScreenView(props: BoardScreenViewProps) {
  const {
    theme,
    householdName,
    status,
    groups,
    unseenCount,
    pastCount,
    listsEnabled = false,
    now = Date.now(),
  } = props
  const cardProps = (post: BoardPost): CardProps => ({
    post,
    theme,
    busy: props.busyIds.includes(post.id),
    feedback: props.feedback?.postId === post.id ? props.feedback.view : undefined,
    viewerIsAdmin: props.viewerIsAdmin,
    now,
    onOpenPost: props.onOpenPost,
    onGotIt: props.onGotIt,
    onFix: props.onFix,
    onMakeChore: props.onMakeChore,
    observe: props.observe,
  })
  const loaded = status === "loaded"
  const events = groups.comingUp.length
  return (
    <div className={`${styles.screen} ${theme === "dark" ? styles.darkTheme : styles.lightTheme}`}>
      <main aria-busy={status === "loading"} className={styles.scrollContent} data-scroll-container>
        <div className={styles.content}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>Your house&nbsp;/&nbsp;{householdName}</p>
            <h1>Board.</h1>
            <p className={styles.subtitle}>What the house needs to know.</p>
            <div aria-label="Board totals" className={styles.counters}>
              <div className={styles.counter}>
                <span className={styles.counterNumber}>{loaded ? unseenCount : "—"}</span>
                <span className={styles.counterLabel}>New for you</span>
              </div>
              {listsEnabled && (
                <div className={styles.counter}>
                  <span className={styles.counterNumber}>—</span>
                  <span className={styles.counterLabel}>To buy</span>
                </div>
              )}
            </div>
          </header>

          {listsEnabled && (
            <div aria-label="Board" className={styles.tabs} role="tablist">
              <button aria-selected="true" className={styles.tab} role="tab" type="button">
                Posts
                {unseenCount > 0 && <span className={styles.tabBadge}>{unseenCount} new</span>}
              </button>
              <button aria-selected="false" className={styles.tab} role="tab" type="button">
                Lists
              </button>
            </div>
          )}

          <div className={styles.body}>
            <button className={styles.composer} onClick={props.onCompose} type="button">
              <span>Tell the house something…</span>
              <span aria-hidden="true" className={styles.composerPlus}>
                <Plus size={20} strokeWidth={2.4} />
              </span>
            </button>

            {status === "loading" && (
              <div aria-label="Loading the board" className={styles.list}>
                {[0, 1].map((item) => (
                  <div className={styles.skeleton} key={item} />
                ))}
              </div>
            )}

            {status === "error" && (
              <div className={`${styles.card} ${styles.error}`}>
                <p role="alert">
                  {props.errorMessage ?? "The board is unavailable right now. Please try again."}
                </p>
                <button className={styles.linkButton} onClick={props.onRetry} type="button">
                  Try again
                </button>
              </div>
            )}

            {loaded && isEmptyBoard(groups) && (
              <section className={`${styles.card} ${styles.empty}`}>
                <span aria-hidden="true" className={styles.emptyIcon}>
                  <StickyNote size={24} />
                </span>
                <h2>Nothing on the board yet.</h2>
                <p>
                  A visit coming up, something broken, a package at the door: say it once here and
                  everyone sees it.
                </p>
                <button className={styles.linkButton} onClick={props.onCompose} type="button">
                  Tell the house something
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              </section>
            )}

            {loaded && groups.houseInfo.length > 0 && (
              <section
                aria-labelledby="board-house-info"
                className={`${styles.card} ${styles.houseInfo}`}
              >
                <div className={styles.houseInfoHead}>
                  <Pin aria-hidden="true" size={15} />
                  <h2 id="board-house-info">House info</h2>
                  <span>{groups.houseInfo.length}</span>
                </div>
                <ul className={styles.infoList}>
                  {groups.houseInfo.map((post) => (
                    <li
                      data-board-post={post.id}
                      key={post.id}
                      ref={
                        props.observe ? (element) => props.observe?.(post.id, element) : undefined
                      }
                    >
                      <button
                        className={styles.infoRow}
                        onClick={() => props.onOpenPost(post.id)}
                        type="button"
                      >
                        <span aria-hidden="true">{infoIcon(post)}</span>
                        <span className={styles.infoTitle}>{post.title}</span>
                        <span className={styles.infoDetail}>{firstLine(post.details)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {loaded && groups.needsFixing.length > 0 && (
              <Section
                count={`${groups.needsFixing.length} open`}
                id="board-needs-fixing"
                title="Needs fixing"
              >
                {groups.needsFixing.map((post) => (
                  <PostCard key={post.id} {...cardProps(post)} />
                ))}
              </Section>
            )}

            {loaded && events > 0 && (
              <Section
                count={events === 1 ? "1 event" : `${events} events`}
                id="board-coming-up"
                title="Coming up"
              >
                {groups.comingUp.map((post) => (
                  <PostCard key={post.id} {...cardProps(post)} />
                ))}
              </Section>
            )}

            {loaded && groups.headsUps.length > 0 && (
              <Section id="board-heads-ups" title="Heads-ups">
                {groups.headsUps.map((post) => (
                  <PostCard key={post.id} {...cardProps(post)} />
                ))}
              </Section>
            )}

            {loaded && pastCount > 0 && (
              <button className={styles.pastLink} onClick={props.onOpenPast} type="button">
                Past posts ({pastCount})
                <ChevronRight aria-hidden="true" size={15} />
              </button>
            )}
          </div>
        </div>
      </main>
      <BottomNav active="board" navigate={props.onNavigate} theme={theme} />
    </div>
  )
}
