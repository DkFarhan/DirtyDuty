// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RequestsCard } from "./requests-card"
import type { RequestItemView } from "@/lib/household/requests"

const handOff: RequestItemView = {
  id: "q1",
  type: "HANDOFF",
  name: "Farhan",
  initial: "F",
  sentence: " asks if you can take Wash dishes",
  detail: "Thu, Nov 27 by 6 PM",
  acceptLabel: "Take it",
}
const swap: RequestItemView = {
  id: "q2",
  type: "SWAP",
  name: "Rubayet",
  initial: "R",
  sentence: " wants to swap",
  detail: "You do Clean bathroom (Sat), Rubayet does Wash dishes (Thu)",
  acceptLabel: "Swap",
}

function renderCard(props: Partial<Parameters<typeof RequestsCard>[0]> = {}) {
  const onAccept = vi.fn()
  const onDecline = vi.fn()
  render(
    <RequestsCard
      busyId={null}
      feedback={null}
      items={[handOff, swap]}
      onAccept={onAccept}
      onDecline={onDecline}
      theme="dark"
      {...props}
    />,
  )
  return { onAccept, onDecline }
}

afterEach(cleanup)

describe("RequestsCard", () => {
  it("is hidden when there is nothing to answer", () => {
    const { container } = render(
      <RequestsCard
        busyId={null}
        feedback={null}
        items={[]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        theme="light"
      />,
    )
    expect(container.innerHTML).toBe("")
  })

  it("lists each request with its count, Take it or Swap, and Decline", () => {
    const { onAccept, onDecline } = renderCard()
    const card = screen.getByRole("region", { name: "Requests for you" })
    expect(within(card).getByLabelText("2 open").textContent).toContain("2")
    const items = within(card).getAllByRole("listitem")
    expect(items[0].textContent).toContain("Farhan asks if you can take Wash dishes")
    expect(items[0].textContent).toContain("Thu, Nov 27 by 6 PM")
    expect(items[1].textContent).toContain(
      "You do Clean bathroom (Sat), Rubayet does Wash dishes (Thu)",
    )

    fireEvent.click(within(items[0]).getByRole("button", { name: "Take it" }))
    fireEvent.click(within(items[1]).getByRole("button", { name: "Swap" }))
    fireEvent.click(within(items[1]).getByRole("button", { name: "Decline" }))
    expect(onAccept).toHaveBeenNthCalledWith(1, "q1")
    expect(onAccept).toHaveBeenNthCalledWith(2, "q2")
    expect(onDecline).toHaveBeenCalledWith("q2")
  })

  it("disables answers while one is in flight", () => {
    renderCard({ busyId: "q1" })
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it("shows an error under its request and a 409 for the whole card", () => {
    renderCard({
      feedback: { requestId: "q2", tone: "error", message: "Unable to answer this request." },
    })
    const items = screen.getAllByRole("listitem")
    expect(within(items[1]).getByRole("alert").textContent).toContain(
      "Unable to answer this request.",
    )

    renderCard({
      items: [],
      feedback: { requestId: null, tone: "error", message: "Already taken by Sam." },
    })
    expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain("Already taken by Sam.")
  })

  it("confirms success inline", () => {
    renderCard({
      items: [swap],
      feedback: { requestId: null, tone: "success", message: "Wash dishes is yours now." },
    })
    expect(screen.getByRole("status").textContent).toContain("Wash dishes is yours now.")
  })
})
