// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LegalDocumentBackLink } from "./legal-document-back-link"

describe("LegalDocumentBackLink", () => {
  let closedDescriptor: PropertyDescriptor | undefined

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    if (closedDescriptor) Object.defineProperty(window, "closed", closedDescriptor)
    else Reflect.deleteProperty(window, "closed")
    closedDescriptor = undefined
    window.history.replaceState({}, "", "/")
  })

  it("keeps the legal page unchanged when the browser blocks tab closing", async () => {
    window.history.replaceState({}, "", "/terms?returnTo=register")
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {})
    render(<LegalDocumentBackLink />)

    const backButton = await screen.findByRole("button", { name: "Back" })
    fireEvent.click(backButton)
    expect(closeSpy).toHaveBeenCalledOnce()
    expect(screen.queryByText(/couldn't close this tab/i)).toBeNull()
    expect(screen.queryByRole("link", { name: "Back to DirtyDuty" })).toBeNull()
    expect(screen.getByRole("button", { name: "Back" })).toBe(backButton)
    expect(window.location.search).toBe("?returnTo=register")
  })

  it("calls close from the Back button without adding a fallback", async () => {
    window.history.replaceState({}, "", "/privacy?returnTo=register")
    closedDescriptor = Object.getOwnPropertyDescriptor(window, "closed")
    Object.defineProperty(window, "closed", { configurable: true, value: true })
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {})
    render(<LegalDocumentBackLink />)

    fireEvent.click(await screen.findByRole("button", { name: "Back" }))

    expect(closeSpy).toHaveBeenCalledOnce()
    expect(screen.queryByText(/couldn't close this tab/i)).toBeNull()
    expect(window.location.search).toBe("?returnTo=register")
  })
})
