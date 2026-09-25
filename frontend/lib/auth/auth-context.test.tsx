// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider, useAuth } from "./auth-context"
import { ApiError, api, clearCsrfToken, getCsrfToken } from "./api"

vi.mock("./api", () => {
    class MockApiError extends Error {
        status: number | null
        kind: string

        constructor(message: string, status: number | null, kind: string) {
            super(message)
            this.status = status
            this.kind = kind
        }
    }

    return {
        ApiError: MockApiError,
        api: { get: vi.fn(), post: vi.fn() },
        clearCsrfToken: vi.fn(),
        getCsrfToken: vi.fn(),
    }
})

const user = {
    userId: "user-1",
    displayName: "Browser User",
    email: "user@example.com",
    emailVerified: false,
}

function Probe() {
    const [operation, setOperation] = useState("none")
    const auth = useAuth()
    return (
        <div>
            <span data-testid="loading">{String(auth.isLoading)}</span>
            <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
            <span data-testid="user">{auth.user?.email ?? "none"}</span>
            <span data-testid="error">{auth.authError ?? "none"}</span>
            <span data-testid="operation">{operation}</span>
            <button onClick={() => void auth.login("user@example.com", "password").then(() => setOperation("success"), () => setOperation("error"))}>Login</button>
            <button onClick={() => void auth.register({ displayName: "Browser User", email: "user@example.com", password: "password" }).then(() => setOperation("success"), () => setOperation("error"))}>Register</button>
            <button onClick={() => void auth.logout().then(() => setOperation("success"), () => setOperation("error"))}>Logout</button>
        </div>
    )
}

function renderAuth() {
    return render(
        <AuthProvider>
            <Probe />
        </AuthProvider>,
    )
}

describe("AuthProvider", () => {
    beforeEach(() => {
        vi.resetAllMocks()
        clearCsrfToken()
    })

    afterEach(() => {
        cleanup()
    })

    it("restores an authenticated user from /me", async () => {
        vi.mocked(api.get).mockResolvedValueOnce(user)

        renderAuth()

        await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"))
        expect(screen.getByTestId("authenticated").textContent).toBe("true")
        expect(screen.getByTestId("user").textContent).toBe("user@example.com")
    })

    it("keeps auth loading until /me restoration settles", async () => {
        let resolveMe!: (value: typeof user) => void
        vi.mocked(api.get).mockReturnValueOnce(new Promise((resolve) => {
            resolveMe = resolve
        }))

        renderAuth()

        expect(screen.getByTestId("loading").textContent).toBe("true")
        expect(screen.getByTestId("authenticated").textContent).toBe("false")
        resolveMe(user)
        await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"))
        expect(screen.getByTestId("authenticated").textContent).toBe("true")
    })

    it("treats a 401 from /me as unauthenticated", async () => {
        vi.mocked(api.get).mockRejectedValueOnce(new ApiError("Invalid email or password", 401, "unauthenticated"))

        renderAuth()

        await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"))
        expect(screen.getByTestId("authenticated").textContent).toBe("false")
        expect(screen.getByTestId("error").textContent).toBe("none")
    })

    it("keeps server verification errors distinct from unauthenticated state", async () => {
        vi.mocked(api.get).mockRejectedValueOnce(new ApiError("offline", null, "network"))

        renderAuth()

        await waitFor(() => expect(screen.getByTestId("error").textContent).not.toBe("none"))
        expect(screen.getByTestId("authenticated").textContent).toBe("false")
        expect(screen.getByTestId("error").textContent).toContain("Unable to verify your session")
    })

    it("sets the user and fetches fresh CSRF after successful login", async () => {
        vi.mocked(api.get)
            .mockRejectedValueOnce(new ApiError("anonymous", 401, "unauthenticated"))
            .mockResolvedValueOnce(user)
        vi.mocked(api.post).mockResolvedValueOnce(undefined)
        vi.mocked(getCsrfToken).mockResolvedValueOnce({ token: "fresh-token", headerName: "X-CSRF-TOKEN" })

        renderAuth()
        await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"))
        fireEvent.click(screen.getByRole("button", { name: "Login" }))

        await waitFor(() => expect(screen.getByTestId("authenticated").textContent).toBe("true"))
        expect(getCsrfToken).toHaveBeenCalledOnce()
        expect(vi.mocked(api.post).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(getCsrfToken).mock.invocationCallOrder[0],
        )
        expect(api.post).toHaveBeenCalledWith("/api/auth/login", {
            email: "user@example.com",
            password: "password",
        })
        expect(api.get).toHaveBeenNthCalledWith(2, "/api/auth/me")
    })

    it("registers without authenticating the new account", async () => {
        vi.mocked(api.get).mockRejectedValueOnce(new ApiError("anonymous", 401, "unauthenticated"))
        vi.mocked(api.post).mockResolvedValueOnce(undefined)

        renderAuth()
        await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"))
        fireEvent.click(screen.getByRole("button", { name: "Register" }))

        await waitFor(() => expect(screen.getByTestId("operation").textContent).toBe("success"))
        expect(api.post).toHaveBeenCalledWith("/api/auth/register", {
            displayName: "Browser User",
            email: "user@example.com",
            password: "password",
        })
        expect(screen.getByTestId("authenticated").textContent).toBe("false")
    })

    it("clears authenticated state only after the backend confirms logout", async () => {
        vi.mocked(api.get).mockResolvedValueOnce(user)
        let resolveLogout!: () => void
        vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => {
            resolveLogout = () => resolve(undefined)
        }))

        renderAuth()
        await waitFor(() => expect(screen.getByTestId("authenticated").textContent).toBe("true"))
        vi.mocked(clearCsrfToken).mockClear()
        fireEvent.click(screen.getByRole("button", { name: "Logout" }))

        expect(screen.getByTestId("authenticated").textContent).toBe("true")
        expect(clearCsrfToken).not.toHaveBeenCalled()
        resolveLogout()

        await waitFor(() => expect(screen.getByTestId("authenticated").textContent).toBe("false"))
        expect(api.post).toHaveBeenCalledWith("/api/auth/logout")
        expect(clearCsrfToken).toHaveBeenCalledOnce()
    })

    it("retains authenticated state when backend logout fails", async () => {
        vi.mocked(api.get).mockResolvedValueOnce(user)
        vi.mocked(api.post).mockRejectedValueOnce(new ApiError("network failure", null, "network"))

        renderAuth()
        await waitFor(() => expect(screen.getByTestId("authenticated").textContent).toBe("true"))
        vi.mocked(clearCsrfToken).mockClear()
        fireEvent.click(screen.getByRole("button", { name: "Logout" }))

        await waitFor(() => expect(screen.getByTestId("operation").textContent).toBe("error"))
        expect(screen.getByTestId("authenticated").textContent).toBe("true")
        expect(clearCsrfToken).not.toHaveBeenCalled()
    })
})