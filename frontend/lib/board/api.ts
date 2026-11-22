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
  /** Open items across the active lists ("To buy"). Absent from older responses. */
  toBuyCount?: number
  /** Home's Shopping row; listId is null until Lists is first opened. */
  shopping?: BoardShoppingSummary
}

export type BoardShoppingSummary = { listId: string | null; openCount: number; todayCount: number }

export type BoardList = {
  id: string
  name: string
  /** Shopping: can't be renamed or archived. */
  defaultList: boolean
  openCount: number
  todayCount: number
  createdAt: string
}

export type BoardLists = { lists: BoardList[]; toBuyCount: number }

export type BoardListItem = {
  id: string
  listId: string
  name: string
  note: string | null
  addedByUserId: string | null
  /** "Former member" once they've left. */
  addedByDisplayName: string
  claimedByUserId: string | null
  claimedByDisplayName: string | null
  /** Flagged for the household's current day. */
  neededToday: boolean
  neededTodayByDisplayName: string | null
  boughtAt: string | null
  boughtByUserId: string | null
  boughtByDisplayName: string | null
  createdAt: string
}

export type BoardListItems = {
  list: BoardList
  /** Needed today first, then oldest first. */
  items: BoardListItem[]
  /** Bought on the household's current day, most recent first. */
  boughtToday: BoardListItem[]
}

export type BoardListItemInput = { name: string; note: string | null }

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
const listItem = (householdId: string, itemId: string) =>
  `${base(householdId)}/list-items/${itemId}`
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

export const boardListApi = {
  lists: (householdId: string) => api.get<BoardLists>(`${base(householdId)}/lists`),
  create: (householdId: string, name: string) =>
    api.post<BoardList>(`${base(householdId)}/lists`, { name }),
  rename: (householdId: string, listId: string, name: string) =>
    api.put<BoardList>(`${base(householdId)}/lists/${listId}`, { name }),
  archive: (householdId: string, listId: string) =>
    api.post<void>(`${base(householdId)}/lists/${listId}/archive`),
  items: (householdId: string, listId: string) =>
    api.get<BoardListItems>(`${base(householdId)}/lists/${listId}/items`),
  add: (householdId: string, listId: string, input: BoardListItemInput) =>
    api.post<{ item: BoardListItem; existing: boolean }>(
      `${base(householdId)}/lists/${listId}/items`,
      input,
    ),
  recentNames: (householdId: string) => api.get<string[]>(`${base(householdId)}/list-items/recent`),
  update: (householdId: string, itemId: string, input: BoardListItemInput) =>
    api.put<BoardListItem>(listItem(householdId, itemId), input),
  remove: (householdId: string, itemId: string) => api.delete<void>(listItem(householdId, itemId)),
  claim: (householdId: string, itemId: string) =>
    api.post<BoardListItem>(`${listItem(householdId, itemId)}/claim`),
  release: (householdId: string, itemId: string) =>
    api.post<BoardListItem>(`${listItem(householdId, itemId)}/release`),
  neededToday: (householdId: string, itemId: string, on: boolean) =>
    on
      ? api.post<BoardListItem>(`${listItem(householdId, itemId)}/today`)
      : api.delete<BoardListItem>(`${listItem(householdId, itemId)}/today`),
  buy: (householdId: string, itemId: string) =>
    api.post<BoardListItem>(`${listItem(householdId, itemId)}/buy`),
  unbuy: (householdId: string, itemId: string) =>
    api.post<BoardListItem>(`${listItem(householdId, itemId)}/unbuy`),
}
