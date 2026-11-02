// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import TermsPage from "./page"
import styles from "@/components/chore-sync/legal-document-layout.module.css"

describe("Terms of Service page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    window.history.replaceState({}, "", "/")
  })

  it("renders publicly with its title, effective date and configured support contact", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@dirtyduty.test")

    render(<TermsPage />)

    expect(
      screen.getByRole("heading", { name: "DirtyDuty Terms of Service", level: 1 }),
    ).toBeTruthy()
    expect(screen.getByText("Effective date: October 16, 2026")).toBeTruthy()
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(20)
    expect(screen.getByRole("heading", { name: "20. Contact" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
      "/privacy",
    )
    expect(screen.getByRole("link", { name: "support@dirtyduty.test" }).getAttribute("href")).toBe(
      "mailto:support@dirtyduty.test",
    )
    expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe("/")
    expect(document.querySelector("main article")?.className).toBe(styles.article)
  })

  it("provides an on-page link for every numbered section", () => {
    render(<TermsPage />)

    const links = screen.getByRole("navigation", { name: "On this page" }).querySelectorAll("a")
    expect(links).toHaveLength(20)
    expect(
      Array.from(links).every((link) => {
        const id = link.getAttribute("href")?.slice(1)
        return id !== undefined && document.getElementById(id) !== null
      }),
    ).toBe(true)
  })

  it("returns to Privacy & Security when opened from that screen", async () => {
    window.history.replaceState({}, "", "/terms?returnTo=privacy-security")
    render(<TermsPage />)

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe(
        "/?screen=privacy-security",
      )
    })
  })

  it("returns to legal acceptance when opened from its required-acknowledgement flow", async () => {
    window.history.replaceState({}, "", "/terms?returnTo=legal-acceptance")
    render(<TermsPage />)

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe(
        "/?screen=legal-acceptance",
      )
    })
  })
})
