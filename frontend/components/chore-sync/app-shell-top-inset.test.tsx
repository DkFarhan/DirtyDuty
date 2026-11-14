// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HouseholdRefreshNotice, ScreenTopInset } from "./app-shell"

const households = vi.hoisted(() => ({
  error: null as string | null,
  status: "has-households" as string,
  refresh: vi.fn(() => Promise.resolve([])),
}))

vi.mock("@/lib/household/household-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/household/household-context")>()
  return { ...actual, useHouseholds: () => households }
})

function renderShellTop() {
  return render(
    <>
      <HouseholdRefreshNotice />
      <ScreenTopInset>
        <p>Screen</p>
      </ScreenTopInset>
    </>,
  )
}

describe("app shell top inset", () => {
  afterEach(() => {
    cleanup()
    households.error = null
    households.status = "has-households"
  })

  it("leaves the screen's own top inset in place when no refresh banner is shown", () => {
    renderShellTop()

    expect(screen.queryByRole("alert")).toBeNull()
    const wrapper = screen.getByTestId("screen-top-inset")
    expect(wrapper.style.display).toBe("contents")
    expect(wrapper.style.getPropertyValue("--app-safe-top")).toBe("")
  })

  it("removes the screen's top inset below the refresh banner, which clears the status bar itself", () => {
    households.error = "Unable to refresh your households."
    renderShellTop()

    const banner = screen.getByRole("alert")
    expect(banner.textContent).toContain("Unable to refresh your households.")
    expect(banner.className).toContain("pt-[calc(0.5rem+env(safe-area-inset-top))]")
    expect(screen.getByTestId("screen-top-inset").style.getPropertyValue("--app-safe-top")).toBe(
      "0px",
    )
  })

  it.each(["loading", "error"])(
    "keeps the screen inset while the full-page %s state owns the household error",
    (status) => {
      households.error = "Unable to load your households. Please try again."
      households.status = status
      renderShellTop()

      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.getByTestId("screen-top-inset").style.getPropertyValue("--app-safe-top")).toBe(
        "",
      )
    },
  )
})
