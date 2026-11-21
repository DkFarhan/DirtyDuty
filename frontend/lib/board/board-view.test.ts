import { describe, expect, it } from "vitest"
import type { BoardPost } from "./api"
import {
  eventEyebrow,
  groupBoard,
  homeBoardRows,
  readerStatus,
  remindLabel,
  seenByLabel,
} from "./board-view"

const NOW = new Date("2026-11-23T10:00:00Z")

function post(patch: Partial<BoardPost> & { id: string }): BoardPost {
  return {
    type: "HEADS_UP",
    title: patch.id,
    details: null,
    eventDate: null,
    startTime: null,
    endTime: null,
    pinned: false,
    notifyMode: "EVERYONE",
    recipientUserIds: [],
    authorUserId: "ana",
    authorDisplayName: "Ana",
    handlerUserId: null,
    handlerDisplayName: null,
    fixedAt: null,
    fixedByDisplayName: null,
    pastAt: null,
    editedAt: null,
    createdAt: "2026-11-23T09:00:00Z",
    seenCount: 1,
    gotItCount: 0,
    audienceCount: 2,
    readers: [],
    viewer: {
      author: false,
      seen: true,
      gotIt: false,
      forYou: false,
      canEdit: false,
      canDelete: false,
      canRemind: false,
      remindedAt: null,
      remindAgainAt: null,
    },
    ...patch,
  }
}

const unseen = (base: BoardPost): BoardPost => ({
  ...base,
  viewer: { ...base.viewer, seen: false },
})

describe("board grouping", () => {
  it("puts pinned posts under House info and sorts each section", () => {
    const groups = groupBoard([
      post({ id: "wifi", pinned: true, type: "PROBLEM" }),
      post({ id: "leak", type: "PROBLEM", createdAt: "2026-11-21T09:00:00Z" }),
      post({ id: "fixed", type: "PROBLEM", fixedAt: "2026-11-22T09:00:00Z" }),
      post({ id: "late", type: "EVENT", eventDate: "2026-11-27", startTime: "18:00:00" }),
      post({ id: "early", type: "EVENT", eventDate: "2026-11-27", startTime: "09:00:00" }),
      post({ id: "all-day", type: "EVENT", eventDate: "2026-11-25" }),
      post({ id: "older", createdAt: "2026-11-20T09:00:00Z" }),
      post({ id: "newer", createdAt: "2026-11-22T09:00:00Z" }),
      post({ id: "gone", pastAt: "2026-11-22T00:00:00Z" }),
    ])
    expect(groups.houseInfo.map((p) => p.id)).toEqual(["wifi"])
    expect(groups.needsFixing.map((p) => p.id)).toEqual(["leak"])
    expect(groups.comingUp.map((p) => p.id)).toEqual(["all-day", "early", "late"])
    expect(groups.headsUps.map((p) => p.id)).toEqual(["newer", "older"])
  })

  it("gives Home the next event, open problems and unseen heads-ups, at most four", () => {
    const rows = homeBoardRows(
      [
        post({ id: "later", type: "EVENT", eventDate: "2026-11-30" }),
        unseen(post({ id: "next", type: "EVENT", eventDate: "2026-11-24", startTime: "10:00:00" })),
        post({ id: "leak", type: "PROBLEM", handlerDisplayName: "Ben", handlerUserId: "ben" }),
        post({ id: "seen-note" }),
        unseen(post({ id: "new-note" })),
        unseen(post({ id: "another" })),
        unseen(post({ id: "one-too-many", createdAt: "2026-11-20T00:00:00Z" })),
      ],
      "UTC",
      NOW,
    )
    expect(rows.map((row) => row.post.id)).toEqual(["next", "leak", "new-note", "another"])
    expect(rows[0]).toMatchObject({ subtitle: "Tomorrow 10 AM · seen by 1 of 2", unseen: true })
    expect(rows[1].subtitle).toBe("Ben is handling it")
    expect(homeBoardRows([post({ id: "seen-note" })], "UTC", NOW)).toEqual([])
  })

  it("labels events, seen counts, readers and Remind", () => {
    const event = unseen(
      post({
        id: "pest",
        type: "EVENT",
        eventDate: "2026-11-27",
        startTime: "10:00:00",
        endTime: "12:00:00",
      }),
    )
    expect(eventEyebrow(event)).toBe("NEW · 10 AM–12 PM")
    expect(seenByLabel(event)).toBe("Seen by 1 of 2")
    const now = NOW.getTime()
    expect(
      readerStatus(
        { userId: "a", displayName: "A", author: true, seenAt: null, gotItAt: null },
        now,
      ).label,
    ).toBe("Posted")
    expect(
      readerStatus(
        {
          userId: "b",
          displayName: "B",
          author: false,
          seenAt: "2026-11-23T09:20:00Z",
          gotItAt: "2026-11-23T09:20:00Z",
        },
        now,
      ).label,
    ).toBe("Got it · 40 min ago")
    expect(
      readerStatus(
        {
          userId: "c",
          displayName: "C",
          author: false,
          seenAt: "2026-11-23T09:50:00Z",
          gotItAt: null,
        },
        now,
      ).label,
    ).toBe("Seen · 10 min ago")
    expect(
      readerStatus(
        { userId: "d", displayName: "D", author: false, seenAt: null, gotItAt: null },
        now,
      ).label,
    ).toBe("Not seen yet")
    const readers = [
      { userId: "ana", displayName: "Ana", author: true, seenAt: null, gotItAt: null },
      { userId: "sam", displayName: "Sam", author: false, seenAt: null, gotItAt: null },
      {
        userId: "ben",
        displayName: "Ben",
        author: false,
        seenAt: "2026-11-23T09:00:00Z",
        gotItAt: null,
      },
    ]
    expect(remindLabel(post({ id: "x", readers }))).toBe("Remind Sam")
    expect(remindLabel(post({ id: "y", readers: readers.slice(0, 1) }))).toBeNull()
    const both = [
      ...readers,
      { userId: "ru", displayName: "Rubayet", author: false, seenAt: null, gotItAt: null },
    ]
    expect(remindLabel(post({ id: "z", readers: both }))).toBe("Remind Sam and Rubayet")
    // A PICKED post reminds only the picked people.
    expect(
      remindLabel(post({ id: "p", readers: both, notifyMode: "PICKED", recipientUserIds: ["ru"] })),
    ).toBe("Remind Rubayet")
  })
})
