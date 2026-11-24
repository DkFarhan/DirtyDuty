// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HomeScreenView } from "./redesign/home-screen-view"
import { createEmptyHomePreviewFixture } from "./redesign/home-preview-fixtures"
import { MyChoresScreenView } from "./redesign/my-chores-screen-view"
import { createMyChoresScenario } from "./redesign/my-chores-preview-fixtures"

const owner = { canManage: true, adding: false, error: null }
const member = { canManage: false, adding: false, error: null }

function renderHome(basics: typeof owner | null, handlers = {}) {
  return render(
    <HomeScreenView
      activeDestination="home"
      onCompleteChore={vi.fn()}
      onNavigate={vi.fn()}
      onOpenNotifications={vi.fn()}
      onRetry={vi.fn()}
      theme="dark"
      viewModel={{ ...createEmptyHomePreviewFixture(), status: "loaded", basics }}
      {...handlers}
    />,
  )
}

describe("Start with the basics", () => {
  afterEach(cleanup)

  it("replaces Home's week and chore sections for a household with no chores", () => {
    const onAddBasics = vi.fn()
    const onMakeOwnChore = vi.fn()
    renderHome(owner, { onAddBasics, onMakeOwnChore })
    const card = screen.getByTestId("start-with-basics")
    expect(within(card).getByRole("heading", { name: "Start with the basics?" })).toBeTruthy()
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Wash dishesEvery day",
      "Take out garbageWhen it's needed",
      "Clean bathroomEvery week",
      "VacuumEvery week",
    ])
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull()
    expect(screen.queryByLabelText("Household weekly progress")).toBeNull()
    fireEvent.click(within(card).getByRole("button", { name: /Add these 4/ }))
    fireEvent.click(within(card).getByRole("button", { name: "I'll make my own" }))
    expect(onAddBasics).toHaveBeenCalledOnce()
    expect(onMakeOwnChore).toHaveBeenCalledOnce()
  })

  it("shows members the card without buttons", () => {
    renderHome(member)
    const card = screen.getByTestId("start-with-basics")
    expect(within(card).queryByRole("button")).toBeNull()
    expect(within(card).getByText("Ask an admin to add chores.")).toBeTruthy()
  })

  it("is gone once the household has a chore", () => {
    renderHome(null)
    expect(screen.queryByTestId("start-with-basics")).toBeNull()
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy()
  })

  it("replaces My Chores' empty states", () => {
    const empty = createMyChoresScenario("empty-upcoming")
    const view = (basics: typeof owner | null, tab: "upcoming" | "completed") => (
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={vi.fn()}
        onSelectTab={vi.fn()}
        tab={tab}
        theme="light"
        viewModel={{ ...empty, completedChores: [], basics }}
      />
    )
    const { rerender } = render(view(member, "upcoming"))
    expect(screen.getByTestId("start-with-basics")).toBeTruthy()
    rerender(view(member, "completed"))
    expect(screen.getByTestId("start-with-basics")).toBeTruthy()
    rerender(view(null, "upcoming"))
    expect(screen.queryByTestId("start-with-basics")).toBeNull()
  })
})
