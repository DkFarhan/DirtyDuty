// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import styles from "./my-chores-screen-view.module.css"
import { MyChoresDesignPreview } from "./my-chores-design-preview"
import { myChoresPreviewFixture } from "./my-chores-preview-fixtures"
import {
  MyChoresScreenView,
  type MyChoresScreenViewProps,
  type MyChoresViewModel,
} from "./my-chores-screen-view"

function renderScreen({
  viewModel = myChoresPreviewFixture,
  ...overrides
}: Partial<Omit<MyChoresScreenViewProps, "viewModel">> & {
  viewModel?: MyChoresViewModel
} = {}) {
  const props: MyChoresScreenViewProps = {
    theme: "dark",
    tab: "upcoming",
    activeDestination: "my-chores",
    viewModel,
    onSelectTab: vi.fn(),
    onCompleteChore: vi.fn(),
    onRetry: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  }
  return render(<MyChoresScreenView {...props} />)
}

describe("MyChoresScreenView", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    window.history.replaceState({}, "", "/")
  })

  it("renders the verified Upcoming hierarchy and the complete nine-item list", () => {
    const { container } = renderScreen()

    expect(screen.getByRole("heading", { name: "My chores." })).toBeTruthy()
    expect(screen.getByText("YOUR ROUTINE / THE COMMON ROOM")).toBeTruthy()
    expect(screen.getByText("Kitchen Floor")).toBeTruthy()
    expect(screen.getByText("Washroom")).toBeTruthy()
    expect(screen.getByText("9 MORE ON YOUR LIST")).toBeTruthy()
    const laundryCard = container.querySelector('[data-chore-id="preview-laundry"]')
    expect(laundryCard?.textContent).toContain("Assigned to You, Sam")
    expect(laundryCard?.textContent).toContain("About 35 min")
    expect(container.querySelectorAll("[data-chore-id^='preview-']")).toHaveLength(10)
    expect(container.querySelectorAll(`.${styles.upcomingCard}`)).toHaveLength(9)
  })

  it("renders exact theme classes and Figma asset slots without reading app theme state", () => {
    const { container, rerender } = renderScreen({ theme: "light" })

    expect(container.firstElementChild?.getAttribute("data-preview-theme")).toBe("light")
    for (const selector of [
      styles.headerPlane,
      styles.headerBloom,
      styles.headerFade,
      styles.attentionBath,
      styles.attentionClock,
      styles.attentionCheck,
      styles.categoryGlyph,
      styles.priorityIndicator,
      styles.listCheck,
      styles.navigationIcon,
    ]) {
      expect(container.querySelector(`.${selector}`)).not.toBeNull()
    }
    expect(container.querySelectorAll(`.${styles.categoryGlyph}`)).toHaveLength(9)
    expect(container.querySelectorAll(`.${styles.navigationIcon}`)).toHaveLength(4)

    rerender(
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={vi.fn()}
        onSelectTab={vi.fn()}
        tab="upcoming"
        theme="dark"
        viewModel={myChoresPreviewFixture}
      />,
    )
    expect(container.firstElementChild?.getAttribute("data-preview-theme")).toBe("dark")
  })

  it("applies the selected tab styling consistently in both themes", () => {
    const { rerender } = renderScreen()

    for (const theme of ["dark", "light"] as const) {
      for (const tab of ["upcoming", "completed"] as const) {
        rerender(
          <MyChoresScreenView
            activeDestination="my-chores"
            onCompleteChore={vi.fn()}
            onNavigate={vi.fn()}
            onRetry={vi.fn()}
            onSelectTab={vi.fn()}
            tab={tab}
            theme={theme}
            viewModel={myChoresPreviewFixture}
          />,
        )

        for (const value of ["upcoming", "completed"] as const) {
          const element = screen.getByRole("tab", {
            name: value === "upcoming" ? "Upcoming" : "Completed",
          })
          expect(element.getAttribute("aria-selected")).toBe(String(tab === value))
          expect(element.classList.contains(styles.selectedTab)).toBe(tab === value)
        }
      }
    }
  })

  it("selects Completed with explicit counts, attribution, and no completion controls", () => {
    const onSelectTab = vi.fn()
    const { rerender } = renderScreen({
      onSelectTab,
      tab: "completed",
    })

    expect(screen.getByRole("heading", { name: "Three things, taken care of." })).toBeTruthy()
    expect(screen.getAllByText("Completed by Salman")).toHaveLength(3)
    expect(screen.getByText("Small wins add up.")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Complete/ })).toBeNull()

    fireEvent.click(screen.getByRole("tab", { name: "Upcoming" }))
    expect(onSelectTab).toHaveBeenCalledWith("upcoming")

    rerender(
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={vi.fn()}
        onSelectTab={vi.fn()}
        tab="completed"
        theme="light"
        viewModel={myChoresPreviewFixture}
      />,
    )
    expect(screen.getByRole("tab", { name: "Completed" }).getAttribute("aria-selected")).toBe(
      "true",
    )
  })

  it("keeps denied and cancelled assignments visible without offering completion", () => {
    const { container } = renderScreen({
      viewModel: {
        ...myChoresPreviewFixture,
        attentionChore: null,
        upcomingChores: [
          {
            ...myChoresPreviewFixture.upcomingChores[0],
            title: "Not completable",
            canComplete: false,
          },
          {
            ...myChoresPreviewFixture.upcomingChores[1],
            title: "Cancelled chore",
            status: "CANCELLED",
            canComplete: true,
          },
        ],
      },
    })

    expect(container.querySelector("#assignment-preview-kitchen-floor")).not.toBeNull()
    expect(screen.getByText("Not completable")).toBeTruthy()
    expect(screen.getByText("Cancelled chore")).toBeTruthy()
    expect(screen.getByText("Cancelled")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Complete Not completable" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Complete Cancelled chore" })).toBeNull()
  })

  it("renders empty Upcoming and Completed variants", () => {
    const { rerender } = renderScreen({
      viewModel: {
        ...myChoresPreviewFixture,
        attentionChore: null,
        upcomingChores: [],
      },
    })
    expect(screen.getByRole("heading", { name: "All caught up." })).toBeTruthy()
    expect(screen.getByText("No chores waiting. Enjoy the breathing room.")).toBeTruthy()
    expect(screen.getByText("0")).toBeTruthy()

    rerender(
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={vi.fn()}
        onSelectTab={vi.fn()}
        tab="completed"
        theme="light"
        viewModel={{ ...myChoresPreviewFixture, completedChores: [] }}
      />,
    )
    expect(screen.getByRole("heading", { name: "A fresh start." })).toBeTruthy()
    expect(screen.getByText("Your completed chore history begins here.")).toBeTruthy()
  })

  it("renders loading, load-failed, and retained-data refresh-error states", () => {
    const onRetry = vi.fn()
    const { rerender, container } = renderScreen({
      viewModel: { ...myChoresPreviewFixture, status: "loading" },
      onRetry,
    })
    expect(screen.getByRole("status", { name: "Loading my chores" })).toBeTruthy()
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true")

    rerender(
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={onRetry}
        onSelectTab={vi.fn()}
        tab="upcoming"
        theme="dark"
        viewModel={{
          ...myChoresPreviewFixture,
          status: "error",
          errorMessage: "Try again later.",
        }}
      />,
    )
    expect(screen.getByRole("alert").textContent).toBe("Try again later.")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={onRetry}
        onSelectTab={vi.fn()}
        tab="upcoming"
        theme="light"
        viewModel={{
          ...myChoresPreviewFixture,
          refreshError: "Refresh failed; showing saved chores.",
        }}
      />,
    )
    expect(screen.getByRole("alert").textContent).toBe("Refresh failed; showing saved chores.")
    expect(container.querySelectorAll(`.${styles.upcomingCard}`)).toHaveLength(9)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it("wires chore completion, pending state, tab, retry, and navigation callbacks", () => {
    const onCompleteChore = vi.fn()
    const onSelectTab = vi.fn()
    const onNavigate = vi.fn()
    const { rerender } = renderScreen({ onCompleteChore, onSelectTab, onNavigate })

    fireEvent.click(screen.getByRole("button", { name: "Complete Kitchen Floor" }))
    expect(onCompleteChore).toHaveBeenCalledWith("preview-kitchen-floor")
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }))
    expect(onSelectTab).toHaveBeenCalledWith("completed")
    for (const [label, destination] of [
      ["Home", "home"],
      ["My Chores", "my-chores"],
      ["Household", "household"],
      ["Profile", "profile"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }))
      expect(onNavigate).toHaveBeenLastCalledWith(destination)
    }

    rerender(
      <MyChoresScreenView
        activeDestination="my-chores"
        onCompleteChore={onCompleteChore}
        onNavigate={onNavigate}
        onRetry={vi.fn()}
        onSelectTab={onSelectTab}
        tab="upcoming"
        theme="dark"
        viewModel={{
          ...myChoresPreviewFixture,
          completingIds: ["preview-kitchen-floor"],
        }}
      />,
    )
    const pendingButton = screen.getByRole("button", { name: "Completing Kitchen Floor" })
    expect(pendingButton.hasAttribute("disabled")).toBe(true)
    expect(pendingButton.getAttribute("aria-busy")).toBe("true")
  })

  it("simulates a completion locally and adds its attribution to the Completed tab", async () => {
    vi.useFakeTimers()
    render(<MyChoresDesignPreview />)

    fireEvent.click(screen.getByRole("button", { name: "Complete Kitchen Floor" }))
    expect(screen.getByRole("button", { name: "Completing Kitchen Floor" })).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(850)
    })
    expect(screen.queryByText("Kitchen Floor")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }))
    expect(screen.getByText("Kitchen Floor")).toBeTruthy()
    expect(screen.getByText("Completed by You")).toBeTruthy()
  })

  it("keeps the fixed navigation outside the scroll container and marks My Chores active", () => {
    const { container } = renderScreen()
    const main = screen.getByRole("main")
    const navigation = screen.getByRole("navigation", { name: "Preview navigation" })

    expect(main.hasAttribute("data-scroll-container")).toBe(true)
    expect(main.nextElementSibling).toBe(navigation)
    expect(navigation.parentElement).toBe(container.firstElementChild)
    expect(screen.getByRole("button", { name: "My Chores" }).getAttribute("aria-current")).toBe(
      "page",
    )
    expect(styles.scrollContent).toBeTruthy()
  })

  it("switches the preview-local theme and hides controls in capture mode", () => {
    window.history.replaceState({}, "", "?theme=dark")
    render(<MyChoresDesignPreview />)

    expect(document.querySelector('[data-preview-theme="dark"]')).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Light" }))
    expect(document.querySelector('[data-preview-theme="light"]')).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Dark" }))
    expect(document.querySelector('[data-preview-theme="dark"]')).toBeTruthy()

    cleanup()
    window.history.replaceState({}, "", "?theme=light&capture=1")
    render(<MyChoresDesignPreview />)
    expect(document.querySelector('[data-preview-theme="light"]')).toBeTruthy()
    expect(screen.queryByLabelText("My Chores design preview controls")).toBeNull()
  })
})
