// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import TermsPage from "./page"

describe("Terms of Service page", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
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
    expect(screen.getByRole("link", { name: "support@dirtyduty.test" }).getAttribute("href")).toBe(
      "mailto:support@dirtyduty.test",
    )
    expect(screen.getByRole("link", { name: "Back to DirtyDuty" }).getAttribute("href")).toBe("/")
  })
})
