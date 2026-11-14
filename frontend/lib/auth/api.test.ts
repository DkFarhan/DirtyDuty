import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, api, clearCsrfToken, getCsrfToken } from "./api"

describe("auth API client", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    clearCsrfToken()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches CSRF with credentials and keeps the token in memory", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await expect(getCsrfToken()).resolves.toEqual({
      token: "csrf-token",
      headerName: "X-CSRF-TOKEN",
    })
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/auth/csrf", {
      credentials: "include",
    })
    expect(globalThis.localStorage).toBeUndefined()
    expect(globalThis.sessionStorage).toBeUndefined()
  })

  it("includes credentials and the CSRF header on POST, PUT, PATCH, and DELETE", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

    await api.post("/api/auth/login", { email: "user@example.com", password: "not-logged" })
    await api.put("/api/test", { value: 1 })
    await api.patch("/api/test", { value: 2 })
    await api.delete("/api/test")

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "user@example.com", password: "not-logged" }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(5)
    for (const [, options] of fetchMock.mock.calls.slice(1)) {
      expect(options.credentials).toBe("include")
      expect(options.headers.get("X-CSRF-TOKEN")).toBe("csrf-token")
    }
  })

  it("does not attach CSRF to GET requests", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await api.get("/api/auth/me")
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/auth/me", {
      method: "GET",
      credentials: "include",
      headers: expect.any(Headers),
      body: undefined,
    })
    expect(fetchMock.mock.calls[0][1].headers.has("X-CSRF-TOKEN")).toBe(false)
  })

  it("handles a successful 204 mutation response", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(api.post<void>("/api/auth/logout")).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not imply logout succeeded when the server rejects it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }))

    const error = await api.post("/api/auth/logout").catch((requestError) => requestError)
    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw error
    expect(error.message).toBe("Unable to confirm sign out. Your session may still be active.")
  })

  it("normalizes non-JSON server errors and network failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("database exploded", { status: 500 }))
    await expect(api.get("/api/auth/me")).rejects.toMatchObject({
      kind: "server",
      message: "Something went wrong. Please try again.",
    })

    fetchMock.mockRejectedValueOnce(new TypeError("offline"))
    await expect(api.get("/api/auth/me")).rejects.toMatchObject({
      kind: "network",
      message: "Unable to connect to DirtyDuty. Please try again.",
    })
  })

  it("invalidates a cached CSRF token on 403 without replaying the unsafe request", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "old-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }))

    await expect(api.post("/api/auth/logout")).rejects.toMatchObject({ kind: "forbidden" })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "new-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await api.post("/api/auth/logout")
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[3][1].headers.get("X-CSRF-TOKEN")).toBe("new-token")
  })

  it("normalizes duplicate and validation responses without exposing backend internals", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "A user with this email already exists." }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      )

    const error = await api
      .post("/api/auth/register", { email: "user@example.com" })
      .catch((requestError) => requestError)

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw error
    expect(error.status).toBe(409)
    expect(error.kind).toBe("conflict")
    expect(error.message).toBe(
      "Unable to complete registration with this email. If you've registered before, try signing in or recovering your account.",
    )
    expect(error.message).not.toContain("SQL")

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: "<img src=x onerror=alert(1)> internal stack trace" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    )

    const validationError = await api
      .post("/api/auth/register", {})
      .catch((requestError) => requestError)
    expect(validationError).toBeInstanceOf(ApiError)
    if (!(validationError instanceof ApiError)) throw validationError
    expect(validationError.message).toBe("Please check your information and try again.")
    expect(validationError.message).not.toContain("internal stack trace")
    expect(validationError.message).not.toContain("<img")
  })

  it("shows the safe recurring-history explanation only for chore updates", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message:
              "A recurring chore with existing assignment history cannot be converted to one-time. Create a separate one-time chore to preserve its history.",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )

    await expect(
      api.put("/api/households/home-1/chores/chore-1", {
        schedule: { recurrenceRule: "FREQ=ONCE" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "This chore has recurring assignment history and can't be changed to a one-time chore. Keep its recurring schedule or create a new one-time chore.",
    })
  })

  it("shows the known occurrence action messages and hides anything else", async () => {
    const failure = (message: string) =>
      new Response(JSON.stringify({ message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(failure("This chore is already scheduled on that day."))
      .mockResolvedValueOnce(failure("Choose between 1 and 3 people for this chore."))
      .mockResolvedValueOnce(failure("Internal validation detail"))

    await expect(
      api.post("/api/households/h/assignments/a/move", { date: "2026-11-20" }),
    ).rejects.toMatchObject({ message: "This chore is already scheduled on that day." })
    await expect(
      api.put("/api/households/h/assignments/a/assignees", { userIds: [] }),
    ).rejects.toMatchObject({ message: "Choose between 1 and 3 people for this chore." })
    await expect(api.post("/api/households/h/assignments/a/skip")).rejects.toMatchObject({
      message: "Please check your information and try again.",
    })
  })

  it("shows the known chore-category messages and hides anything else", async () => {
    const csrf = () =>
      new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    const failure = (status: number, message: string) =>
      new Response(JSON.stringify({ message }), {
        status,
        headers: { "content-type": "application/json" },
      })
    fetchMock
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(failure(409, "A category with this name already exists."))
      .mockResolvedValueOnce(failure(400, "A household can have at most 40 categories."))
      .mockResolvedValueOnce(
        failure(400, "The new order must list every category in this household exactly once."),
      )
      .mockResolvedValueOnce(failure(404, "Category was not found in this household."))
      .mockResolvedValueOnce(failure(400, "Internal validation detail"))

    await expect(
      api.post("/api/households/home-1/chore-categories", { name: "Kitchen" }),
    ).rejects.toMatchObject({ status: 409, message: "A category with this name already exists." })
    await expect(
      api.post("/api/households/home-1/chore-categories", { name: "One more" }),
    ).rejects.toMatchObject({ message: "A household can have at most 40 categories." })
    await expect(
      api.put("/api/households/home-1/chore-categories/order", { categoryIds: [] }),
    ).rejects.toMatchObject({
      message: "The new order must list every category in this household exactly once.",
    })
    await expect(api.delete("/api/households/home-1/chore-categories/cat-1")).rejects.toMatchObject(
      { status: 404, message: "Category was not found in this household." },
    )
    await expect(
      api.put("/api/households/home-1/chore-categories/cat-1", { name: "x" }),
    ).rejects.toMatchObject({ message: "Please check your information and try again." })
  })

  it("does not expose other chore-update validation messages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Internal validation detail" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )

    await expect(
      api.put("/api/households/home-1/chores/chore-1", { title: "Changed title" }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Please check your information and try again.",
    })
  })

  it("preserves only safe email-verification errors needed for recovery", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "The verification code is invalid or expired.",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )

    const error = await api
      .post("/api/auth/email-verification/verify", { code: "000000" })
      .catch((requestError) => requestError)

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw error
    expect(error.message).toBe("The verification code is invalid or expired.")
  })

  it("preserves the same-password recovery error for the recovery form", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "Your new password must be different from your current password.",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )

    const error = await api
      .post("/api/auth/email-verification/recovery/complete", {
        email: "person@example.com",
        code: "123456",
        newPassword: "OriginalPassword123!",
      })
      .catch((requestError) => requestError)

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw error
    expect(error.message).toBe("Your new password must be different from your current password.")
  })

  it("preserves the structured owned-household conflict payload for the account deletion blocker", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token", headerName: "X-CSRF-TOKEN" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 409,
            error: "Conflict",
            message: "You still own households.",
            ownedHouseholds: [{ id: "household-1", name: "Maple House" }],
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      )

    const error = await api
      .post("/api/auth/delete-account", {
        password: "password",
        email: "user@example.com",
      })
      .catch((requestError) => requestError)

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw error
    expect(error.kind).toBe("conflict")
    expect(error.message).toBe("You still own households.")
    expect(error.details).toMatchObject({
      ownedHouseholds: [{ id: "household-1", name: "Maple House" }],
    })
  })
})
