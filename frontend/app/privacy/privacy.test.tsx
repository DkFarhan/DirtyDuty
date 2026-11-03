// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PrivacyPage from "./page"
import styles from "@/components/chore-sync/legal-document-layout.module.css"

describe("Privacy Policy page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    window.history.replaceState({}, "", "/")
  })

  it("renders publicly with its title, effective date, sections and legal links", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@dirtyduty.test")

    render(<PrivacyPage />)

    const logo = document.querySelector(".auth-logo-surface.auth-logo-theme-aware")
    expect(logo?.querySelector(".auth-logo-theme-light")).toBeTruthy()
    expect(logo?.querySelector(".auth-logo-theme-dark")).toBeTruthy()
    expect(screen.getAllByRole("img", { name: "DirtyDuty" })).toHaveLength(1)
    expect(screen.getByRole("heading", { name: "DirtyDuty Privacy Policy", level: 1 })).toBeTruthy()
    expect(screen.getByText("Effective date: October 17, 2026")).toBeTruthy()
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(22)
    expect(screen.getByRole("heading", { name: "21. Contact us" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "support@dirtyduty.test" }).getAttribute("href")).toBe(
      "mailto:support@dirtyduty.test",
    )
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe("/")
    })
    expect(
      screen
        .getAllByRole("link", { name: "Terms of Service" })
        .every((link) => link.getAttribute("href") === "/terms"),
    ).toBe(true)
    expect(document.querySelector("main article")?.className).toBe(styles.article)
    expect(document.querySelector("#privacy-at-a-glance")?.parentElement?.className).toBe(
      styles.glance,
    )
  })

  it("provides on-page links for the summary and every numbered section", () => {
    render(<PrivacyPage />)

    const links = screen.getByRole("navigation", { name: "On this page" }).querySelectorAll("a")
    expect(links).toHaveLength(22)
    expect(
      Array.from(links).every((link) => {
        const id = link.getAttribute("href")?.slice(1)
        return id !== undefined && document.getElementById(id) !== null
      }),
    ).toBe(true)
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

  it("shows a close-tab action for Signup and preserves that context on Terms links", async () => {
    window.history.replaceState({}, "", "/privacy?returnTo=register")
    render(<PrivacyPage />)

    expect(await screen.findByRole("button", { name: "Back" })).toBeTruthy()
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("link", { name: "Terms of Service" })
          .some((link) => link.getAttribute("href") === "/terms?returnTo=register"),
      ).toBe(true)
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
