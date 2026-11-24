import { describe, expect, it } from "vitest"
import {
  cardRequestView,
  clockLabel,
  handoffOptions,
  handoffSummary,
  memberHint,
  requestItem,
  requestMenuItems,
  swapGroups,
  swapSummary,
  type ChoreRequestDTO,
  type RequestCandidates,
} from "./requests"
import type { AssignmentRequests } from "./chores"

const zone = "America/Halifax"

const candidates: RequestCandidates = {
  canHandOff: true,
  canSwap: true,
  anyoneEligible: true,
  members: [
    { userId: "r", displayName: "Rubayet", eligible: true, awayUntil: null, choresThatDay: [] },
    {
      userId: "a",
      displayName: "Abubakar",
      eligible: true,
      awayUntil: null,
      choresThatDay: ["Laundry"],
    },
    // Away Thu Nov 26 to Sun Nov 29.
    {
      userId: "s",
      displayName: "Sam",
      eligible: false,
      awayUntil: "2026-11-29",
      choresThatDay: [],
    },
  ],
  swaps: [
    {
      userId: "r",
      displayName: "Rubayet",
      occurrences: [
        {
          id: "o1",
          choreId: "c1",
          title: "Take out garbage",
          categoryIcon: "trash",
          kind: "CALENDAR",
          scheduledFor: "2026-11-23",
          dueAt: "2026-11-24T00:00:00Z",
        },
        {
          id: "o2",
          choreId: "c2",
          title: "Clean bathroom",
          categoryIcon: "bathroom",
          kind: "CALENDAR",
          scheduledFor: "2026-11-28",
          dueAt: null,
        },
      ],
    },
    { userId: "a", displayName: "Abubakar", occurrences: [] },
  ],
  expiresAt: "2026-11-26T22:00:00Z",
  headsUpAt: "2026-11-26T20:00:00Z",
}

describe("S1 menu", () => {
  const requests = (patch: Partial<AssignmentRequests>): AssignmentRequests => ({
    canAsk: true,
    canSwap: true,
    passTurn: false,
    open: null,
    note: null,
    ...patch,
  })

  it("offers asking and swapping, or only passing a When needed turn", () => {
    expect(requestMenuItems(requests({})).map((item) => item.title)).toEqual([
      "Ask someone to take it",
      "Swap with someone",
    ])
    expect(
      requestMenuItems(requests({ canSwap: false, passTurn: true })).map((item) => item.title),
    ).toEqual(["Pass my turn"])
    expect(requestMenuItems(requests({ canAsk: false }))).toEqual([])
    expect(requestMenuItems(null)).toEqual([])
  })
})

describe("S2 who should take it", () => {
  it("hints who is free, who has a chore, and who is away", () => {
    expect(
      handoffOptions(candidates).map((option) => [option.name, option.hint, option.disabled]),
    ).toEqual([
      ["Rubayet", "Free that day", false],
      ["Abubakar", "Has Laundry that day", false],
      ["Sam", "Away until Sun · can't be asked", true],
    ])
    expect(
      memberHint({ ...candidates.members[1], choresThatDay: ["Laundry", "Dishes", "Bins"] }),
    ).toBe("Has Laundry +2 that day")
  })

  it("says when the heads-up comes, and leaves it out under two hours", () => {
    expect(handoffSummary(candidates, zone)).toBe(
      "It stays yours until someone accepts. If nobody has by 4 PM Thu, we'll let you know.",
    )
    expect(handoffSummary({ ...candidates, headsUpAt: null }, zone)).toBe(
      "It stays yours until someone accepts.",
    )
    expect(handoffSummary({ ...candidates, headsUpAt: null }, zone, true)).toBe(
      "It stays your turn until someone accepts.",
    )
  })

  it("writes times the way the cards do", () => {
    expect(clockLabel("2026-11-26T22:00:00Z", zone)).toBe("6 PM")
    expect(clockLabel("2026-11-26T22:30:00Z", zone)).toBe("6:30 PM")
  })
})

describe("S3 swap for which chore", () => {
  it("groups their chores by person and lists only people with chores to swap", () => {
    const groups = swapGroups(candidates, zone)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe("Rubayet")
    expect(groups[0].options.map((option) => [option.title, option.detail])).toEqual([
      ["Take out garbage", "Mon, Nov 23 · by 8 PM"],
      ["Clean bathroom", "Sat, Nov 28"],
    ])
  })

  it("sums up the trade", () => {
    expect(
      swapSummary(
        { title: "Wash dishes", scheduledFor: "2026-11-26" },
        { title: "Clean bathroom", scheduledFor: "2026-11-28" },
        "Rubayet",
      ),
    ).toBe("You do Clean bathroom on Sat. Rubayet does Wash dishes on Thu.")
  })
})

describe("S4 requests for you", () => {
  const base: ChoreRequestDTO = {
    id: "q1",
    type: "HANDOFF",
    status: "OPEN",
    requester: { userId: "f", displayName: "Farhan" },
    target: null,
    occurrence: {
      id: "o9",
      choreId: "c9",
      title: "Wash dishes",
      categoryIcon: "dishes",
      kind: "CALENDAR",
      scheduledFor: "2026-11-26",
      dueAt: "2026-11-26T22:00:00Z",
    },
    swapOccurrence: null,
    expiresAt: "2026-11-26T22:00:00Z",
    createdAt: "2026-11-22T12:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
  }

  it("words a hand-off, a swap and a passed turn", () => {
    expect(requestItem(base, zone)).toMatchObject({
      name: "Farhan",
      initial: "F",
      sentence: " asks if you can take Wash dishes",
      detail: "Thu, Nov 26 by 6 PM",
      acceptLabel: "Take it",
    })
    const swap: ChoreRequestDTO = {
      ...base,
      type: "SWAP",
      requester: { userId: "r", displayName: "Rubayet" },
      occurrence: { ...base.occurrence, title: "Clean bathroom", scheduledFor: "2026-11-28" },
      swapOccurrence: { ...base.occurrence, title: "Wash dishes", scheduledFor: "2026-11-26" },
    }
    expect(requestItem(swap, zone)).toMatchObject({
      sentence: " wants to swap",
      detail: "You do Clean bathroom (Sat), Rubayet does Wash dishes (Thu)",
      acceptLabel: "Swap",
    })
    const turn: ChoreRequestDTO = {
      ...base,
      occurrence: { ...base.occurrence, kind: "AS_NEEDED", title: "Toilet paper", dueAt: null },
    }
    expect(requestItem(turn, zone)).toMatchObject({
      sentence: " asks if you can take their turn for Toilet paper",
      detail: "Whenever it's needed",
    })
  })
})

describe("card chip and note", () => {
  const open = (waitingFor: { userId: string; displayName: string } | null, mine = true) => ({
    canAsk: false,
    canSwap: false,
    passTurn: false,
    open: {
      id: "q1",
      type: "HANDOFF" as const,
      mine,
      waitingFor,
      requester: { userId: "f", displayName: "Farhan" },
    },
    note: null,
  })

  it("shows who the requester is waiting for, with Cancel request", () => {
    expect(cardRequestView({ status: "PENDING", requests: open(null) })).toEqual({
      waitingLabel: "Waiting for anyone to take it",
      noteLabel: null,
      noteKind: null,
      cancelRequestId: "q1",
    })
    expect(
      cardRequestView({
        status: "PENDING",
        requests: open({ userId: "r", displayName: "Rubayet" }),
      })?.waitingLabel,
    ).toBe("Waiting for Rubayet")
    // Someone else's request on a chore I'm swapping into shows nothing on my card.
    expect(cardRequestView({ status: "PENDING", requests: open(null, false) })).toBeUndefined()
  })

  it("notes who it was taken over from or swapped with", () => {
    const note = (type: "TAKEN_OVER" | "SWAPPED") => ({
      canAsk: true,
      canSwap: true,
      passTurn: false,
      open: null,
      note: { type, with: { userId: "f", displayName: "Farhan" } },
    })
    expect(cardRequestView({ status: "PENDING", requests: note("TAKEN_OVER") })?.noteLabel).toBe(
      "Taken over from Farhan",
    )
    expect(cardRequestView({ status: "PENDING", requests: note("SWAPPED") })?.noteLabel).toBe(
      "Swapped with Farhan",
    )
    expect(cardRequestView({ status: "COMPLETED", requests: note("SWAPPED") })).toBeUndefined()
  })
})
