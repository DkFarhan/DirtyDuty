import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearCsrfToken } from "@/lib/auth/api"
import { profileApi } from "./api"

describe("profile API", () => {
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

  it("loads the backend profile and sends only editable fields on save", async () => {
    const profile = {
      id: "user-1",
      displayName: "Sam",
      email: "sam@example.com",
      avatarUrl: null,
      householdName: "Home",
      assigned: 7,
      completed: 5,
      completionRate: 71,
    }
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(profile), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "profile-csrf", headerName: "X-CSRF-TOKEN" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...profile, displayName: "Sam Updated" }), { status: 200, headers: { "content-type": "application/json" } }))

    await expect(profileApi.get()).resolves.toEqual(profile)
    await expect(profileApi.update({ displayName: "Sam Updated" })).resolves.toMatchObject({ displayName: "Sam Updated" })

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/profile")
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/profile")
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ displayName: "Sam Updated" }) })
  })
})
