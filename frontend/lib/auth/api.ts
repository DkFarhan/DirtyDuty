const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
)

export const apiUrl = (path: string) => `${API_BASE_URL}${path}`

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

type ApiRequestOptions = {
  method?: HttpMethod
  body?: unknown
  headers?: Record<string, string>
}

export type ApiErrorKind =
  "validation" | "unauthenticated" | "forbidden" | "conflict" | "server" | "network"

export class ApiError extends Error {
  readonly status: number | null
  readonly kind: ApiErrorKind
  readonly details: unknown

  constructor(message: string, status: number | null, kind: ApiErrorKind, details: unknown = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.kind = kind
    this.details = details
  }
}

type CsrfResponse = {
  token: string
  headerName: string
}

let csrfState: CsrfResponse | null = null

function errorKind(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated"
  if (status === 403) return "forbidden"
  if (status === 409) return "conflict"
  if (status >= 400 && status < 500) return "validation"
  return "server"
}

/** Chore category messages from the server that are safe and useful to show as written. */
const CATEGORY_MESSAGES = new Set([
  "Enter a category name.",
  "Category names can be at most 40 characters.",
  "Choose an icon for this category.",
  "A category with this name already exists.",
  "A household can have at most 40 categories.",
  "The new order must list every category in this household exactly once.",
  "Category was not found in this household.",
])

/** Single-occurrence action messages from the server that are safe to show as written. */
const OCCURRENCE_ACTION_MESSAGES = [
  /^You can only move chores that are assigned to you\.$/,
  /^Only a chore that is still to do can be (moved|skipped|reassigned)\.$/,
  /^Choose a day to move this chore to\.$/,
  /^Choose today or a later day\.$/,
  /^You can move your chore up to 7 days before or after its original day\.$/,
  /^This chore is already scheduled on that day\.$/,
  /^The selected due date has a cancelled assignment\. Choose another due date\.$/,
  /^Only household owners and admins can (skip|restore|reassign) a chore\.$/,
  /^Only a skipped chore can be restored\.$/,
  /^This day has passed, so the skip can't be undone\.$/,
  /^Turn this chore back on before restoring a skipped day\.$/,
  /^This day is no longer part of the chore's schedule\.$/,
  /^Choose one person for this chore\.$/,
  /^Choose between 1 and \d+ people for this chore\.$/,
  /^Everyone you choose must be a current household member\.$/,
  /^Assignment was not found in this household\.$/,
  /^A When needed chore can't be (moved|skipped)\.$/,
  /^This chore has already moved on to its next one, so the skip can't be undone\.$/,
  /^Choose someone in this chore's rotation\.$/,
]

/** Completing and flagging household jobs ("After it's done" and "When needed"). */
const JOB_MESSAGES = [
  /^Already done by [^\n]{1,80}\.$/,
  /^Already flagged at \d{1,2}:\d{2} (AM|PM)\.$/,
  /^Only people in this chore's rotation can complete it\.$/,
  /^Only a When needed chore can be flagged\.$/,
  /^This chore is already done\.$/,
  /^Assignment was not found in this household\.$/,
]

/** Household Board messages from the server that are safe to show as written. */
const BOARD_MESSAGES = [
  /^Household was not found\.$/,
  /^This post is no longer on the board\.$/,
  /^Enter what's happening\.$/,
  /^Keep it to 120 characters\.$/,
  /^Details can be at most 2000 characters\.$/,
  /^Choose Event, Problem or Heads-up\.$/,
  /^Choose a date for this event\.$/,
  /^Choose today or a later date\.$/,
  /^Add a start time first\.$/,
  /^The end time must be after the start time\.$/,
  /^Only owners and admins can pin posts\.$/,
  /^Choose who gets a notification\.$/,
  /^Pick at least one person to notify\.$/,
  /^Everyone you pick must be a current household member\.$/,
  /^Only the person who posted it or an owner or admin can (edit this post|delete this post|send a reminder)\.$/,
  /^This post is in Past and can't be (edited|confirmed|reminded about) anymore\.$/,
  /^[^\n]{1,80} is already handling it\.$/,
  /^Only a problem can be (handled|marked fixed)\.$/,
  /^This problem is already fixed\.$/,
  /^Already fixed by [^\n]{1,80}\.$/,
  /^Already reminded at \d{1,2}:\d{2} (AM|PM)\.$/,
  /^Everyone has seen this post\.$/,
  /^Send at most 100 posts at a time\.$/,
  // Lists
  /^This list is no longer on the board\.$/,
  /^This item is no longer on the list\.$/,
  /^This item is already bought\.$/,
  /^Enter a name for the list\.$/,
  /^Keep list names to 40 characters\.$/,
  /^There's already a list called [^\n]{1,40}\.$/,
  /^You can have at most 20 lists\. Archive one to make room\.$/,
  /^Shopping can't be (renamed|archived)\.$/,
  /^Enter an item\.$/,
  /^Keep items to 80 characters\.$/,
  /^Keep the note to 60 characters\.$/,
  /^[^\n]{1,80} is already on this list\.$/,
  /^This action isn't available\.$/,
  /^You can post one urgent post an hour\. Try again at \d{1,2}:\d{2} (AM|PM)\.$/,
]

/** Notification settings the server checks when they're saved. */
const PREFERENCE_MESSAGES = new Set([
  "Quiet hours can't start and end at the same time.",
  "Both quiet hours start and end must be provided.",
])

/** Chore type settings checked when a chore is saved. */
const CHORE_KIND_MESSAGES = new Set([
  "An end date doesn't apply to this chore type.",
  "A number of times doesn't apply to this chore type.",
  "Choose how long after it's done the next one is due.",
  "Choose between 1 and 365 days after it's done.",
  "Choose between 1 and 52 weeks after it's done.",
  "Choose the first due date.",
  '"Do at least every" only applies to When needed chores.',
  "An interval after it's done doesn't apply to When needed chores.",
  'Choose "at least every" between 1 and 30 days.',
  "A When needed chore either rotates or has one fixed person.",
  "Choose who does this chore: one fixed person, random, or a rotation.",
  "This chore type is done by one person at a time.",
  "This schedule never produces a date. Check its start date and active months.",
  "Choose either an end date or a number of times, not both.",
  "Schedule end date cannot be before its start date.",
])

function messageFor(
  status: number,
  path: string,
  payload?: unknown,
  method: HttpMethod = "GET",
): string {
  if (
    status === 400 &&
    method === "PUT" &&
    /^\/api\/households\/[^/]+\/chores\/[^/]+$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    payload.message ===
      "A recurring chore with existing assignment history cannot be converted to one-time. Create a separate one-time chore to preserve its history."
  ) {
    return "This chore has recurring assignment history and can't be changed to a one-time chore. Keep its recurring schedule or create a new one-time chore."
  }
  if (
    status === 400 &&
    (method === "POST" || method === "PUT") &&
    /^\/api\/households\/[^/]+\/chores(\/[^/]+)?$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    payload.message === "Every selected participant must be an ACTIVE member of this household."
  ) {
    return "Someone you picked is no longer in the household. Check Who and try again."
  }
  if (
    status === 400 &&
    (method === "POST" || method === "PUT") &&
    /^\/api\/households\/[^/]+\/chores(\/[^/]+)?$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    (payload.message === "FIXED assignment requires exactly People Needed distinct members." ||
      payload.message === "Rotation and random pools must contain at least People Needed members.")
  ) {
    return "Not enough people are picked for how many do it each time. Check Who and try again."
  }
  if (
    (status === 400 || status === 404) &&
    /^\/api\/households\/[^/]+\/assignments\/[^/]+\/(move|skip|unskip|assignees)$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    OCCURRENCE_ACTION_MESSAGES.some((pattern) => pattern.test(payload.message as string))
  ) {
    return payload.message
  }
  if (
    (status === 400 || status === 403 || status === 404 || status === 409) &&
    /^\/api\/households\/[^/]+\/assignments\/[^/]+\/(complete|flag)$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    JOB_MESSAGES.some((pattern) => pattern.test(payload.message as string))
  ) {
    return payload.message
  }
  if (
    (status === 400 || status === 403 || status === 404 || status === 409) &&
    /^\/api\/households\/[^/]+\/board(\/.*)?$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    BOARD_MESSAGES.some((pattern) => pattern.test(payload.message as string))
  ) {
    return payload.message
  }
  if (
    status === 400 &&
    method === "PUT" &&
    path === "/api/notifications/preferences" &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    PREFERENCE_MESSAGES.has(payload.message)
  ) {
    return payload.message
  }
  if (
    status === 400 &&
    (method === "POST" || method === "PUT") &&
    /^\/api\/households\/[^/]+\/chores(\/[^/]+)?$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    CHORE_KIND_MESSAGES.has(payload.message)
  ) {
    return payload.message
  }
  if (
    (status === 400 || status === 404 || status === 409) &&
    /^\/api\/households\/[^/]+\/chore-categories(\/[^/]+)?$/.test(path) &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    CATEGORY_MESSAGES.has(payload.message)
  ) {
    return payload.message
  }
  if (status === 429 && (path === "/api/auth/login" || path === "/api/auth/google/link")) {
    return "Too many sign-in attempts. Please wait and try again, or reset your password."
  }
  if (status === 429 && path.startsWith("/api/auth/email-verification/")) {
    return "Please wait before trying again."
  }
  if (
    status === 400 &&
    (path === "/api/auth/email-verification/verify" ||
      path === "/api/auth/email-verification/recovery/complete") &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    payload.message === "The verification code is invalid or expired."
  ) {
    return payload.message
  }
  if (
    status === 400 &&
    path === "/api/auth/email-verification/recovery/complete" &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    payload.message === "Your new password must be different from your current password."
  ) {
    return payload.message
  }
  if (
    status === 409 &&
    path === "/api/auth/email-verification/correct-email" &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    payload.message ===
      "This email address cannot be changed automatically. Please contact DirtyDuty support."
  ) {
    return payload.message
  }
  if (
    status === 400 &&
    path === "/api/auth/password-reset/confirm" &&
    payload !== null &&
    typeof payload === "object" &&
    "message" in payload &&
    payload.message === "Your new password must be different from your current password."
  ) {
    return payload.message
  }
  if (status === 401 && path === "/api/auth/login") return "Invalid email or password"
  if (status === 401 && path === "/api/auth/logout") {
    return "Unable to confirm sign out. Your session may still be active."
  }
  if (status === 400 && path === "/api/auth/change-password") {
    return "Your current password is incorrect or the new password is not valid."
  }
  if (status === 400 && path === "/api/auth/password-reset/confirm") {
    return "This reset link is invalid or expired. Request a new one."
  }
  if (status === 400 && path === "/api/auth/delete-account") {
    return "We couldn't delete this account. Check your password and email confirmation."
  }
  if (status === 400 && path === "/api/auth/legal-acceptance") {
    return "Please accept the Terms of Service and acknowledge the Privacy Policy."
  }
  if (status === 401) return "Your session could not be verified. Please sign in again."
  if (status === 400 && path === "/api/households/join") {
    return "Invite code is invalid or no longer available."
  }
  if (status === 403 && path.startsWith("/api/households")) {
    return "You are not authorized to perform this household action."
  }
  if (status === 403) return "Your security token expired. Please try again."
  if (status === 409 && path === "/api/auth/register")
    return "Unable to complete registration with this email. If you've registered before, try signing in or recovering your account."
  if (status === 409 && path === "/api/auth/delete-account") return "You still own households."
  if (status === 409 && path === "/api/households/join")
    return "You are already a member of this household."
  if (status === 409) return "This request conflicts with the current state."
  if (status >= 400 && status < 500) return "Please check your information and try again."
  return "Something went wrong. Please try again."
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return null

  try {
    return await response.json()
  } catch {
    return null
  }
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET"
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set("Content-Type", "application/json")

  if (method !== "GET") {
    const csrf = await getCsrfToken()
    headers.set(csrf.headerName, csrf.token)
  }

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: "include",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError("Unable to connect to DirtyDuty. Please try again.", null, "network")
  }

  if (!response.ok) {
    if (response.status === 403) csrfState = null
    const payload = await readPayload(response)
    throw new ApiError(
      messageFor(response.status, path, payload, method),
      response.status,
      errorKind(response.status),
      payload,
    )
  }

  const payload = await readPayload(response)
  return payload as T
}

export async function getCsrfToken(): Promise<CsrfResponse> {
  if (csrfState) return csrfState

  let response: Response
  try {
    response = await fetch(apiUrl("/api/auth/csrf"), { credentials: "include" })
  } catch {
    throw new ApiError("Unable to connect to DirtyDuty. Please try again.", null, "network")
  }

  const payload = response.ok ? await readPayload(response) : null
  if (
    !response.ok ||
    !payload ||
    typeof payload !== "object" ||
    !("token" in payload) ||
    !("headerName" in payload)
  ) {
    throw new ApiError(
      messageFor(response.status, "/api/auth/csrf"),
      response.status,
      errorKind(response.status),
    )
  }

  csrfState = {
    token: String(payload.token),
    headerName: String(payload.headerName),
  }
  return csrfState
}

export function clearCsrfToken() {
  csrfState = null
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
}
