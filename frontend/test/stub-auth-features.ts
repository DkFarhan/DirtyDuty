import { vi } from "vitest"

export function stubAuthFeatures(
  fetchMock: typeof fetch,
  features = { google: false, passwordReset: false, emailVerification: false },
) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/auth/providers")) {
      return Promise.resolve(
        new Response(JSON.stringify(features), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    }
    return fetchMock(input, init)
  })
}
