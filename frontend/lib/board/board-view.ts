import { timeAgo } from "@/lib/household/household-jobs"
import { shortDate, todayIn } from "@/lib/household/chore-quick-form"
import type { BoardPost, BoardReader } from "./api"
import { timeRangeLabel } from "./post-form"

/** The board's sections, top to bottom; each is hidden when empty. */
export type BoardGroups = {
  houseInfo: BoardPost[]
  needsFixing: BoardPost[]
  comingUp: BoardPost[]
  headsUps: BoardPost[]
}

function eventKey(post: BoardPost) {
  return `${post.eventDate ?? ""}T${post.startTime ?? "00:00"}`
}

/**
 * Groups the active posts: pinned posts are House info whatever their type, oldest first; open problems newest
 * first; events by date and start time; heads-ups newest first.
 */
export function groupBoard(posts: BoardPost[]): BoardGroups {
  const active = posts.filter((post) => post.pastAt === null)
  const newest = (left: BoardPost, right: BoardPost) =>
    right.createdAt.localeCompare(left.createdAt)
  return {
    // House info keeps the order it was pinned in, like a notice board.
    houseInfo: active
      .filter((post) => post.pinned)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    needsFixing: active
      .filter((post) => !post.pinned && post.type === "PROBLEM" && post.fixedAt === null)
      .sort(newest),
    comingUp: active
      .filter((post) => !post.pinned && post.type === "EVENT")
      .sort((left, right) => eventKey(left).localeCompare(eventKey(right))),
    headsUps: active.filter((post) => !post.pinned && post.type === "HEADS_UP").sort(newest),
  }
}

export function isEmptyBoard(groups: BoardGroups) {
  return (
    groups.houseInfo.length +
      groups.needsFixing.length +
      groups.comingUp.length +
      groups.headsUps.length ===
    0
  )
}

/** The first line of a post's details, for compact rows. */
export function firstLine(details: string | null) {
  return (
    details
      ?.split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  )
}

/** "A" for an avatar. */
export function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?"
}

/** "Seen by 2 of 3", counting everyone but the author. */
export function seenByLabel(post: BoardPost) {
  return `Seen by ${post.seenCount} of ${post.audienceCount}`
}

/** "THU" and "27" for an event's date block. */
export function dateBlock(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return {
    weekday: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" })
      .format(date)
      .toUpperCase(),
    day: String(day),
  }
}

/** "NEW · 10 AM–12 PM" over an event's title; NEW while the viewer hasn't seen it. */
export function eventEyebrow(post: BoardPost) {
  const time = timeRangeLabel(post.startTime, post.endTime).toUpperCase()
  return post.viewer.seen ? time : `NEW · ${time}`
}

/** "Abubakar · 2 days ago". */
export function postedLabel(post: BoardPost, now: number = Date.now()) {
  return `${post.authorDisplayName} · ${timeAgo(post.createdAt, now)}`
}

/** "Today", "Tomorrow" or "Thu, Nov 27" for an event, in the household's time zone. */
export function eventDayLabel(isoDate: string, timeZone: string, now: Date = new Date()) {
  const today = todayIn(timeZone, now)
  const tomorrow = todayIn(timeZone, new Date(now.getTime() + 86_400_000))
  if (isoDate === today) return "Today"
  if (isoDate === tomorrow) return "Tomorrow"
  return shortDate(isoDate)
}

/** The details hero line: "THU, NOV 27 · 10 AM – 12 PM", or the type for other posts. */
export function heroEyebrow(post: BoardPost) {
  if (post.type === "EVENT" && post.eventDate) {
    return `${shortDate(post.eventDate)} · ${timeRangeLabel(post.startTime, post.endTime)}`
  }
  if (post.type === "PROBLEM") return post.fixedAt ? "Problem · Fixed" : "Problem"
  return post.viewer.forYou ? "Heads-up · For you" : "Heads-up"
}

export type ReaderStatus = { kind: "posted" | "got-it" | "seen" | "not-seen"; label: string }

/** "Posted", "Got it · 40 min ago", "Seen · 10 min ago" or "Not seen yet". */
export function readerStatus(reader: BoardReader, now: number = Date.now()): ReaderStatus {
  if (reader.author) return { kind: "posted", label: "Posted" }
  if (reader.gotItAt) return { kind: "got-it", label: `Got it · ${timeAgo(reader.gotItAt, now)}` }
  if (reader.seenAt) return { kind: "seen", label: `Seen · ${timeAgo(reader.seenAt, now)}` }
  return { kind: "not-seen", label: "Not seen yet" }
}

/**
 * Who Remind reaches: the people the post is for (the picked ones for a PICKED post, everyone
 * otherwise), not the author, who haven't seen it yet.
 */
export function unseenReaders(post: BoardPost) {
  return post.readers.filter(
    (reader) =>
      !reader.author &&
      reader.seenAt === null &&
      (post.notifyMode !== "PICKED" || post.recipientUserIds.includes(reader.userId)),
  )
}

/** "Remind Sam", "Remind Sam and Ana", "Remind 3 people". */
export function remindLabel(post: BoardPost) {
  const names = unseenReaders(post).map((reader) => reader.displayName)
  if (names.length === 0) return null
  if (names.length === 1) return `Remind ${names[0]}`
  if (names.length === 2) return `Remind ${names[0]} and ${names[1]}`
  return `Remind ${names.length} people`
}

export type HomeBoardRow = {
  post: BoardPost
  subtitle: string
  /** The viewer hasn't seen it yet. */
  unseen: boolean
}

/**
 * Up to {@link limit} rows for Home's Board section: the next event, open problems, then heads-ups
 * the viewer hasn't seen. Empty when there's nothing active to show.
 */
export function homeBoardRows(
  posts: BoardPost[],
  timeZone: string,
  now: Date = new Date(),
  limit = 4,
): HomeBoardRow[] {
  const groups = groupBoard(posts)
  const rows: HomeBoardRow[] = []
  const next = groups.comingUp[0]
  if (next?.eventDate) {
    const time = next.startTime ? ` ${timeRangeLabel(next.startTime, null)}` : ""
    rows.push({
      post: next,
      subtitle: `${eventDayLabel(next.eventDate, timeZone, now)}${time} · ${seenByLabel(next).toLowerCase()}`,
      unseen: !next.viewer.seen,
    })
  }
  for (const problem of groups.needsFixing) {
    rows.push({
      post: problem,
      subtitle: problem.handlerDisplayName
        ? `${problem.handlerDisplayName} is handling it`
        : postedLabel(problem, now.getTime()),
      unseen: !problem.viewer.seen,
    })
  }
  for (const headsUp of groups.headsUps.filter((post) => !post.viewer.seen)) {
    rows.push({ post: headsUp, subtitle: postedLabel(headsUp, now.getTime()), unseen: true })
  }
  return rows.slice(0, limit)
}

export type PastGroup = { title: "This week" | "Earlier"; posts: BoardPost[] }

/** Past posts in "This week" (Past for under 7 days) and "Earlier". */
export function groupPast(posts: BoardPost[], now: number = Date.now()): PastGroup[] {
  const weekAgo = now - 7 * 86_400_000
  const recent = posts.filter((post) => post.pastAt && new Date(post.pastAt).getTime() >= weekAgo)
  const earlier = posts.filter((post) => !recent.includes(post))
  return [
    { title: "This week" as const, posts: recent },
    { title: "Earlier" as const, posts: earlier },
  ].filter((group) => group.posts.length > 0)
}

/** "Fixed by Rubayet · Wed", "Event · Tue, Nov 18 · seen by 4 of 4", "Heads-up · Mon · …". */
export function pastSubtitle(post: BoardPost, timeZone: string) {
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en", { weekday: "short", timeZone }).format(new Date(iso))
  if (post.type === "PROBLEM") {
    return post.fixedAt
      ? `Fixed by ${post.fixedByDisplayName ?? "Former member"} · ${day(post.fixedAt)}`
      : `Problem · ${day(post.createdAt)}`
  }
  const seen = seenByLabel(post).toLowerCase()
  if (post.type === "EVENT" && post.eventDate) {
    return `Event · ${shortDate(post.eventDate)} · ${seen}`
  }
  return `Heads-up · ${day(post.createdAt)} · ${seen}`
}
