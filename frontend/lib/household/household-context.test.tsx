// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  auth: {
    user: { userId: "user-1", emailVerified: true } as {
      userId: string
      emailVerified: boolean
    } | null,
    features: { emailVerification: true },
    isAuthenticated: true,
    isLoading: false,
  },
  list: vi.fn(),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => ({ ...mocks.auth, features: mocks.auth.features }),
}))

vi.mock("./api", () => ({
  householdApi: {
    list: mocks.list,
    create: vi.fn(),
    join: vi.fn(),
  },
}))

import { HouseholdProvider, useHouseholds } from "./household-context"

const firstHousehold = {
  id: "household-1",
  name: "First user's home",
  timezone: "UTC",
  currentUserRole: "OWNER",
  createdAt: "2026-10-01T00:00:00Z",
}

function HouseholdHarness() {
  const {
    households,
    status,
    error,
    createdHouseholdInvite,
    queueCreatedHouseholdInvite,
    refresh,
  } = useHouseholds()
  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="households">{households.map(({ name }) => name).join(", ")}</output>
      <output data-testid="created-invite">{createdHouseholdInvite?.name ?? ""}</output>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => void refresh().catch(() => undefined)} type="button">
        Refresh
      </button>
      <button onClick={() => queueCreatedHouseholdInvite(firstHousehold)} type="button">
        Queue invite
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <HouseholdProvider>
      <HouseholdHarness />
    </HouseholdProvider>,
  )
}

describe("household context refresh", () => {
  beforeEach(() => {
    mocks.auth.user = { userId: "user-1", emailVerified: true }
    mocks.auth.isAuthenticated = true
    mocks.auth.isLoading = false
    mocks.auth.features = { emailVerification: true }
    mocks.list.mockReset()
  })

  afterEach(() => cleanup())

  it("keeps current household data visible during refresh and after a failed refresh", async () => {
    mocks.list.mockResolvedValueOnce([firstHousehold])
    const view = renderProvider()
    expect(await screen.findByText("First user's home")).toBeTruthy()

    let rejectRefresh!: (error: Error) => void
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject
        }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(screen.getByText("First user's home")).toBeTruthy()
    expect(screen.getByTestId("status").textContent).toBe("has-households")

    rejectRefresh(new Error("refresh failed"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unable to load"))
    expect(screen.getByText("First user's home")).toBeTruthy()
    expect(screen.getByTestId("status").textContent).toBe("has-households")
    view.unmount()
  })

  it("hides the prior account's household while loading another account", async () => {
    mocks.list.mockResolvedValueOnce([firstHousehold])
    const view = renderProvider()
    expect(await screen.findByText("First user's home")).toBeTruthy()

    let resolveSecondUser!: (households: (typeof firstHousehold)[]) => void
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecondUser = resolve
        }),
    )
    mocks.auth.user = { userId: "user-2", emailVerified: true }
    view.rerender(
      <HouseholdProvider>
        <HouseholdHarness />
      </HouseholdProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loading"))
    expect(screen.getByTestId("households").textContent).toBe("")
    resolveSecondUser([{ ...firstHousehold, name: "Second user's home" }])

    expect(await screen.findByText("Second user's home")).toBeTruthy()
    expect(screen.queryByText("First user's home")).toBeNull()
  })

  it("clears a queued invite when the authenticated user changes", async () => {
    mocks.list.mockResolvedValueOnce([firstHousehold])
    const view = renderProvider()
    expect(await screen.findByText("First user's home")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Queue invite" }))
    expect(screen.getByTestId("created-invite").textContent).toBe("First user's home")

    mocks.list.mockResolvedValueOnce([{ ...firstHousehold, name: "Second user's home" }])
    mocks.auth.user = { userId: "user-2", emailVerified: true }
    view.rerender(
      <HouseholdProvider>
        <HouseholdHarness />
      </HouseholdProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("created-invite").textContent).toBe(""))
    expect(await screen.findByText("Second user's home")).toBeTruthy()
  })

  it("never loads household data for an authenticated but unverified user", async () => {
    mocks.auth.user = { userId: "pending-user", emailVerified: false }
    const view = renderProvider()

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("empty"))
    expect(mocks.list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("empty"))
    expect(mocks.list).not.toHaveBeenCalled()
    expect(screen.getByTestId("households").textContent).toBe("")
    view.unmount()
  })

  it("loads existing household data for unverified users when verification is disabled", async () => {
    mocks.auth.user = { userId: "pending-user", emailVerified: false }
    mocks.auth.features = { emailVerification: false }
    mocks.list.mockResolvedValueOnce([firstHousehold])
    renderProvider()

    expect(await screen.findByText("First user's home")).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })
})
