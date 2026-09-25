import { describe, expect, it } from "vitest"
import { getAuthRedirect } from "./routing"

describe("auth route protection", () => {
    it("does not redirect while /me restoration is loading", () => {
        expect(getAuthRedirect("dashboard", false, true)).toBeNull()
    })

    it("redirects unauthenticated users away from protected screens", () => {
        expect(getAuthRedirect("dashboard", false, false)).toBe("login")
        expect(getAuthRedirect("profile", false, false)).toBe("login")
    })

    it("redirects authenticated users away from login and registration", () => {
        expect(getAuthRedirect("login", true, false)).toBe("welcome")
        expect(getAuthRedirect("register", true, false)).toBe("welcome")
    })

    it("leaves public login and authenticated protected screens unchanged", () => {
        expect(getAuthRedirect("login", false, false)).toBeNull()
        expect(getAuthRedirect("dashboard", true, false)).toBeNull()
    })
})
