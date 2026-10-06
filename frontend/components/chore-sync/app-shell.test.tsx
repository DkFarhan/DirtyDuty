// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "./app-shell"
import { clearCsrfToken } from "../../lib/auth/api"

const fetchMock = vi.fn<typeof fetch>()
const user = {
  userId: "user-1",
  displayName: "Browser User",
  email: "user@example.com",
  emailVerified: false,
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function openLogin() {
  render(<AppShell />)
  await screen.findByRole("button", { name: "Sign In" })
}

async function fillAndSubmitRegistration() {
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: user.displayName } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPassword123!" } })
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "StrongPassword123!" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }))
}

describe("authentication screens", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    clearCsrfToken()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearCsrfToken()
  })

  it("shows a loading state until /me restores the session", async () => {
    let resolveMe!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMe = resolve
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    render(<AppShell />)
    expect(screen.getByText("Loading...")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveMe(jsonResponse(user))
    expect(await screen.findByText("Welcome to ChoreSync!")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/auth/me",
      expect.objectContaining({
        credentials: "include",
      }),
    )
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8080/api/households")
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

    expect(await screen.findByText("Welcome to ChoreSync!")).toBeTruthy()
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
})
