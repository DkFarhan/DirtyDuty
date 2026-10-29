// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HomeDesignPreview } from "./home-design-preview"
import { createEmptyHomePreviewFixture, homePreviewFixture } from "./home-preview-fixtures"
import styles from "./home-screen-view.module.css"
import {
  HomeScreenView,
  type HomeNavigationDestination,
  type HomeScreenViewModel,
  type HomeVisualTheme,
} from "./home-screen-view"

function renderHome({
  theme = "dark",
  viewModel = homePreviewFixture,
  onCompleteChore = vi.fn(),
  onRetry = vi.fn(),
  onOpenNotifications = vi.fn(),
  onNavigate = vi.fn(),
}: {
  theme?: HomeVisualTheme
  viewModel?: HomeScreenViewModel
  onCompleteChore?: (choreId: string) => void
  onRetry?: () => void
  onOpenNotifications?: () => void
  onNavigate?: (destination: HomeNavigationDestination) => void
} = {}) {
  return render(
    <HomeScreenView
      activeDestination="home"
      onCompleteChore={onCompleteChore}
      onNavigate={onNavigate}
      onOpenNotifications={onOpenNotifications}
      onRetry={onRetry}
      theme={theme}
      viewModel={viewModel}
    />,
  )
}

describe("HomeScreenView", () => {
  afterEach(cleanup)

  it("renders the verified Home fixture hierarchy and sample values", () => {
    renderHome()

    expect(screen.getByRole("heading", { name: "Alex." })).toBeTruthy()
    expect(screen.getByText("The Common Room")).toBeTruthy()
    expect(screen.getByText("1 of 4 chores completed")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Tiny rescue mission." })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy()
    expect(screen.getByText("No chores due today.")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Up next" })).toBeTruthy()
    expect(screen.getByText("Kitchen Floor")).toBeTruthy()
  })

  it("switches the preview-local visual theme without relying on app theme state", () => {
    const { rerender, container } = renderHome()
    const rerenderTheme = (theme: HomeVisualTheme) =>
      rerender(
        <HomeScreenView
          activeDestination="home"
          onCompleteChore={vi.fn()}
          onNavigate={vi.fn()}
          onOpenNotifications={vi.fn()}
          onRetry={vi.fn()}
          theme={theme}
          viewModel={homePreviewFixture}
        />,
      )

    expect(container.firstElementChild?.getAttribute("data-preview-theme")).toBe("dark")
    rerenderTheme("light")
    expect(container.firstElementChild?.getAttribute("data-preview-theme")).toBe("light")
  })

  it("renders the approved Figma asset layers in their component slots", () => {
    const { container } = renderHome({ theme: "light" })
    const assetSlots = [
      styles.backgroundAtmosphereCyan,
      styles.backgroundAtmosphereTwilight,
      styles.notificationGlass,
      styles.bellIcon,
      styles.notificationBadgeArt,
      styles.avatarGlass,
      styles.avatarRim,
      styles.avatarArt,
      styles.householdGlyph,
      styles.householdAmbient,
      styles.orbitTrack,
      styles.orbitProgress25,
      styles.orbitCenter,
      styles.orbitGlint,
      styles.durationClock,
      styles.completeIcon,
      styles.todayCheckArt,
      styles.timelineStop,
    ]

    for (const assetSlot of assetSlots) {
      expect(container.querySelector(`.${assetSlot}`)).not.toBeNull()
    }
    expect(container.querySelectorAll(`.${styles.navigationIcon}`)).toHaveLength(4)
  })

  it("renders loading and recoverable error states", () => {
    const loading = { ...homePreviewFixture, status: "loading" as const }
    const { rerender } = renderHome({ viewModel: loading })
    expect(screen.getByRole("status", { name: "Loading home overview" })).toBeTruthy()

    rerender(
      <HomeScreenView
        activeDestination="home"
        onCompleteChore={vi.fn()}
        onNavigate={vi.fn()}
        onOpenNotifications={vi.fn()}
        onRetry={vi.fn()}
        theme="dark"
        viewModel={{
          ...homePreviewFixture,
          status: "error",
          errorMessage: "Dashboard is unavailable.",
        }}
      />,
    )
    expect(screen.getByRole("alert").textContent).toBe("Dashboard is unavailable.")
  })

  it("shows empty attention, today, and upcoming states", () => {
    renderHome({ viewModel: createEmptyHomePreviewFixture() })

    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull()
    expect(screen.getByText("No chores due today.")).toBeTruthy()
    expect(screen.getByText("Nothing else is coming up this week.")).toBeTruthy()
  })

  it("wires completion, notification, retry, and navigation actions", () => {
    const onCompleteChore = vi.fn()
    const onRetry = vi.fn()
    const onOpenNotifications = vi.fn()
    const onNavigate = vi.fn()
    renderHome({ onCompleteChore, onRetry, onOpenNotifications, onNavigate })

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }))
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 18 unread" }))
    fireEvent.click(screen.getByRole("button", { name: "Household" }))
    expect(onCompleteChore).toHaveBeenCalledWith("preview-washroom")
    expect(onOpenNotifications).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith("household")

    cleanup()
    renderHome({
      onRetry,
      viewModel: { ...homePreviewFixture, status: "error", errorMessage: "Retry required." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("switches between both modes with the preview controls", () => {
    render(<HomeDesignPreview />)

    expect(document.querySelector('[data-preview-theme="dark"]')).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Light" }))
    expect(document.querySelector('[data-preview-theme="light"]')).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Dark" }))
    expect(document.querySelector('[data-preview-theme="dark"]')).toBeTruthy()
  })

  it("keeps the scrollable main and fixed navigation in separate layers", () => {
    renderHome()

    const scrollContent = screen.getByRole("main")
    const navigation = screen.getByRole("navigation", { name: "Preview navigation" })

    expect(scrollContent.hasAttribute("data-scroll-container")).toBe(true)
    expect(scrollContent.nextElementSibling).toBe(navigation)
    expect(scrollContent.parentElement).toBe(navigation.parentElement)
  })
})
