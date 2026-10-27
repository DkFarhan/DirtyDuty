// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HomeInSyncHero } from "./home-in-sync-hero"

const queryStates = new Map<
  string,
  { matches: boolean; listeners: Set<(event: MediaQueryListEvent) => void> }
>()

function setMediaQuery(query: string, matches: boolean) {
  const state = queryStates.get(query)
  if (!state) throw new Error(`Unknown media query: ${query}`)

  state.matches = matches
  const event = new Event("change") as MediaQueryListEvent
  state.listeners.forEach((listener) => listener(event))
}

describe("HomeInSyncHero", () => {
  beforeEach(() => {
    queryStates.clear()
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => {
        let state = queryStates.get(query)
        if (!state) {
          state = { matches: false, listeners: new Set() }
          queryStates.set(query, state)
        }

        return {
          get matches() {
            return state.matches
          },
          media: query,
          onchange: null,
          addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            state.listeners.add(listener)
          },
          removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            state.listeners.delete(listener)
          },
          addListener: (listener: (event: MediaQueryListEvent) => void) => {
            state.listeners.add(listener)
          },
          removeListener: (listener: (event: MediaQueryListEvent) => void) => {
            state.listeners.delete(listener)
          },
          dispatchEvent: () => true,
        } as MediaQueryList
      }),
    )
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("renders one semantic headline and visible navigation and CTA links", () => {
    const { container } = render(<HomeInSyncHero />)

    expect(screen.getByRole("heading", { level: 1, name: "HOME, IN SYNC." })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe(
      "#how-it-works",
    )
    expect(screen.getByRole("link", { name: "Get started for free" }).getAttribute("href")).toBe(
      "/join",
    )
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/")
    expect(container.querySelectorAll("h1")).toHaveLength(1)
    expect([...container.querySelectorAll("a")].every((link) => link.textContent?.trim())).toBe(
      true,
    )
  })

  it("mounts only the active viewport video and omits video for reduced motion", async () => {
    const { container } = render(<HomeInSyncHero />)

    await waitFor(() => {
      expect(container.querySelector("video source")?.getAttribute("src")).toBe(
        "/landing/media/hero-desktop.mp4",
      )
    })
    expect(container.querySelectorAll("video")).toHaveLength(1)
    expect(container.querySelector("video")).toHaveProperty("muted", true)
    expect(container.querySelector("video")).toHaveProperty("playsInline", true)
    expect(container.querySelector("video")).toHaveProperty("loop", true)

    setMediaQuery("(max-width: 760px)", true)
    await waitFor(() => {
      expect(container.querySelector("video source")?.getAttribute("src")).toBe(
        "/landing/media/hero-mobile.mp4",
      )
    })
    expect(container.querySelectorAll("video")).toHaveLength(1)

    setMediaQuery("(prefers-reduced-motion: reduce)", true)
    await waitFor(() => expect(container.querySelector("video")).toBeNull())
  })

  it("keeps the poster as the fallback when autoplay is rejected", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("Autoplay denied"))
    const { container } = render(<HomeInSyncHero />)

    await waitFor(() => {
      expect(container.querySelector("video")?.getAttribute("data-playing")).toBe("false")
    })
    expect(container.querySelector('img[src="/landing/media/hero-desktop.webp"]')).toBeTruthy()
  })
})
