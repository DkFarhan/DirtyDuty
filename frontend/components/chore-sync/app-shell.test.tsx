// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"
import { clearCsrfToken } from "../../lib/auth/api"
import { stubAuthFeatures } from "../../test/stub-auth-features"

vi.mock("@/lib/notifications/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/api")>()
  return {
    ...actual,
    notificationApi: {
      ...actual.notificationApi,
      preferences: () =>
        Promise.resolve({
          choreAssignedEnabled: true,
          choreRemindersEnabled: true,
          overdueEnabled: true,
          choreCompletionEnabled: true,
          householdUpdatesEnabled: true,
          quietHoursStart: null,
          quietHoursEnd: null,
          notificationStyleOverride: null,
          householdNotificationStyle: "NORMAL",
          funnyNotificationsEnabled: false,
          competitiveNotificationsEnabled: true,
          pushEnabled: false,
        }),
    },
  }
})

const fetchMock = vi.fn<typeof fetch>()
const user = {
  userId: "user-1",
  displayName: "Browser User",
  email: "user@example.com",
  emailVerified: false,
  hasPassword: true,
  authProviders: ["PASSWORD"],
  legalAcceptanceRequired: false,
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function openLogin() {
  render(<AppShell />)
  await screen.findByRole("button", { name: "Sign In" }, { timeout: 3_000 })
  expect(screen.getByRole("img", { name: "DirtyDuty" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Sign In" }).className).toContain("auth-primary-button")
  expect(document.querySelector(".auth-logo-surface")).toBeTruthy()
}

async function fillAndSubmitRegistration() {
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: user.displayName } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPassword123!" } })
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "StrongPassword123!" },
  })
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree to the Terms of Service/ }))
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }))
}

describe("authentication screens", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    stubAuthFeatures(fetchMock)
    clearCsrfToken()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearCsrfToken()
    window.history.replaceState({}, "", "/")
  })

  it("restores the legal-acceptance return screen after auth restoration and consumes its URL", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/api/auth/me"))
        return jsonResponse({ ...user, legalAcceptanceRequired: true })
      if (String(input).endsWith("/api/households"))
        return jsonResponse({ message: "Legal acceptance required" }, 403)
      return jsonResponse({}, 404)
    })
    window.history.replaceState({}, "", "/?screen=legal-acceptance")

    render(<AppShell />)

    expect(
      await screen.findByRole("heading", { name: "Review our policies" }, { timeout: 3_000 }),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: /Terms of Service/ }).getAttribute("href")).toBe(
      "/terms?returnTo=legal-acceptance",
    )
    expect(screen.getByRole("link", { name: /Privacy Policy/ }).getAttribute("href")).toBe(
      "/privacy?returnTo=legal-acceptance",
    )
    expect(screen.queryByText("Unable to load your households. Please try again.")).toBeNull()
    expect(window.location.search).toBe("")
  })

  it("restores Privacy & Security only after auth is ready and removes the consumed screen parameter", async () => {
    let resolveMe!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveMe = resolve)))
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "home-1",
          name: "Apartment 305",
          timezone: "America/Sao_Paulo",
          currentUserRole: "OWNER",
          createdAt: "2026-09-25T12:00:00Z",
        },
      ]),
    )
    window.history.replaceState({}, "", "/?screen=privacy-security")

    render(<AppShell />)
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" })).toBeTruthy()
    expect(screen.getByText("Loading...").closest('[aria-hidden="true"]')).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Privacy & Security" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull()

    resolveMe(jsonResponse(user))

    expect(
      await screen.findByRole("heading", { name: "Privacy & Security" }, { timeout: 3_000 }),
    ).toBeTruthy()
    expect(screen.queryByText("Welcome!")).toBeNull()
    expect(window.location.search).toBe("")
  })

  it("shows the splash and not Login until /me restores the session", async () => {
    let resolveMe!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMe = resolve
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    render(<AppShell />)
    expect(screen.getByRole("status", { name: "Starting DirtyDuty" })).toBeTruthy()
    expect(screen.getByText("Loading...").closest('[aria-hidden="true"]')).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveMe(jsonResponse(user))
    expect(
      await screen.findByRole("heading", { name: "Welcome!" }, { timeout: 3_000 }),
    ).toBeTruthy()
    expect(screen.queryByRole("status", { name: "Starting DirtyDuty" })).toBeNull()
    expect(screen.getByRole("img", { name: "DirtyDuty" })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/auth/me",
      expect.objectContaining({
        credentials: "include",
      }),
    )
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8080/api/households")
  })

  it("does not replay the splash during internal navigation after startup", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    await openLogin()
    expect(screen.queryByRole("status", { name: "Starting DirtyDuty" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))

    expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy()
    expect(screen.queryByRole("status", { name: "Starting DirtyDuty" })).toBeNull()
  })

  it("keeps authentication screens light without changing a saved dark preference", async () => {
    localStorage.setItem("dirtyduty-theme", "dark")
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))

    await openLogin()

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false)
      expect(document.documentElement.dataset.theme).toBe("light")
    })
    expect(localStorage.getItem("dirtyduty-theme")).toBe("dark")

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy()
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(localStorage.getItem("dirtyduty-theme")).toBe("dark")
  })

  it("toggles login password visibility without changing the value or submitting", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    await openLogin()

    const password = screen.getByLabelText("Password") as HTMLInputElement
    fireEvent.change(password, { target: { value: "StrongPassword123!" } })
    expect(password.type).toBe("password")

    const showButton = screen.getByRole("button", { name: "Show password" })
    expect(showButton.getAttribute("aria-pressed")).toBe("false")
    expect(showButton.getAttribute("type")).toBe("button")
    fireEvent.click(showButton)
    expect(password.type).toBe("text")
    expect(password.value).toBe("StrongPassword123!")
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe(
      "true",
    )

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }))
    expect(password.type).toBe("password")
    expect(password.value).toBe("StrongPassword123!")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps registration password toggles independent", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    await openLogin()
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))

    const password = screen.getByLabelText("Password") as HTMLInputElement
    const confirmation = screen.getByLabelText("Confirm password") as HTMLInputElement
    fireEvent.change(password, { target: { value: "StrongPassword123!" } })
    fireEvent.change(confirmation, { target: { value: "StrongPassword123!" } })

    fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[0])
    expect(password.type).toBe("text")
    expect(password.value).toBe("StrongPassword123!")
    expect(confirmation.type).toBe("password")
    expect(confirmation.value).toBe("StrongPassword123!")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("requires Terms acceptance and keeps signup state with a safe new-tab link", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    await openLogin()
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Browser User" } })

    const termsLink = screen.getByRole("link", { name: "Terms of Service" })
    expect(termsLink.getAttribute("href")).toBe("/terms")
    expect(termsLink.getAttribute("target")).toBe("_blank")
    expect(termsLink.getAttribute("rel")).toContain("noopener")
    expect(termsLink.getAttribute("rel")).toContain("noreferrer")
    const privacyLink = screen.getByRole("link", { name: "Privacy Policy" })
    expect(privacyLink.getAttribute("href")).toBe("/privacy")
    expect(privacyLink.getAttribute("target")).toBe("_blank")
    expect(privacyLink.getAttribute("rel")).toContain("noopener")
    expect(privacyLink.getAttribute("rel")).toContain("noreferrer")

    fireEvent.click(screen.getByRole("button", { name: "Create Account" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Please agree to the Terms of Service and acknowledge the Privacy Policy to create an account.",
    )
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Browser User")
    expect(
      fetchMock.mock.calls.some(([url]) => url === "http://localhost:8080/api/auth/register"),
    ).toBe(false)
  })

  it("preserves password confirmation validation after Terms are accepted", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    await openLogin()
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPassword123!" } })
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "DifferentPassword123!" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: /I agree to the Terms of Service/ }))
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Passwords do not match.",
    )
    expect(
      fetchMock.mock.calls.some(([url]) => url === "http://localhost:8080/api/auth/register"),
    ).toBe(false)
  })

  it("registers with CSRF and returns to login without authenticating", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "Authentication required" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ token: "registration-csrf", headerName: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(jsonResponse({ userId: "user-1" }, 201))

    await openLogin()
    await fillAndSubmitRegistration()

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/auth/me")
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8080/api/auth/csrf")
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/auth/register")
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ credentials: "include", method: "POST" })
    expect(fetchMock.mock.calls[2][1]?.headers).toBeInstanceOf(Headers)
    expect(fetchMock.mock.calls[2][1]?.body).toBe(
      JSON.stringify({
        displayName: user.displayName,
        email: user.email,
        password: "StrongPassword123!",
        termsAccepted: true,
        privacyPolicyAcknowledged: true,
      }),
    )
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("X-CSRF-TOKEN")).toBe(
      "registration-csrf",
    )
  })

  it("shows a safe duplicate-registration message", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(
        jsonResponse({ message: "org.springframework.dao.InternalException" }, 409),
      )

    await openLogin()
    await fillAndSubmitRegistration()

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "An account with this email already exists.",
    )
    expect(screen.queryByText(/InternalException/)).toBeNull()
  })

  it("shows registration network failures without claiming duplicate credentials", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockRejectedValueOnce(new TypeError("offline"))

    await openLogin()
    await fillAndSubmitRegistration()

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to connect to DirtyDuty. Please try again.",
    )
    expect(screen.queryByText(/already exists/i)).toBeNull()
  })

  it("logs in with credentials and fetches a fresh CSRF token before entering the app", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "pre-login-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse({ token: "post-login-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse([]))

    await openLogin()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPassword123!" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))

    expect(await screen.findByText("Welcome!")).toBeTruthy()
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/auth/login")
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ email: user.email, password: "StrongPassword123!" }),
    })
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("X-CSRF-TOKEN")).toBe(
      "pre-login-csrf",
    )
    expect(fetchMock.mock.calls[3][0]).toBe("http://localhost:8080/api/auth/csrf")
    expect(fetchMock.mock.calls[4][0]).toBe("http://localhost:8080/api/auth/me")
    expect(fetchMock.mock.calls[4][1]).toMatchObject({ credentials: "include" })
    expect(fetchMock.mock.calls[5][0]).toBe("http://localhost:8080/api/households")
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it("shows generic credential failure for login 401 responses", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ message: "private backend exception" }, 401))

    await openLogin()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Invalid email or password",
    )
    expect(screen.queryByText(/private backend exception/)).toBeNull()
  })

  it("shows useful guidance when password sign-in is temporarily throttled", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ message: "private throttle details" }, 429))

    await openLogin()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Too many sign-in attempts. Please wait and try again, or reset your password.",
    )
    expect(screen.queryByText(/private throttle details/)).toBeNull()
  })

  it("shows a network error instead of invalid credentials when login cannot reach the backend", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "csrf", headerName: "X-CSRF-TOKEN" }))
      .mockRejectedValueOnce(new TypeError("offline"))

    await openLogin()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unable to connect to DirtyDuty. Please try again.",
    )
    expect(screen.queryByText("Invalid email or password")).toBeNull()
  })

  it("shows only enabled provider and password-reset options", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    stubAuthFeatures(fetchMock, { google: true, passwordReset: true })
    await openLogin()

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }))
    expect(await screen.findByRole("button", { name: "Send reset instructions" })).toBeTruthy()
  })

  it("shows Google sign-in on registration when the provider is enabled", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    stubAuthFeatures(fetchMock, { google: true, passwordReset: false })
    await openLogin()

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeTruthy()
  })

  it("requires the existing password before linking a Google email collision", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "link-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ token: "fresh-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse([]))
    window.history.replaceState({}, "", "/?auth=google-link-required")
    stubAuthFeatures(fetchMock, { google: true, passwordReset: false })

    render(<AppShell />)
    expect(
      await screen.findByRole("button", { name: "Sign in and link Google" }, { timeout: 3_000 }),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "StrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Sign in and link Google" }))

    expect(await screen.findByText("Welcome!")).toBeTruthy()
    const linkRequest = fetchMock.mock.calls.find(
      ([url]) => url === "http://localhost:8080/api/auth/google/link",
    )
    expect(linkRequest?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ password: "StrongPassword123!" }),
    })
    window.history.replaceState({}, "", "/")
  })

  it("confirms password reset with the fragment token and removes it from browser history", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "reset-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Password changed successfully." }))
    window.history.replaceState({}, "", "/reset-password#token=secret-reset-token")
    stubAuthFeatures(fetchMock)

    render(<AppShell initialScreen="reset-password" />)
    expect(
      await screen.findByRole("button", { name: "Update password" }, { timeout: 3_000 }),
    ).toBeTruthy()
    await waitFor(() => expect(window.location.hash).toBe(""))
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewStrongPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "NewStrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    expect(await screen.findByText("Password updated")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/auth/password-reset/confirm")
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ token: "secret-reset-token", newPassword: "NewStrongPassword123!" }),
    })
    window.history.replaceState({}, "", "/")
  })

  it("validates reset password length before sending the token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))
    window.history.replaceState({}, "", "/reset-password#token=short-password-reset-token")
    stubAuthFeatures(fetchMock)

    render(<AppShell initialScreen="reset-password" />)
    await screen.findByRole("button", { name: "Update password" }, { timeout: 3_000 })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "short" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    expect((await screen.findByRole("alert")).textContent).toContain("between 12 and 128")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    window.history.replaceState({}, "", "/")
  })

  it("explains when a password reset token is invalid or expired", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "reset-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(jsonResponse({ message: "invalid" }, 400))
    window.history.replaceState({}, "", "/reset-password#token=expired-reset-token")
    stubAuthFeatures(fetchMock)

    render(<AppShell initialScreen="reset-password" />)
    await screen.findByRole("button", { name: "Update password" }, { timeout: 3_000 })
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewStrongPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "NewStrongPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This reset link is invalid or expired. Request a new one.",
    )
    window.history.replaceState({}, "", "/")
  })

  it("shows the distinct same-password reset validation response", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "reset-csrf", headerName: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "Your new password must be different from your current password." },
          400,
        ),
      )
    window.history.replaceState({}, "", "/reset-password#token=still-valid-token")
    stubAuthFeatures(fetchMock)

    render(<AppShell initialScreen="reset-password" />)
    await screen.findByRole("button", { name: "Update password" }, { timeout: 3_000 })
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "CurrentPassword123!" },
    })
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "CurrentPassword123!" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Update password" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Your new password must be different from your current password.",
    )
    window.history.replaceState({}, "", "/")
  })
})
