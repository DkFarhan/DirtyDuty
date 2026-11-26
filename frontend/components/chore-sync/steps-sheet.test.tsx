// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"
import type { AssignmentDTO } from "@/lib/household/chores"
import { stepsChip } from "@/lib/household/steps"
import { StepsChip } from "./steps-sheet"
import { useChoreSteps } from "./use-chore-steps"

const mocks = vi.hoisted(() => ({ tickStep: vi.fn() }))

vi.mock("@/lib/household/chores", async (original) => ({
  ...(await original<typeof import("@/lib/household/chores")>()),
  choreApi: { tickStep: mocks.tickStep },
}))

const farhan = { userId: "user-1", displayName: "Farhan" }
const rubayet = { userId: "user-2", displayName: "Rubayet" }

function assignment(overrides: Partial<AssignmentDTO> = {}): AssignmentDTO {
  return {
    id: "a-1",
    householdId: "home-1",
    choreId: "chore-1",
    categoryName: "Bathroom",
    categoryIcon: null,
    title: "Clean bathroom",
    scheduledFor: "2026-11-14",
    dueAt: "2026-11-14T22:00:00Z",
    status: "PENDING",
    priority: "NORMAL",
    difficulty: 3,
    estimatedMinutes: null,
    assignees: [farhan, rubayet],
    canComplete: true,
    completedAt: null,
    completedByDisplayName: null,
    overdue: false,
    steps: {
      total: 3,
      ticked: 1,
      canTick: true,
      items: [
        {
          id: "s-1",
          text: "Mirror",
          ticked: true,
          tickedBy: rubayet,
          tickedAt: "2026-11-14T18:14:00Z",
        },
        { id: "s-2", text: "Sink", ticked: false, tickedBy: null, tickedAt: null },
        { id: "s-3", text: "Floor", ticked: false, tickedBy: null, tickedAt: null },
      ],
    },
    ...overrides,
  }
}

const complete = vi.fn()

function Harness({ initial }: { initial: AssignmentDTO }) {
  const [current, setCurrent] = useState(initial)
  const ref = useRef(current)
  const steps = useChoreSteps({
    householdId: "home-1",
    householdTimezone: "America/Halifax",
    viewer: farhan,
    theme: "dark",
    find: (id) => (ref.current.id === id ? ref.current : null),
    apply: (next) => {
      ref.current = next
      setCurrent(next)
    },
    complete,
    isCompleting: () => false,
  })
  return (
    <main>
      <article data-occurrence-card={current.id}>
        <StepsChip
          chip={stepsChip(current)}
          onOpen={() => steps.openSteps(current.id)}
          title={current.title}
        />
        <button onClick={() => steps.requestComplete(current.id)} type="button">
          Mark complete
        </button>
      </article>
      {steps.elements}
    </main>
  )
}

const sheet = () => screen.getByRole("dialog", { name: "Clean bathroom" })
const stepRow = (name: string) => within(sheet()).getByRole("checkbox", { name: new RegExp(name) })

describe("checklist tick sheet", () => {
  beforeEach(() => {
    mocks.tickStep.mockReset()
    complete.mockReset()
  })
  afterEach(cleanup)

  it("opens from the chip with every step and who ticked it on a group chore", async () => {
    render(<Harness initial={assignment()} />)
    fireEvent.click(screen.getByRole("button", { name: "Steps for Clean bathroom: 1 of 3 steps" }))
    expect(within(sheet()).getAllByRole("checkbox")).toHaveLength(3)
    expect(stepRow("Mirror").getAttribute("aria-checked")).toBe("true")
    expect(within(sheet()).getByText("Rubayet · 2:14 PM")).toBeTruthy()
    expect(within(sheet()).getByRole("button", { name: "I did it" })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(stepRow("Mirror")))
  })

  it("leaves out who ticked on a chore one person does", () => {
    render(<Harness initial={assignment({ assignees: [farhan] })} />)
    fireEvent.click(screen.getByTestId("steps-chip"))
    expect(within(sheet()).queryByText(/Rubayet ·/)).toBeNull()
  })

  it("ticks at once, keeps the server's answer, and puts a failed tick back with an error", async () => {
    const saved = assignment()
    mocks.tickStep.mockResolvedValueOnce({
      ...saved,
      steps: {
        ...saved.steps!,
        ticked: 2,
        items: saved.steps!.items!.map((item) =>
          item.id === "s-2"
            ? { ...item, ticked: true, tickedBy: farhan, tickedAt: "2026-11-14T18:20:00Z" }
            : item,
        ),
      },
    })
    render(<Harness initial={saved} />)
    fireEvent.click(screen.getByTestId("steps-chip"))
    fireEvent.click(stepRow("Sink"))
    expect(stepRow("Sink").getAttribute("aria-checked")).toBe("true")
    expect(mocks.tickStep).toHaveBeenCalledWith("home-1", "a-1", "s-2", true)
    await waitFor(() => expect(within(sheet()).getByText("You · 2:20 PM")).toBeTruthy())
    expect(screen.getByTestId("steps-chip").textContent).toBe("2 of 3 steps")

    mocks.tickStep.mockRejectedValueOnce(
      new ApiError("Only the people doing this chore can tick its steps.", 403, "forbidden"),
    )
    fireEvent.click(stepRow("Floor"))
    expect(stepRow("Floor").getAttribute("aria-checked")).toBe("true")
    expect(
      await within(sheet()).findByText("Only the people doing this chore can tick its steps."),
    ).toBeTruthy()
    expect(stepRow("Floor").getAttribute("aria-checked")).toBe("false")
    expect(stepRow("Sink").getAttribute("aria-checked")).toBe("true")
  })

  it("can't be ticked by someone who isn't doing it", () => {
    const view = assignment({ canComplete: false })
    render(<Harness initial={{ ...view, steps: { ...view.steps!, canTick: false } }} />)
    fireEvent.click(screen.getByTestId("steps-chip"))
    expect((stepRow("Sink") as HTMLButtonElement).disabled).toBe(true)
    expect(
      within(sheet()).getByText("Only the people doing this chore can tick its steps."),
    ).toBeTruthy()
    expect(within(sheet()).queryByRole("button", { name: "I did it" })).toBeNull()
  })

  it("asks once before marking done with steps unticked", () => {
    render(<Harness initial={assignment()} />)
    fireEvent.click(screen.getByTestId("steps-chip"))
    fireEvent.click(within(sheet()).getByRole("button", { name: "I did it" }))
    const confirm = screen.getByRole("alertdialog", {
      name: "2 steps not ticked. Mark done anyway?",
    })
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
    expect(complete).not.toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).toBeNull()

    // The card's own button asks too.
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }))
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }))
    expect(complete).toHaveBeenCalledWith("a-1", "card")
    expect(complete).toHaveBeenCalledOnce()
  })

  it("completes straight away when every step is ticked or there are none", () => {
    const done = assignment()
    render(
      <Harness
        initial={{
          ...done,
          steps: {
            ...done.steps!,
            ticked: 3,
            items: done.steps!.items!.map((item) => ({ ...item, ticked: true, tickedBy: farhan })),
          },
        }}
      />,
    )
    expect(screen.getByTestId("steps-chip").getAttribute("data-complete")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(complete).toHaveBeenCalledOnce()
    cleanup()

    render(<Harness initial={assignment({ steps: null })} />)
    expect(screen.queryByTestId("steps-chip")).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Mark complete" }))
    })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it("shows a done chore's counts quietly, not as a button", () => {
    render(
      <StepsChip
        chip={stepsChip(
          assignment({
            status: "COMPLETED",
            steps: { total: 5, ticked: 4, canTick: false, items: null },
          }),
        )}
        onOpen={() => undefined}
        title="Clean bathroom"
      />,
    )
    const chip = screen.getByTestId("steps-chip")
    expect(chip.tagName).toBe("P")
    expect(chip.textContent).toBe("4 of 5 steps")
  })
})
