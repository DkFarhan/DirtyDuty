// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Board, BoardPost } from "@/lib/board/api"

const mocks = vi.hoisted(() => ({
  board: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  seen: vi.fn(),
  remind: vi.fn(),
  gotIt: vi.fn(),
  navigate: vi.fn(),
  openBoardPost: vi.fn(),
  startChoreDraft: vi.fn(),
  invalidate: vi.fn(),
  role: "OWNER",
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    state: { currentUser: { id: "me" } },
    navigate: mocks.navigate,
    editingBoardPostId: null,
    boardPostId: "post-1",
    boardPostReturn: "board",
    openBoardPost: mocks.openBoardPost,
    openBoardPostForm: vi.fn(),
    startChoreDraft: mocks.startChoreDraft,
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    activeHousehold: {
      id: "home-1",
      name: "Apt 1501",
      timezone: "UTC",
      currentUserRole: mocks.role,
    },
  }),
}))

vi.mock("@/lib/board/api", () => ({
  boardApi: {
    board: mocks.board,
    get: mocks.get,
    create: mocks.create,
    update: mocks.update,
    seen: mocks.seen,
    remind: mocks.remind,
    gotIt: mocks.gotIt,
  },
}))

vi.mock("@/lib/data-sync/data-sync-context", () => ({
  householdBoardResource: (id: string) => `${id}:board`,
  useDataSync: () => ({ invalidate: mocks.invalidate, revision: 0 }),
}))

import { BoardPostFormScreen } from "../screens/board-post-form-screen"
import { BoardPostScreen } from "../screens/board-post-screen"
import { BoardScreenView } from "./board-screen-view"
import { groupBoard } from "@/lib/board/board-view"

const members = [
  { userId: "me", displayName: "Farhan", role: "OWNER" },
  { userId: "ana", displayName: "Ana", role: "MEMBER" },
  { userId: "sam", displayName: "Sam", role: "MEMBER" },
]

function boardWith(posts: BoardPost[] = [], viewerIsAdmin = true): Board {
  return { posts, pastCount: 0, unseenCount: 0, viewerIsAdmin, members }
}

function eventPost(patch: Partial<BoardPost> = {}): BoardPost {
  return {
    id: "post-1",
    type: "EVENT",
    title: "Pest control visit",
    details: "Clear under the sinks.",
    eventDate: "2026-11-26",
    startTime: "10:00:00",
    endTime: "12:00:00",
    pinned: false,
    notifyMode: "EVERYONE",
    recipientUserIds: [],
    authorUserId: "me",
    authorDisplayName: "Farhan",
    handlerUserId: null,
    handlerDisplayName: null,
    fixedAt: null,
    fixedByDisplayName: null,
    pastAt: null,
    editedAt: null,
    createdAt: "2026-11-23T09:00:00Z",
    seenCount: 1,
    gotItCount: 1,
    audienceCount: 3,
    readers: [
      { userId: "me", displayName: "Farhan", author: true, seenAt: null, gotItAt: null },
      {
        userId: "ru",
        displayName: "Rubayet",
        author: false,
        seenAt: "2026-11-23T09:20:00Z",
        gotItAt: "2026-11-23T09:20:00Z",
      },
      {
        userId: "ana",
        displayName: "Ana",
        author: false,
        seenAt: "2026-11-23T09:50:00Z",
        gotItAt: null,
      },
      { userId: "sam", displayName: "Sam", author: false, seenAt: null, gotItAt: null },
    ],
    viewer: {
      author: true,
      seen: true,
      gotIt: false,
      forYou: false,
      canEdit: true,
      canDelete: true,
      canRemind: true,
      remindedAt: null,
      remindAgainAt: null,
    },
    ...patch,
  }
}

const titleInput = () => screen.getByLabelText("What's happening?") as HTMLInputElement
const row = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}:`) })

async function renderForm() {
  render(<BoardPostFormScreen theme="dark" />)
  await screen.findByLabelText("What's happening?", undefined, { timeout: 5_000 })
}

describe("Board", () => {
  beforeEach(() => {
    // Monday, November 23 2026, 10 AM UTC.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-23T10:00:00Z"))
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function") mock.mockReset()
    }
    mocks.role = "OWNER"
    mocks.board.mockResolvedValue(boardWith())
    mocks.create.mockResolvedValue(eventPost())
    mocks.seen.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("creates an event from a suggestion chip", async () => {
    await renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Pest control visit" }))

    expect(titleInput().value).toBe("Pest control visit")
    expect(screen.getByRole("button", { name: "Event" }).getAttribute("aria-pressed")).toBe("true")
    expect((screen.getByLabelText(/Details/) as HTMLTextAreaElement).value).toContain("sinks")

    fireEvent.click(row("When"))
    const sheet = screen.getByRole("dialog", { name: "When is it?" })
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2026-11-26" } })
    fireEvent.click(within(sheet).getByRole("switch", { name: /All day/ }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }))
    expect(row("When").textContent).toContain("Thu, Nov 26 · 10 AM")
    expect(screen.getByTestId("board-post-summary").textContent).toBe(
      "Everyone gets it now, then a reminder Wed evening and Thu morning.",
    )

    fireEvent.click(screen.getByRole("button", { name: "Post" }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())
    expect(mocks.create.mock.calls[0]).toEqual([
      "home-1",
      {
        type: "EVENT",
        title: "Pest control visit",
        details: "Clear under the kitchen and bathroom sinks the night before.",
        eventDate: "2026-11-26",
        startTime: "10:00",
        endTime: null,
        pinned: false,
        notifyMode: "EVERYONE",
        recipientUserIds: [],
      },
    ])
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("board"))
  })

  it("notifies only the people picked, and needs at least one", async () => {
    await renderForm()
    fireEvent.change(titleInput(), { target: { value: "Package for Ana at the door" } })
    fireEvent.click(row("Type"))
    fireEvent.click(screen.getByRole("radio", { name: /Heads-up/ }))

    fireEvent.click(row("Notify"))
    let sheet = screen.getByRole("dialog", { name: "Who gets a notification?" })
    // The author isn't offered: they are never notified.
    expect(within(sheet).queryByRole("checkbox", { name: /Farhan/ })).toBeNull()
    fireEvent.click(within(sheet).getByRole("radio", { name: /Pick people/ }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }))
    expect(within(sheet).getByRole("alert").textContent).toBe("Pick at least one person.")
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Ana/ }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }))

    expect(row("Notify").textContent).toContain("Ana")
    expect(screen.getByTestId("board-post-summary").textContent).toBe(
      "Only Ana gets a notification. Everyone can still see it on the board for 7 days.",
    )
    fireEvent.click(row("Notify"))
    sheet = screen.getByRole("dialog", { name: "Who gets a notification?" })
    expect(within(sheet).getByRole("checkbox", { name: /Ana/ }).getAttribute("aria-checked")).toBe(
      "true",
    )
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }))

    fireEvent.click(screen.getByRole("button", { name: "Post" }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())
    expect(mocks.create.mock.calls[0][1]).toMatchObject({
      type: "HEADS_UP",
      notifyMode: "PICKED",
      recipientUserIds: ["ana"],
    })
  })

  it("shows who got it, saw it or hasn't, and reminds the rest once", async () => {
    mocks.get.mockResolvedValue(eventPost())
    mocks.remind.mockResolvedValue(
      eventPost({
        viewer: {
          ...eventPost().viewer,
          remindedAt: "2026-11-23T10:00:00Z",
          remindAgainAt: "2026-11-23T12:00:00Z",
        },
      }),
    )
    render(<BoardPostScreen theme="dark" />)
    const seenCard = (
      await screen.findByRole("heading", { name: "Seen by 1 of 3" }, { timeout: 5_000 })
    ).closest("section")!
    const status = (name: string) => within(seenCard).getByText(name).closest("li")!.textContent
    expect(status("Farhan")).toContain("Posted")
    expect(status("Rubayet")).toContain("Got it · 40 min ago")
    expect(status("Ana")).toContain("Seen · 10 min ago")
    expect(status("Sam")).toContain("Not seen yet")

    fireEvent.click(within(seenCard).getByRole("button", { name: "Remind Sam" }))
    await waitFor(() => expect(mocks.remind).toHaveBeenCalledWith("home-1", "post-1"))
    const sent = await within(seenCard).findByRole("button", { name: /Reminder sent/ })
    expect(sent.getAttribute("aria-disabled")).toBe("true")
    expect(within(seenCard).getByText(/You can remind Sam again at 12:00 PM\./)).toBeTruthy()
    // The author doesn't confirm their own post.
    expect(screen.queryByRole("button", { name: /Got it/ })).toBeNull()
  })

  it("hides Pin and Make it a chore from members", async () => {
    mocks.role = "MEMBER"
    mocks.board.mockResolvedValue(boardWith([], false))
    await renderForm()
    fireEvent.change(titleInput(), { target: { value: "Guests staying" } })
    expect(screen.queryByRole("switch", { name: /Pin to house info/ })).toBeNull()
    cleanup()

    const notMine = eventPost({
      authorUserId: "ana",
      viewer: {
        ...eventPost().viewer,
        author: false,
        canEdit: false,
        canDelete: false,
        canRemind: false,
      },
    })
    mocks.get.mockResolvedValue(notMine)
    render(<BoardPostScreen theme="light" />)
    await screen.findByRole("heading", { name: "Seen by 1 of 3" }, { timeout: 5_000 })
    expect(screen.queryByRole("button", { name: /Make it a chore/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Delete post/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Got it/ })).toBeTruthy()
    cleanup()

    const view = (viewerIsAdmin: boolean) =>
      render(
        <BoardScreenView
          busyIds={[]}
          feedback={null}
          groups={groupBoard([notMine])}
          householdName="Apt 1501"
          onCompose={vi.fn()}
          onFix={vi.fn()}
          onGotIt={vi.fn()}
          onMakeChore={vi.fn()}
          onNavigate={vi.fn()}
          onOpenPast={vi.fn()}
          onOpenPost={vi.fn()}
          onRetry={vi.fn()}
          pastCount={0}
          status="loaded"
          theme="dark"
          unseenCount={0}
          viewerIsAdmin={viewerIsAdmin}
        />,
      )
    view(false)
    expect(screen.queryByRole("button", { name: /Make it a chore/ })).toBeNull()
    cleanup()
    view(true)
    expect(screen.getByRole("button", { name: /Make it a chore/ })).toBeTruthy()

    // Owners and admins can pin.
    cleanup()
    mocks.role = "OWNER"
    mocks.board.mockResolvedValue(boardWith([], true))
    await renderForm()
    fireEvent.change(titleInput(), { target: { value: "Wi-Fi password" } })
    expect(screen.getByRole("switch", { name: /Pin to house info/ })).toBeTruthy()
  })
})
