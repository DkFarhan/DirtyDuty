// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LaunchExperience } from "./launch-experience"

describe("launch experience", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("shows the approved background and all four exported brand layers", () => {
    render(
      <LaunchExperience isReady={false}>
        <button type="button">App content</button>
      </LaunchExperience>,
    )

    const splash = screen.getByRole("status", { name: "Starting DirtyDuty" })
    expect(within(splash).queryByText("DirtyDuty")).toBeNull()
    expect(within(splash).queryByText("Keep your home running smoothly")).toBeNull()
    expect(splash.className).toBeTruthy()
    expect(splash.querySelector('img[src="/brand/dirtyduty-splash-mark-dark.svg"]')).toBeTruthy()
    expect(splash.querySelector('img[src="/brand/dirtyduty-splash-mark-green.svg"]')).toBeTruthy()
    expect(splash.querySelector('img[src="/brand/dirtyduty-splash-wordmark.svg"]')).toBeTruthy()
    expect(splash.querySelector('img[src="/brand/dirtyduty-splash-tagline.svg"]')).toBeTruthy()
    expect(screen.queryByRole("button", { name: "App content" })).toBeNull()
  })

  it("keeps a fast startup splash for at least 900ms, then fades out", async () => {
    render(
      <LaunchExperience isReady>
        <button type="button">App content</button>
      </LaunchExperience>,
    )

    expect(screen.getByRole("status", { name: "Starting DirtyDuty" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "App content" })).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(899)
    })
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" }).className).not.toContain(
      "exiting",
    )
    expect(screen.queryByRole("button", { name: "App content" })).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" }).className).toContain(
      "exiting",
    )
    expect(screen.queryByRole("button", { name: "App content" })).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(179)
    })
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.queryByRole("status", { name: "Starting DirtyDuty" })).toBeNull()
    expect(screen.getByRole("button", { name: "App content" })).toBeTruthy()
  })

  it("stays visible beyond 900ms until startup is ready", async () => {
    const view = render(
      <LaunchExperience isReady={false}>
        <button type="button">App content</button>
      </LaunchExperience>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200)
    })
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" }).className).not.toContain(
      "exiting",
    )
    expect(screen.queryByRole("button", { name: "App content" })).toBeNull()

    view.rerender(
      <LaunchExperience isReady>
        <button type="button">App content</button>
      </LaunchExperience>,
    )
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" }).className).toContain(
      "exiting",
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })
    expect(screen.queryByRole("status", { name: "Starting DirtyDuty" })).toBeNull()
    expect(screen.getByRole("button", { name: "App content" })).toBeTruthy()
  })

  it("does not show the splash again when app content changes after startup", async () => {
    const view = render(
      <LaunchExperience isReady>
        <button type="button">Home screen</button>
      </LaunchExperience>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180)
    })

    view.rerender(
      <LaunchExperience isReady>
        <button type="button">Profile screen</button>
      </LaunchExperience>,
    )
    expect(screen.queryByRole("status", { name: "Starting DirtyDuty" })).toBeNull()
    expect(screen.getByRole("button", { name: "Profile screen" })).toBeTruthy()
  })
})
