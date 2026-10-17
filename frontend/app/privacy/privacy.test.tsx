// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PrivacyPage from "./page"

describe("Privacy Policy page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    window.history.replaceState({}, "", "/")
  })

  it("renders publicly with its title, effective date, sections and legal links", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@dirtyduty.test")

    render(<PrivacyPage />)

    expect(screen.getByRole("heading", { name: "DirtyDuty Privacy Policy", level: 1 })).toBeTruthy()
    expect(screen.getByText("Effective date: October 17, 2026")).toBeTruthy()
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(22)
    expect(screen.getByRole("heading", { name: "21. Contact us" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "support@dirtyduty.test" }).getAttribute("href")).toBe(
      "mailto:support@dirtyduty.test",
    )
    expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe("/")
    expect(
      screen
        .getAllByRole("link", { name: "Terms of Service" })
        .every((link) => link.getAttribute("href") === "/terms"),
    ).toBe(true)
    expect(document.querySelector("div.min-h-screen")?.className).toContain("dark:bg-slate-950")
    expect(document.querySelector("article")?.className).toContain("dark:bg-slate-900")
  })

  it("returns to Privacy & Security when opened from that screen", async () => {
    window.history.replaceState({}, "", "/privacy?returnTo=privacy-security")
    render(<PrivacyPage />)

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe(
        "/?screen=privacy-security",
      )
    })
  })

  it.each(["", "?returnTo=https%3A%2F%2Fevil.example", "?returnTo=unknown-screen"])(
    "uses the public fallback for an absent or invalid return target (%s)",
    async (query) => {
      window.history.replaceState({}, "", `/privacy${query}`)
      render(<PrivacyPage />)

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe(
          "/",
        )
      })
    },
  )
})
