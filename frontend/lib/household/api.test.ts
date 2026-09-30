import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearCsrfToken } from "@/lib/auth/api"
import { ApiError } from "@/lib/auth/api"
import { householdApi } from "./api"

describe("household API", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    clearCsrfToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearCsrfToken()
  })

  it("creates invitations with a bodyless POST through the shared CSRF-aware client", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "invite-csrf",
        headerName: "X-CSRF-TOKEN",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        inviteCode: "AbC123",
        expiresAt: "2026-09-26T12:00:00Z",
      }), { status: 200, headers: { "content-type": "application/json" } }))

    await expect(householdApi.createInvitation("household/1")).resolves.toEqual({
      inviteCode: "AbC123",
      expiresAt: "2026-09-26T12:00:00Z",
    })

    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8080/api/households/household%2F1/invitations")
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: undefined,
    })
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-CSRF-TOKEN")).toBe("invite-csrf")
  })

  it("uses safe invite and membership messages without exposing backend details", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "join-csrf",
        headerName: "X-CSRF-TOKEN",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: "internal database exception",
      }), { status: 400, headers: { "content-type": "application/json" } }))

    const invalidInvite = await householdApi.join("AbC123").catch((error) => error)
    expect(invalidInvite).toBeInstanceOf(ApiError)
    if (!(invalidInvite instanceof ApiError)) throw invalidInvite
    expect(invalidInvite.message).toBe("Invite code is invalid or no longer available.")

    clearCsrfToken()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "join-csrf",
        headerName: "X-CSRF-TOKEN",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: "internal database exception",
      }), { status: 409, headers: { "content-type": "application/json" } }))

    const activeMember = await householdApi.join("AbC123").catch((error) => error)
    expect(activeMember).toBeInstanceOf(ApiError)
    if (!(activeMember instanceof ApiError)) throw activeMember
    expect(activeMember.message).toBe("You are already a member of this household.")
    expect(activeMember.message).not.toContain("internal")
  })

  it("uses household settings and leave contracts without sending read-only fields", async () => {
    const settings = {
      id: "home/1",
      name: "Home",
      description: "Shared place",
      timezone: "America/Sao_Paulo",
      currentUserRole: "OWNER",
      createdAt: "2026-09-25T12:00:00Z",
    }
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(settings), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "settings-csrf", headerName: "X-CSRF-TOKEN" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...settings, name: "Updated Home" }), { status: 200, headers: { "content-type": "application/json" } }))

    await expect(householdApi.settings("home/1")).resolves.toEqual(settings)
    await expect(householdApi.updateSettings("home/1", {
      name: "Updated Home",
      description: null,
      timezone: "America/Sao_Paulo",
    })).resolves.toMatchObject({ name: "Updated Home" })
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/households/home%2F1/settings")
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/households/home%2F1/settings")
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ name: "Updated Home", description: null, timezone: "America/Sao_Paulo" }),
    })

    clearCsrfToken()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "leave-csrf", headerName: "X-CSRF-TOKEN" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(householdApi.leave("home/1")).resolves.toBeNull()
    expect(fetchMock.mock.calls[4][0]).toBe("http://localhost:8080/api/households/home%2F1/leave")
    expect(fetchMock.mock.calls[4][1]).toMatchObject({ method: "POST", body: undefined })
  })
})
