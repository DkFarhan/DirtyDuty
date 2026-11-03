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

  it("renders publicly with its title, effective date and configured support contact", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@dirtyduty.test")

    render(<TermsPage />)

    const logo = document.querySelector(".auth-logo-surface.auth-logo-theme-aware")
    expect(logo?.querySelector(".auth-logo-theme-light")).toBeTruthy()
    expect(logo?.querySelector(".auth-logo-theme-dark")).toBeTruthy()
    expect(screen.getAllByRole("img", { name: "DirtyDuty" })).toHaveLength(1)
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
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe("/")
    })
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

  it("shows a close-tab action for Signup and preserves that context on Privacy links", async () => {
    window.history.replaceState({}, "", "/terms?returnTo=register")
    render(<TermsPage />)

    expect(await screen.findByRole("button", { name: "Back" })).toBeTruthy()
    expect(screen.queryByText(/signup form remains open/i)).toBeNull()
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
        "/privacy?returnTo=register",
      )
    })
  })
})
