import { api } from "@/lib/auth/api"
import { householdPath, type AssignmentDTO, type AssignmentRequests } from "./chores"

/**
 * Hand-off and swap requests between members (E11): the API, and the view models for the chore
 * menu items (S1), "Who should take it?" (S2), "Swap for which chore?" (S3), the Requests card
 * (S4) and the card chip and note.
 */

export type RequestPerson = { userId: string; displayName: string }

export type RequestOccurrence = {
  id: string
  choreId: string
  title: string
  categoryIcon: string | null
  kind: "CALENDAR" | "AFTER_COMPLETION" | "AS_NEEDED"
  scheduledFor: string
  dueAt: string | null
}

export type ChoreRequestDTO = {
  id: string
  type: "HANDOFF" | "SWAP"
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED"
  requester: RequestPerson
  /** Null when anyone who can take it may. */
  target: RequestPerson | null
  /** The requester's chore. */
  occurrence: RequestOccurrence
  /** The target's chore offered in a swap. */
  swapOccurrence: RequestOccurrence | null
  expiresAt: string
  createdAt: string
  resolvedAt: string | null
  resolvedBy: RequestPerson | null
}

export type ChoreRequestList = { forMe: ChoreRequestDTO[]; mine: ChoreRequestDTO[] }

export type RequestCandidateMember = RequestPerson & {
  eligible: boolean
  /** Their last away day, when they're away on the chore's day. */
  awayUntil: string | null
  /** Their own chores on that day, for the hint. */
  choresThatDay: string[]
}

export type RequestCandidates = {
  canHandOff: boolean
  canSwap: boolean
  anyoneEligible: boolean
  members: RequestCandidateMember[]
  swaps: (RequestPerson & { occurrences: RequestOccurrence[] })[]
  expiresAt: string
  /** When the requester hears nobody took it; null when the deadline is under two hours away. */
  headsUpAt: string | null
}

export type CreateChoreRequest = {
  type: "HANDOFF" | "SWAP"
  occurrenceId: string
  targetUserId: string | null
  swapOccurrenceId: string | null
}

function requestPath(householdId: string, requestId: string, action: string) {
  return `${householdPath(householdId)}/requests/${encodeURIComponent(requestId)}/${action}`
}

export const requestApi = {
  list: (householdId: string) =>
    api.get<ChoreRequestList>(`${householdPath(householdId)}/requests`),
  candidates: (householdId: string, assignmentId: string) =>
    api.get<RequestCandidates>(
      `${householdPath(householdId)}/assignments/${encodeURIComponent(assignmentId)}/request-candidates`,
    ),
  create: (householdId: string, request: CreateChoreRequest) =>
    api.post<ChoreRequestDTO>(`${householdPath(householdId)}/requests`, request),
  accept: (householdId: string, requestId: string) =>
    api.post<ChoreRequestDTO>(requestPath(householdId, requestId, "accept")),
  decline: (householdId: string, requestId: string) =>
    api.post<ChoreRequestDTO>(requestPath(householdId, requestId, "decline")),
  cancel: (householdId: string, requestId: string) =>
    api.post<ChoreRequestDTO>(requestPath(householdId, requestId, "cancel")),
}

// ---- Dates ---------------------------------------------------------------------------------

function utcNoon(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
}

/** "Thu" for a calendar date. */
export function weekdayShort(date: string) {
  const day = utcNoon(date)
  return day
    ? new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(day)
    : date
}

/** "Thu, Nov 27" for a calendar date. */
export function dayShort(date: string) {
  const day = utcNoon(date)
  return day
    ? new Intl.DateTimeFormat("en", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(day)
    : date
}

/** "6 PM", "4:30 PM" in the household's time zone. */
export function clockLabel(iso: string, timeZone: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === "hour")?.value ?? ""
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00"
  const period = (parts.find((part) => part.type === "dayPeriod")?.value ?? "").toUpperCase()
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`
}

function weekdayAt(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone }).format(new Date(iso))
}

/** "Thu, Nov 27 by 6 PM", or "Thu, Nov 27" with no due time. */
export function whenLabel(
  occurrence: { scheduledFor: string; dueAt: string | null },
  timeZone: string,
) {
  const day = dayShort(occurrence.scheduledFor)
  return occurrence.dueAt ? `${day} by ${clockLabel(occurrence.dueAt, timeZone)}` : day
}

/** "Mon, Nov 24 · by 8 PM" for a swap option. */
export function optionDetail(
  occurrence: { scheduledFor: string; dueAt: string | null },
  timeZone: string,
) {
  const day = dayShort(occurrence.scheduledFor)
  return occurrence.dueAt ? `${day} · by ${clockLabel(occurrence.dueAt, timeZone)}` : day
}

function initial(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase()
}

// ---- S1: chore menu ------------------------------------------------------------------------

export type RequestMenuItem = {
  kind: "handoff" | "swap"
  title: string
  hint: string
}

/** "Ask someone to take it" (or "Pass my turn") and "Swap with someone", as the server allows. */
export function requestMenuItems(
  requests: AssignmentRequests | null | undefined,
): RequestMenuItem[] {
  if (!requests?.canAsk) return []
  const items: RequestMenuItem[] = [
    requests.passTurn
      ? { kind: "handoff", title: "Pass my turn", hint: "Hand your turn to someone else" }
      : { kind: "handoff", title: "Ask someone to take it", hint: "Hand it off for this day" },
  ]
  if (requests.canSwap) {
    items.push({ kind: "swap", title: "Swap with someone", hint: "Trade for one of their chores" })
  }
  return items
}

export const REQUEST_MENU_FOOTNOTE =
  "Move and Skip follow the usual rules. Asking or swapping never needs an admin."

// ---- S2: who should take it ----------------------------------------------------------------

export type HandoffOption = {
  userId: string
  name: string
  initial: string
  hint: string
  disabled: boolean
  /** Shown with the plane icon (away). */
  away: boolean
}

/** "Free that day", "Has Laundry that day", or "Away until Sun · can't be asked". */
export function memberHint(member: RequestCandidateMember) {
  if (!member.eligible) {
    return member.awayUntil
      ? `Away until ${weekdayShort(member.awayUntil)} · can't be asked`
      : "Can't be asked"
  }
  const [first, ...rest] = member.choresThatDay
  if (!first) return "Free that day"
  return rest.length > 0 ? `Has ${first} +${rest.length} that day` : `Has ${first} that day`
}

export function handoffOptions(candidates: RequestCandidates): HandoffOption[] {
  return candidates.members.map((member) => ({
    userId: member.userId,
    name: member.displayName,
    initial: initial(member.displayName),
    hint: memberHint(member),
    disabled: !member.eligible,
    away: !member.eligible && Boolean(member.awayUntil),
  }))
}

/**
 * "It stays yours until someone accepts. If nobody has by 4 PM Thu, we'll let you know." The heads-up
 * line is left out when the deadline is under two hours away.
 */
export function handoffSummary(candidates: RequestCandidates, timeZone: string, passTurn = false) {
  const stays = passTurn
    ? "It stays your turn until someone accepts."
    : "It stays yours until someone accepts."
  if (!candidates.headsUpAt) return stays
  return `${stays} If nobody has by ${clockLabel(candidates.headsUpAt, timeZone)} ${weekdayAt(
    candidates.headsUpAt,
    timeZone,
  )}, we'll let you know.`
}

// ---- S3: swap for which chore --------------------------------------------------------------

export type SwapGroup = {
  userId: string
  name: string
  initial: string
  options: { id: string; title: string; detail: string; categoryIcon: string | null }[]
}

/** The target's chores in the next 14 days, grouped by person; only valid ones are listed. */
export function swapGroups(candidates: RequestCandidates, timeZone: string): SwapGroup[] {
  return candidates.swaps
    .filter((person) => person.occurrences.length > 0)
    .map((person) => ({
      userId: person.userId,
      name: person.displayName,
      initial: initial(person.displayName),
      options: person.occurrences.map((occurrence) => ({
        id: occurrence.id,
        title: occurrence.title,
        detail: optionDetail(occurrence, timeZone),
        categoryIcon: occurrence.categoryIcon,
      })),
    }))
}

/** "You do Clean bathroom on Sat. Rubayet does Wash dishes on Thu." */
export function swapSummary(
  mine: { title: string; scheduledFor: string },
  theirs: { title: string; scheduledFor: string },
  name: string,
) {
  return `You do ${theirs.title} on ${weekdayShort(theirs.scheduledFor)}. ${name} does ${
    mine.title
  } on ${weekdayShort(mine.scheduledFor)}.`
}

export function findSwapOption(candidates: RequestCandidates, occurrenceId: string | null) {
  if (!occurrenceId) return null
  for (const person of candidates.swaps) {
    const occurrence = person.occurrences.find((item) => item.id === occurrenceId)
    if (occurrence) return { person, occurrence }
  }
  return null
}

// ---- S4: requests for you ------------------------------------------------------------------

export type RequestItemView = {
  id: string
  type: "HANDOFF" | "SWAP"
  name: string
  initial: string
  /** Follows the bold name: " asks if you can take Wash dishes". */
  sentence: string
  detail: string
  acceptLabel: "Take it" | "Swap"
}

export function requestItem(request: ChoreRequestDTO, timeZone: string): RequestItemView {
  const name = request.requester.displayName
  const mine = request.occurrence
  if (request.type === "SWAP" && request.swapOccurrence) {
    return {
      id: request.id,
      type: "SWAP",
      name,
      initial: initial(name),
      sentence: " wants to swap",
      detail: `You do ${mine.title} (${weekdayShort(mine.scheduledFor)}), ${name} does ${
        request.swapOccurrence.title
      } (${weekdayShort(request.swapOccurrence.scheduledFor)})`,
      acceptLabel: "Swap",
    }
  }
  return {
    id: request.id,
    type: "HANDOFF",
    name,
    initial: initial(name),
    sentence:
      mine.kind === "AS_NEEDED"
        ? ` asks if you can take their turn for ${mine.title}`
        : ` asks if you can take ${mine.title}`,
    detail:
      mine.kind === "AS_NEEDED" && !mine.dueAt ? "Whenever it's needed" : whenLabel(mine, timeZone),
    acceptLabel: "Take it",
  }
}

/** The 409 when someone else got there first, as the server words it ("Already taken by Sam."). */
export function isTakenMessage(message: string) {
  return message.startsWith("Already taken by ")
}

// ---- Cards ---------------------------------------------------------------------------------

/** The amber chip on the requester's own card while their request is open. */
export function waitingLabel(requests: AssignmentRequests | null | undefined) {
  const open = requests?.open
  if (!open?.mine) return null
  return open.waitingFor
    ? `Waiting for ${open.waitingFor.displayName}`
    : "Waiting for anyone to take it"
}

/** The open request the viewer may cancel from the card. */
export function cancellableRequestId(requests: AssignmentRequests | null | undefined) {
  return requests?.open?.mine ? requests.open.id : null
}

/** "Taken over from Farhan" / "Swapped with Rubayet" after an accepted request. */
export function requestNoteLabel(
  requests: AssignmentRequests | null | undefined,
  viewerId?: string,
) {
  const note = requests?.note
  if (!note) return null
  const name = note.with.userId === viewerId ? "you" : note.with.displayName
  return note.type === "TAKEN_OVER" ? `Taken over from ${name}` : `Swapped with ${name}`
}

export function requestNoteKind(requests: AssignmentRequests | null | undefined) {
  return requests?.note?.type ?? null
}

/** Whether a dashboard or list assignment is waiting on the viewer's open request. */
export function hasOpenRequest(assignment: AssignmentDTO) {
  return Boolean(assignment.requests?.open?.mine)
}

/** What a chore card shows about requests: the waiting chip, the accepted note, Cancel request. */
export type CardRequestView = {
  waitingLabel: string | null
  noteLabel: string | null
  noteKind: "TAKEN_OVER" | "SWAPPED" | null
  cancelRequestId: string | null
}

export function cardRequestView(
  assignment: Pick<AssignmentDTO, "requests" | "status">,
  viewerId?: string,
): CardRequestView | undefined {
  const requests = assignment.requests
  if (!requests || assignment.status !== "PENDING") return undefined
  const view: CardRequestView = {
    waitingLabel: waitingLabel(requests),
    noteLabel: requestNoteLabel(requests, viewerId),
    noteKind: requestNoteKind(requests),
    cancelRequestId: cancellableRequestId(requests),
  }
  return view.waitingLabel || view.noteLabel ? view : undefined
}

// ---- Opening Home with a request in view ---------------------------------------------------

let pendingFocus: string | null = null

/** Remembers a request to bring into view when Home next shows its Requests card. */
export function focusRequestOnHome(requestId: string) {
  pendingFocus = requestId
}

/**
 * The request Home should bring into view: one remembered by {@link focusRequestOnHome}, or the
 * `requestId` a push notification put in the URL (/?screen=dashboard&requestId=…). It is taken
 * once; the URL parameter is removed.
 */
export function takeRequestFocus(): string | null {
  if (pendingFocus) {
    const id = pendingFocus
    pendingFocus = null
    return id
  }
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const id = params.get("requestId")
  if (!id) return null
  params.delete("requestId")
  const query = params.toString()
  window.history.replaceState(
    {},
    "",
    query ? `${window.location.pathname}?${query}` : window.location.pathname,
  )
  return id
}
