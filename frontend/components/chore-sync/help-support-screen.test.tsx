// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ChoreSyncProvider } from "@/lib/chore-sync/store"
import { HelpSupportScreen } from "./screens/help-support-screen"
import { faqCategories } from "./help-support-faq"

const clipboardWriteText = vi.fn<(text: string) => Promise<void>>()

function renderScreen({
  redesigned = false,
  theme = "light",
}: {
  redesigned?: boolean
  theme?: "light" | "dark"
} = {}) {
  return render(
    <ChoreSyncProvider>
      <HelpSupportScreen redesigned={redesigned} theme={theme} />
    </ChoreSyncProvider>,
  )
}

function mailtoParameters(href: string) {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1))
}

describe("help and support screen", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@dirtyduty.test")
    clipboardWriteText.mockReset()
    clipboardWriteText.mockResolvedValue()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    })
    window.history.replaceState({}, "", "/")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    window.localStorage.clear()
    document.cookie = "SESSION=; Max-Age=0; path=/"
    window.history.replaceState({}, "", "/")
  })

  it("renders collapsed categories and exposes only the selected category and FAQ answer", () => {
    renderScreen()

    expect(screen.getByRole("searchbox", { name: "Search help articles" }).className).toContain(
      "dark:bg-slate-800",
    )
    expect(faqCategories).toHaveLength(6)
    expect(faqCategories.reduce((total, category) => total + category.items.length, 0)).toBe(30)
    const gettingStarted = screen.getByRole("button", { name: /^Getting Started/ })
    const membersRoles = screen.getByRole("button", { name: /^Members & Roles/ })
    const chores = screen.getByRole("button", { name: /^Chores & Assignments/ })
    const notifications = screen.getByRole("button", { name: /^Notifications/ })
    const accountSecurity = screen.getByRole("button", { name: /^Account & Security/ })
    const householdData = screen.getByRole("button", { name: /^Household Data/ })
    const categoryButtons = [
      gettingStarted,
      membersRoles,
      chores,
      notifications,
      accountSecurity,
      householdData,
    ]
    for (const categoryButton of categoryButtons) {
      expect(categoryButton.getAttribute("aria-expanded")).toBe("false")
      expect(categoryButton.getAttribute("aria-controls")).toBeTruthy()
      expect(categoryButton.className).toContain("dark:bg-slate-800")
    }
    expect(
      screen.queryByRole("button", { name: "How do I join an existing household?" }),
    ).toBeNull()

    fireEvent.click(gettingStarted)
    expect(gettingStarted.getAttribute("aria-expanded")).toBe("true")
    const gettingStartedQuestions = screen.getByRole("button", {
      name: "How do I join an existing household?",
    })
    fireEvent.click(gettingStartedQuestions)
    expect(gettingStartedQuestions.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText(/valid invitation code/)).toBeTruthy()

    fireEvent.click(membersRoles)
    expect(membersRoles.getAttribute("aria-expanded")).toBe("true")
    expect(gettingStarted.getAttribute("aria-expanded")).toBe("false")
    expect(
      screen.queryByRole("button", { name: "How do I join an existing household?" }),
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "How do I invite someone to my household?" }),
    ).toBeTruthy()
  })

  it("automatically opens matching categories during search, hides others, and resets when cleared", () => {
    renderScreen()
    const search = screen.getByRole("searchbox", { name: "Search help articles" })

    fireEvent.change(screen.getByRole("searchbox", { name: "Search help articles" }), {
      target: { value: "password" },
    })
    expect(
      screen.getByRole("button", { name: /^Account & Security/ }).getAttribute("aria-expanded"),
    ).toBe("true")
    expect(screen.getByRole("button", { name: "How do I change my password?" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Getting Started/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Notifications/ })).toBeNull()

    fireEvent.change(search, {
      target: { value: "ROUND-ROBIN" },
    })
    expect(
      screen.getByRole("button", { name: "How does round-robin assignment work?" }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Account & Security/ })).toBeNull()

    fireEvent.change(search, { target: { value: "" } })
    for (const categoryButton of [
      screen.getByRole("button", { name: /^Getting Started/ }),
      screen.getByRole("button", { name: /^Members & Roles/ }),
      screen.getByRole("button", { name: /^Chores & Assignments/ }),
      screen.getByRole("button", { name: /^Notifications/ }),
      screen.getByRole("button", { name: /^Account & Security/ }),
      screen.getByRole("button", { name: /^Household Data/ }),
    ]) {
      expect(categoryButton.getAttribute("aria-expanded")).toBe("false")
    }
    expect(screen.queryByRole("button", { name: "How do I change my password?" })).toBeNull()

    fireEvent.change(search, {
      target: { value: "nothing matches this" },
    })
    expect(screen.getByText("No help articles match that search.")).toBeTruthy()
  })

  it("renders the approved redesigned Help structure and theme-specific assets", () => {
    renderScreen({ redesigned: true, theme: "dark" })

    expect(
      document.querySelector('img[src="/profile-redesign/icons/help-mark-dark.svg"]'),
    ).toBeTruthy()
    expect(
      document.querySelectorAll('img[src="/profile-redesign/icons/help-chevron-down-dark.svg"]')
        .length,
    ).toBeGreaterThan(0)

    const report = screen.getByRole("region", { name: "Report a problem" })
    const feedback = screen.getByRole("region", { name: "Send feedback" })
    const services = screen.getByLabelText("Help desk services")
    expect(services.textContent).toContain("QUICK ANSWERSPROBLEM REPORTSIDEAS")
    expect(screen.getByText(/DIRTYDUTY\s+·\s+MADE FOR SHARED HOMES/)).toBeTruthy()
    expect(report.textContent).toContain("!")
    expect(feedback.textContent).toContain("✦")
    expect(report.querySelector("details")).toBeTruthy()
    expect(feedback.querySelector("details")).toBeTruthy()
    expect(
      within(report).getByRole("button", { name: "Open email app" }).hasAttribute("disabled"),
    ).toBe(true)
    expect(
      within(report).getByRole("button", { name: "Copy message" }).hasAttribute("disabled"),
    ).toBe(true)
    expect(
      within(feedback).getByRole("button", { name: "Open email app" }).hasAttribute("disabled"),
    ).toBe(true)
    expect(
      within(feedback).getByRole("button", { name: "Copy message" }).hasAttribute("disabled"),
    ).toBe(true)

    const feedbackType = screen.getByLabelText<HTMLSelectElement>("Feedback type")
    expect(feedbackType.value).toBe("General feedback")
    expect(
      feedback.querySelector('img[src="/profile-redesign/icons/help-chevron-down-dark.svg"]'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /^Getting Started/ }))
    const question = screen.getByRole("button", {
      name: "How do I join an existing household?",
    })
    fireEvent.click(question)
    expect(question.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText(/valid invitation code/).className).not.toBe("")
  })

  it("validates problem fields and prepares a safe diagnostic email and copy message", async () => {
    const privatePath = "/households/123e4567-e89b-12d3-a456-426614174000?token=private"
    window.history.replaceState({}, "", privatePath)
    window.localStorage.setItem("authToken", "storage-secret")
    document.cookie = "SESSION=cookie-secret; path=/"
    renderScreen()

    const report = within(screen.getByRole("region", { name: "Report a problem" }))
    const openEmailButtons = report.getAllByRole("button", { name: "Open email app" })
    expect(openEmailButtons[0].hasAttribute("disabled")).toBe(true)
    expect(report.getByRole("button", { name: "Copy message" }).hasAttribute("disabled")).toBe(true)

    fireEvent.change(screen.getByRole("textbox", { name: "Short summary" }), {
      target: { value: "Chore completion failed" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "What happened?" }), {
      target: { value: "The chore showed an error." },
    })

    const emailLink = await report.findByRole("link", { name: "Open email app" })
    expect(emailLink.getAttribute("href")).toContain("mailto:support@dirtyduty.test?")
    const parameters = mailtoParameters(emailLink.getAttribute("href") ?? "")
    expect(parameters.get("subject")).toBe("DirtyDuty problem: Chore completion failed")
    expect(parameters.get("body")).toContain("The chore showed an error.")
    expect(parameters.get("body")).toContain("Route: /households/:id")
    expect(parameters.get("body")).toContain("Time (UTC):")
    expect(parameters.get("body")).not.toContain("token=private")

    fireEvent.click(report.getByRole("button", { name: "Copy message" }))
    await waitFor(() => expect(report.getByRole("status").textContent).toContain("Message copied"))
    const copiedMessage = clipboardWriteText.mock.calls[0]?.[0] ?? ""
    expect(copiedMessage).toContain("Chore completion failed")
    expect(copiedMessage).toContain("/households/:id")
    expect(copiedMessage).not.toContain("storage-secret")
    expect(copiedMessage).not.toContain("cookie-secret")
    expect(copiedMessage).not.toContain("token=private")
  })

  it("keeps feedback separate and creates an email without diagnostics", () => {
    renderScreen()
    fireEvent.change(screen.getByRole("combobox", { name: "Feedback type" }), {
      target: { value: "Feature idea" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: 'A weekly chore overview & "cleanup"? is useful.' },
    })

    const emailLink = screen.getByRole("link", { name: "Open email app" })
    const href = emailLink.getAttribute("href") ?? ""
    const parameters = mailtoParameters(href)
    const encodedBody = href.split("&body=")[1]
    expect(href).toContain("mailto:support@dirtyduty.test?")
    expect(href).toContain("%20")
    expect(href).toContain("%0A")
    expect(href).toContain("%26")
    expect(href).toContain("%3F")
    expect(href).toContain("%22")
    expect(href).not.toContain("+")
    expect(decodeURIComponent(encodedBody ?? "")).toContain("Hi DirtyDuty team,\n\n")
    expect(emailLink.getAttribute("href")).toContain("mailto:support@dirtyduty.test?")
    expect(parameters.get("subject")).toBe("DirtyDuty feedback: Feature idea")
    expect(parameters.get("body")).toContain('A weekly chore overview & "cleanup"?')
    expect(parameters.get("body")).not.toContain("Safe diagnostics:")
    expect(parameters.get("body")).not.toContain("Route:")
  })

  it("allows copying feedback when support email is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "  ")
    renderScreen()
    const feedbackForm = within(screen.getByRole("region", { name: "Send feedback" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Thanks for making chores easier." },
    })

    expect(
      screen.getAllByText(
        "Email support is not configured for this environment. You can still copy your message.",
      ),
    ).toHaveLength(2)
    expect(feedbackForm.queryByRole("link", { name: "Open email app" })).toBeNull()

    fireEvent.click(feedbackForm.getByRole("button", { name: "Copy message" }))
    await waitFor(() =>
      expect(
        feedbackForm
          .getAllByRole("status")
          .some((status) => status.textContent?.includes("Message copied")),
      ).toBe(true),
    )
    expect(clipboardWriteText.mock.calls[0]?.[0]).toContain("Thanks for making chores easier.")
  })
})
