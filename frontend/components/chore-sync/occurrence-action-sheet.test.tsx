// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AssignmentDTO, OccurrenceActions } from "@/lib/household/chores"

const mocks = vi.hoisted(() => ({ options: vi.fn() }))
vi.mock("@/lib/household/chores", () => ({ choreApi: { options: mocks.options } }))

import { OccurrenceActionSheet } from "./occurrence-action-sheet"

const allActions: OccurrenceActions = {
  canMove: true,
  canSkip: true,
  canUnskip: false,
  canReassign: true,
  moveEarliest: "2026-11-11",
  moveLatest: null,
  maxAssignees: 1,
}

function occurrence(overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return {
    id: "occurrence-1",
    householdId: "home-1",
    choreId: "chore-1",
    categoryName: "Kitchen",
    categoryIcon: "kitchen",
    title: "Kitchen clean-up",
    scheduledFor: "2026-11-18",
    dueAt: "2026-11-18T18:00:00Z",
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 2,
    estimatedMinutes: null,
    assignees: [{ userId: "ana", displayName: "Ana" }],
    canComplete: false,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    originalDate: null,
    moved: false,
    reassigned: false,
    actions: allActions,
    ...overrides,
  }
}

function renderSheet(assignment: AssignmentDTO) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  render(
    <OccurrenceActionSheet
      assignment={assignment}
      householdId="home-1"
      householdTimezone="UTC"
      onClose={onClose}
      onSubmit={onSubmit}
      theme="light"
    />,
  )
  return { onSubmit, onClose, dialog: screen.getByRole("dialog", { name: "Kitchen clean-up" }) }
}

describe("OccurrenceActionSheet", () => {
  beforeEach(() => {
    mocks.options.mockReset().mockResolvedValue({
      categories: [],
      activeMembers: [
        { userId: "ana", displayName: "Ana" },
        { userId: "ben", displayName: "Ben" },
        { userId: "cy", displayName: "Cy" },
      ],
    })
  })

  afterEach(() => cleanup())

  it("lists only the actions the server allows this viewer", () => {
    const { dialog } = renderSheet(
      occurrence({
        actions: { ...allActions, canSkip: false, canReassign: false },
      }),
    )
    const items = within(dialog)
      .getAllByRole("listitem")
      .map((item) => item.textContent)
    expect(items).toEqual(["Move to another day"])
  })

  it("offers only Undo skip on a skipped day and submits it", () => {
    const { dialog, onSubmit } = renderSheet(
      occurrence({
        status: "SKIPPED",
        actions: {
          ...allActions,
          canMove: false,
          canSkip: false,
          canReassign: false,
          canUnskip: true,
        },
      }),
    )
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Undo skip"])
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo skip" }))
    expect(onSubmit).toHaveBeenCalledWith({ kind: "unskip" })
  })

  it("limits a move to the allowed window and keeps the time unless it is changed", () => {
    const { dialog, onSubmit } = renderSheet(
      occurrence({
        actions: {
          ...allActions,
          canSkip: false,
          canReassign: false,
          moveEarliest: "2026-11-11",
          moveLatest: "2026-11-25",
        },
      }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to another day" }))
    const day = within(dialog).getByLabelText("Day") as HTMLInputElement
    expect(day.min).toBe("2026-11-11")
    expect(day.max).toBe("2026-11-25")
    expect(day.value).toBe("2026-11-18")
    expect(within(dialog).getByText("You can choose Wed, Nov 11 to Wed, Nov 25.")).toBeTruthy()

    fireEvent.change(day, { target: { value: "2026-11-26" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("Choose Wed, Nov 25 or earlier.")
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(day, { target: { value: "2026-11-20" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))
    expect(onSubmit).toHaveBeenLastCalledWith({ kind: "move", date: "2026-11-20", time: null })

    fireEvent.change(within(dialog).getByLabelText("Due time"), { target: { value: "09:30" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))
    expect(onSubmit).toHaveBeenLastCalledWith({ kind: "move", date: "2026-11-20", time: "09:30" })
  })

  it("asks before skipping", () => {
    const { dialog, onSubmit } = renderSheet(occurrence())
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip this day" }))
    expect(dialog.textContent).toContain(
      "Skip Kitchen clean-up on Wed, Nov 18? It still counts as Ana's turn.",
    )
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip this day" }))
    const confirm = within(dialog).getAllByRole("button", { name: "Skip this day" }).at(-1)!
    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledWith({ kind: "skip" })
  })

  it("lets a reassign choose no more people than the chore needs", async () => {
    const { dialog, onSubmit } = renderSheet(
      occurrence({ actions: { ...allActions, maxAssignees: 2 } }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign this day" }))
    const ben = await within(dialog).findByRole("button", { name: "Ben" })
    const cy = within(dialog).getByRole("button", { name: "Cy" })
    fireEvent.click(ben)
    expect(within(dialog).getByText("2 of 2 chosen")).toBeTruthy()
    fireEvent.click(cy)
    expect(cy.getAttribute("aria-pressed")).toBe("false")
    expect(cy.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "reassign",
      assignees: [
        { userId: "ana", displayName: "Ana" },
        { userId: "ben", displayName: "Ben" },
      ],
    })
  })

  it("treats a one-person chore's member list as a single choice", async () => {
    const { dialog, onSubmit } = renderSheet(occurrence())
    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign this day" }))
    const ben = await within(dialog).findByRole("radio", { name: "Ben" })
    fireEvent.click(ben)
    expect(within(dialog).getByRole("radio", { name: "Ana" }).getAttribute("aria-checked")).toBe(
      "false",
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "reassign",
      assignees: [{ userId: "ben", displayName: "Ben" }],
    })
  })

  it("closes on Escape", async () => {
    const { onClose } = renderSheet(occurrence())
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
