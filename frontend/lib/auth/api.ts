const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "")

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

type ApiRequestOptions = {
    method?: HttpMethod
    body?: unknown
    headers?: Record<string, string>
}

export type ApiErrorKind = "validation" | "unauthenticated" | "forbidden" | "conflict" | "server" | "network"

export class ApiError extends Error {
    readonly status: number | null
    readonly kind: ApiErrorKind

    constructor(message: string, status: number | null, kind: ApiErrorKind) {
        super(message)
        this.name = "ApiError"
        this.status = status
        this.kind = kind
    }
}

type CsrfResponse = {
    token: string
    headerName: string
}

let csrfState: CsrfResponse | null = null

function errorKind(status: number): ApiErrorKind {
    if (status === 401) return "unauthenticated"
    if (status === 403) return "forbidden"
    if (status === 409) return "conflict"
    if (status >= 400 && status < 500) return "validation"
    return "server"
}

function messageFor(status: number, path: string): string {
    if (status === 401 && path === "/api/auth/login") return "Invalid email or password"
    if (status === 401 && path === "/api/auth/logout") {
        return "Unable to confirm sign out. Your session may still be active."
    }
    if (status === 401) return "Your session could not be verified. Please sign in again."
    if (status === 400 && path === "/api/households/join") {
        return "Invite code is invalid or no longer available."
    }
    if (status === 403 && path.startsWith("/api/households")) {
        return "You are not authorized to perform this household action."
    }
    if (status === 403) return "Your security token expired. Please try again."
    if (status === 409 && path === "/api/auth/register") return "An account with this email already exists."
    if (status === 409 && path === "/api/households/join") return "You are already a member of this household."
    if (status === 409) return "This request conflicts with the current state."
    if (status >= 400 && status < 500) return "Please check your information and try again."
    return "Something went wrong. Please try again."
}

async function readPayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) return null

    try {
        return await response.json()
    } catch {
        return null
    }
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET"
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set("Content-Type", "application/json")

    if (method !== "GET") {
        const csrf = await getCsrfToken()
        headers.set(csrf.headerName, csrf.token)
    }

    let response: Response
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            credentials: "include",
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        })
    } catch {
        throw new ApiError("Unable to connect to DirtyDuty. Please try again.", null, "network")
    }

    if (!response.ok) {
        if (response.status === 403) csrfState = null
        throw new ApiError(messageFor(response.status, path), response.status, errorKind(response.status))
    }

    const payload = await readPayload(response)
    return payload as T
}

export async function getCsrfToken(): Promise<CsrfResponse> {
    if (csrfState) return csrfState

    let response: Response
    try {
        response = await fetch(`${API_BASE_URL}/api/auth/csrf`, { credentials: "include" })
    } catch {
        throw new ApiError("Unable to connect to DirtyDuty. Please try again.", null, "network")
    }

    const payload = response.ok ? await readPayload(response) : null
    if (!response.ok || !payload || typeof payload !== "object" || !("token" in payload) || !("headerName" in payload)) {
        throw new ApiError(messageFor(response.status, "/api/auth/csrf"), response.status, errorKind(response.status))
    }

    csrfState = {
        token: String(payload.token),
        headerName: String(payload.headerName),
    }
    return csrfState
}

export function clearCsrfToken() {
    csrfState = null
}

export const api = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
