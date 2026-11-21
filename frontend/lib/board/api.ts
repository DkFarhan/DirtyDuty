import { api } from "@/lib/auth/api"

export type BoardPostType = "EVENT" | "PROBLEM" | "HEADS_UP"
export type NotifyMode = "EVERYONE" | "PICKED" | "NONE"

export type BoardReader = {
  userId: string
  displayName: string
  author: boolean
  seenAt: string | null
  gotItAt: string | null
}

export type BoardViewer = {
  author: boolean
  seen: boolean
  gotIt: boolean
  /** A PICKED post that notifies the viewer. */
  forYou: boolean
  canEdit: boolean
  canDelete: boolean
  canRemind: boolean
  remindedAt: string | null
  /** Set while Remind is cooling down (2 hours after the last one). */
  remindAgainAt: string | null
}

export type BoardPost = {
  id: string
  type: BoardPostType
  title: string
  details: string | null
  /** "YYYY-MM-DD", events only. */
  eventDate: string | null
  /** "HH:mm" or "HH:mm:ss", events only. */
  startTime: string | null
  endTime: string | null
  pinned: boolean
  notifyMode: NotifyMode
  recipientUserIds: string[]
  authorUserId: string | null
  /** "Former member" once the author has left. */
  authorDisplayName: string
  handlerUserId: string | null
  handlerDisplayName: string | null
  fixedAt: string | null
  fixedByDisplayName: string | null
  pastAt: string | null
  editedAt: string | null
  createdAt: string
  seenCount: number
  gotItCount: number
  /** Active members other than the author. */
  audienceCount: number
  readers: BoardReader[]
  viewer: BoardViewer
}

export type BoardMember = { userId: string; displayName: string; role: string }

export type Board = {
  posts: BoardPost[]
  pastCount: number
  unseenCount: number
  viewerIsAdmin: boolean
  members: BoardMember[]
}

export type BoardPostInput = {
  type: BoardPostType
  title: string
  details: string | null
  eventDate: string | null
  startTime: string | null
  endTime: string | null
  pinned: boolean
  notifyMode: NotifyMode
  recipientUserIds: string[]
}

const base = (householdId: string) => `/api/households/${householdId}/board`
const post = (householdId: string, postId: string) => `${base(householdId)}/posts/${postId}`

export const boardApi = {
  board: (householdId: string) => api.get<Board>(base(householdId)),
  past: (householdId: string) => api.get<BoardPost[]>(`${base(householdId)}/past`),
  unseen: (householdId: string) => api.get<{ unseenCount: number }>(`${base(householdId)}/unseen`),
  get: (householdId: string, postId: string) => api.get<BoardPost>(post(householdId, postId)),
  create: (householdId: string, input: BoardPostInput) =>
    api.post<BoardPost>(`${base(householdId)}/posts`, input),
  update: (householdId: string, postId: string, input: BoardPostInput) =>
    api.put<BoardPost>(post(householdId, postId), input),
  remove: (householdId: string, postId: string) => api.delete<void>(post(householdId, postId)),
  seen: (householdId: string, postIds: string[]) =>
    api.post<void>(`${base(householdId)}/seen`, { postIds }),
  gotIt: (householdId: string, postId: string) =>
    api.post<BoardPost>(`${post(householdId, postId)}/got-it`),
  handle: (householdId: string, postId: string) =>
    api.post<BoardPost>(`${post(householdId, postId)}/handle`),
  release: (householdId: string, postId: string) =>
    api.post<BoardPost>(`${post(householdId, postId)}/release`),
  fix: (householdId: string, postId: string) =>
    api.post<BoardPost>(`${post(householdId, postId)}/fix`),
  remind: (householdId: string, postId: string) =>
    api.post<BoardPost>(`${post(householdId, postId)}/remind`),
}
