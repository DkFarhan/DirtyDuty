// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeSelector } from "./theme-selector"
import { ThemeProvider, themeStorageKey, useTheme } from "./theme-provider"

const mediaListeners = new Set<(event: MediaQueryListEvent) => void>()
let prefersDark = false

function TestTheme() {
  const { theme } = useTheme()
  return (
    <>
      <ThemeSelector />
      <output data-testid="selected-theme">{theme}</output>
    </>
  )
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <TestTheme />
    </ThemeProvider>,
  )
}

describe("theme selection", () => {
  beforeEach(() => {
    prefersDark = false
    mediaListeners.clear()
    localStorage.clear()
    document.documentElement.classList.remove("dark", "light")
    document.documentElement.removeAttribute("data-theme")
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: prefersDark,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          mediaListeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("exposes accessible Light, Dark, and System radio choices", async () => {
    renderTheme()

    expect(screen.getByRole("radiogroup", { name: "Color theme" })).toBeTruthy()
    expect(screen.getByRole("radio", { name: "System" })).toBeTruthy()
    expect(screen.getByText("Always use the light theme.")).toBeTruthy()
    expect(screen.getByText("Always use the dark theme.")).toBeTruthy()
    expect(screen.getByText("Match your device appearance automatically.")).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>("radio", { name: "System" }).checked).toBe(true),
    )
    expect(
      screen.getByRole("radio", { name: "System" }).closest("label")?.getAttribute("data-selected"),
    ).toBe("true")
    expect(
      screen.getByRole("radio", { name: "Light" }).closest("label")?.getAttribute("data-selected"),
    ).toBe("false")
  })

  it("selects Light and persists the explicit preference", async () => {
    renderTheme()
    fireEvent.click(screen.getByRole("radio", { name: "Light" }))

    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>("radio", { name: "Light" }).checked).toBe(true)
      expect(document.documentElement.classList.contains("light")).toBe(true)
    })
    expect(localStorage.getItem(themeStorageKey)).toBe("light")
  })

  it("selects Dark and persists the explicit preference", async () => {
    renderTheme()
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }))

    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked).toBe(true)
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
    expect(
      screen.getByRole("radio", { name: "Dark" }).closest("label")?.getAttribute("data-selected"),
    ).toBe("true")
    expect(localStorage.getItem(themeStorageKey)).toBe("dark")
  })

  it("restores the saved preference after remount", async () => {
    const first = renderTheme()
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }))
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    first.unmount()

    renderTheme()
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked).toBe(true)
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
  })

  it("follows system color-scheme changes when System is selected", async () => {
    renderTheme()
    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true))

    prefersDark = true
    mediaListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent))
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))

    fireEvent.click(screen.getByRole("radio", { name: "Light" }))
    prefersDark = false
    mediaListeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent))
    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true))
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Light" }).checked).toBe(true)
  })

  it("can switch back to System and tracks subsequent device changes", async () => {
    localStorage.setItem(themeStorageKey, "dark")
    renderTheme()
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    fireEvent.click(screen.getByRole("radio", { name: "System" }))

    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>("radio", { name: "System" }).checked).toBe(true)
      expect(document.documentElement.classList.contains("light")).toBe(true)
    })

    prefersDark = true
    mediaListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent))
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    expect(localStorage.getItem(themeStorageKey)).toBe("system")
  })
})
