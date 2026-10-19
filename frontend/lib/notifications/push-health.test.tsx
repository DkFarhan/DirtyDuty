// @vitest-environment jsdom

import { webcrypto } from "node:crypto"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/auth/api"
import type { PushSubscriptionHealth } from "./api"
import { PushSubscriptionHealthProvider, usePushSubscriptionHealth } from "./push-health"

const mocks = vi.hoisted(() => ({
  auth: {
    value: {
      user: { userId: "user-1" },
      isAuthenticated: true,
      isLoading: false,
    },
  },
  preferences: vi.fn(),
  confirm: vi.fn(),
  publicKey: vi.fn(),
  subscribe: vi.fn(),
  inspect: vi.fn(),
  create: vi.fn(),
}))

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => mocks.auth.value,
}))

vi.mock("./api", () => ({
  notificationApi: {
    preferences: mocks.preferences,
    confirmPushSubscription: mocks.confirm,
    pushPublicKey: mocks.publicKey,
    subscribePush: mocks.subscribe,
  },
}))

vi.mock("./push", () => ({
  inspectBrowserPushSubscription: mocks.inspect,
  createBrowserPushSubscription: mocks.create,
}))

const subscription = {
  endpoint: "https://push.example.test/endpoint-secret",
  expirationTime: null,
  options: { applicationServerKey: null, userVisibleOnly: true },
  getKey: () => null,
  unsubscribe: async () => true,
  toJSON: () => ({ keys: { p256dh: "public-key", auth: "auth-secret" } }),
} satisfies PushSubscription
const confirmed: PushSubscriptionHealth = {
  status: "CONFIRMED",
  lastClientConfirmedAt: new Date().toISOString(),
}
const originalCrypto = Object.getOwnPropertyDescriptor(window, "crypto")

function Probe() {
  const { state, refresh, restore, setPushEnabled } = usePushSubscriptionHealth()
  return (
    <div>
      <output data-testid="push-status">{state.status}</output>
      <output data-testid="push-reason">{state.reason ?? "none"}</output>
      <output data-testid="push-message">{state.message ?? "none"}</output>
      <button onClick={() => void refresh(true)}>Refresh</button>
      <button onClick={() => void restore()}>Restore</button>
      <button onClick={() => setPushEnabled(false)}>Disable</button>
      <button onClick={() => setPushEnabled(true)}>Enable</button>
    </div>
  )
}

function renderHealth() {
  return render(
    <PushSubscriptionHealthProvider>
      <Probe />
    </PushSubscriptionHealthProvider>,
  )
}

describe("push subscription health", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("crypto", webcrypto)
    Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto })
    mocks.auth.value = {
      user: { userId: "user-1" },
      isAuthenticated: true,
      isLoading: false,
    }
    mocks.preferences.mockReset().mockResolvedValue({ pushEnabled: true })
    mocks.confirm.mockReset().mockResolvedValue(confirmed)
    mocks.publicKey.mockReset().mockResolvedValue({ available: true, publicKey: "vapid" })
    mocks.subscribe.mockReset().mockResolvedValue(undefined)
    mocks.inspect.mockReset().mockResolvedValue({ status: "subscribed", subscription })
    mocks.create.mockReset().mockResolvedValue(subscription)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (originalCrypto) Object.defineProperty(window, "crypto", originalCrypto)
    else Reflect.deleteProperty(window, "crypto")
  })

  it("automatically confirms a locally subscribed endpoint without replacing it", async () => {
    renderHealth()

    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.confirm).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      publicKey: "public-key",
      authSecret: "auth-secret",
    })
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(Object.keys(localStorage).join(" ")).not.toContain(subscription.endpoint)
  })

  it("uses the per-user, per-endpoint 24-hour confirmation cache", async () => {
    const first = renderHealth()
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    first.unmount()

    renderHealth()
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.inspect).toHaveBeenCalledTimes(2)
  })

  it("rechecks after the local confirmation cache expires", async () => {
    const first = renderHealth()
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    first.unmount()
    const endpointHash = Array.from(
      new Uint8Array(
        await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint)),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
    localStorage.setItem(
      `dirtyduty.push-confirmation.v1:user-1:${endpointHash}`,
      String(Date.now() - 25 * 60 * 60 * 1000),
    )

    renderHealth()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2))
  })

  it("throttles lifecycle checks locally for 15 minutes", async () => {
    renderHealth()
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.inspect).toHaveBeenCalledOnce()

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("pageshow"))
    })
    expect(mocks.inspect).toHaveBeenCalledOnce()

    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 15 * 60 * 1000 + 1)
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2))
  })

  it("requires an explicit gesture to create and register a missing subscription", async () => {
    mocks.inspect.mockResolvedValue({ status: "missing", subscription: null })
    renderHealth()

    await waitFor(() =>
      expect(screen.getByTestId("push-reason").textContent).toBe("missing-subscription"),
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Restore" }))

    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.create).toHaveBeenCalledWith("vapid")
    expect(mocks.subscribe).toHaveBeenCalledOnce()
    expect(mocks.confirm).toHaveBeenCalledOnce()
  })

  it("keeps an unknown endpoint unbound until explicit sync", async () => {
    mocks.confirm.mockResolvedValue({
      status: "SYNC_REQUIRED",
      lastClientConfirmedAt: null,
    })
    renderHealth()

    await waitFor(() => expect(screen.getByTestId("push-reason").textContent).toBe("sync-required"))
    expect(mocks.subscribe).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2))
    expect(mocks.confirm).toHaveBeenCalledOnce()

    mocks.confirm.mockResolvedValue(confirmed)
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.subscribe).toHaveBeenCalledOnce()
  })

  it("throttles subscription conflicts and keeps the endpoint unbound", async () => {
    mocks.subscribe.mockRejectedValue(
      new ApiError("This push subscription conflicts with the current account.", 409, "conflict"),
    )
    renderHealth()
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))

    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(screen.getByTestId("push-reason").textContent).toBe("sync-required"))
    expect(screen.getByTestId("push-message").textContent).toContain(
      "registered to another account",
    )
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(mocks.inspect.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(screen.getByTestId("push-reason").textContent).toBe("sync-required")
  })

  it("does not inspect or request permission when the saved preference is disabled", async () => {
    mocks.preferences.mockResolvedValue({ pushEnabled: false })
    renderHealth()

    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("disabled"))
    expect(mocks.inspect).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("stops lifecycle checks and recovery after push is disabled", async () => {
    renderHealth()
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    fireEvent.click(screen.getByRole("button", { name: "Disable" }))
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("disabled"))

    await act(async () => {
      window.dispatchEvent(new Event("online"))
      window.dispatchEvent(new Event("pageshow"))
    })
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))

    expect(mocks.inspect).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it.each([
    ["permission-denied", "permission-denied"],
    ["permission-required", "permission-required"],
    ["unsupported", "unsupported"],
    ["missing-registration", "missing-registration"],
    ["worker-starting", "worker-starting"],
    ["unexpected-registration", "unexpected-registration"],
  ] as const)(
    "surfaces the browser state %s without assuming subscription loss",
    async (input, output) => {
      mocks.inspect.mockResolvedValue({ status: input, subscription: null })
      renderHealth()

      await waitFor(() => {
        expect(screen.getByTestId("push-status").textContent).toBe("attention")
        expect(screen.getByTestId("push-reason").textContent).toBe(output)
      })
      expect(mocks.confirm).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    },
  )

  it("treats backend confirmation failure as unknown, not as a missing subscription", async () => {
    mocks.confirm.mockRejectedValue(new Error("network unavailable"))
    renderHealth()

    await waitFor(() => {
      expect(screen.getByTestId("push-reason").textContent).toBe("check-failed")
      expect(screen.getByTestId("push-message").textContent).toContain("Unable to check")
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("retries a failed preference lookup before checking subscription health", async () => {
    mocks.preferences
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ pushEnabled: true })
    renderHealth()

    await waitFor(() => expect(screen.getByTestId("push-reason").textContent).toBe("check-failed"))
    expect(mocks.inspect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    expect(mocks.preferences).toHaveBeenCalledTimes(2)
    expect(mocks.inspect).toHaveBeenCalledOnce()
  })

  it("deduplicates simultaneous lifecycle checks while confirmation is in flight", async () => {
    let resolveConfirmation: (value: PushSubscriptionHealth) => void = () => undefined
    mocks.confirm.mockImplementation(
      () =>
        new Promise<PushSubscriptionHealth>((resolve) => {
          resolveConfirmation = resolve
        }),
    )
    renderHealth()

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("pageshow"))
      window.dispatchEvent(new Event("online"))
    })
    expect(mocks.inspect).toHaveBeenCalledOnce()
    expect(mocks.confirm).toHaveBeenCalledOnce()

    await act(async () => resolveConfirmation(confirmed))
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
  })

  it("does not let a prior account's in-flight confirmation update the new account", async () => {
    let resolveOldConfirmation: (value: PushSubscriptionHealth) => void = () => undefined
    mocks.confirm.mockImplementationOnce(
      () =>
        new Promise<PushSubscriptionHealth>((resolve) => {
          resolveOldConfirmation = resolve
        }),
    )
    const { rerender } = renderHealth()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())

    mocks.auth.value = {
      user: { userId: "user-2" },
      isAuthenticated: true,
      isLoading: false,
    }
    rerender(
      <PushSubscriptionHealthProvider>
        <Probe />
      </PushSubscriptionHealthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("push-status").textContent).toBe("healthy"))
    await act(async () =>
      resolveOldConfirmation({
        status: "SYNC_REQUIRED",
        lastClientConfirmedAt: null,
      }),
    )
    expect(screen.getByTestId("push-status").textContent).toBe("healthy")
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    expect(keys.some((key) => key?.startsWith("dirtyduty.push-confirmation.v1:user-1:"))).toBe(
      false,
    )
  })
})
