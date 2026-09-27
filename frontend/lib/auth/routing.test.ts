import { describe, expect, it } from "vitest"
import { getAuthRedirect } from "./routing"
import { getHouseholdRedirect } from "../household/routing"

describe("auth route protection", () => {
    it("does not redirect while /me restoration is loading", () => {
        expect(getAuthRedirect("dashboard", false, true)).toBeNull()
    })

    describe("household-aware routing", () => {
        it("routes empty accounts into onboarding and existing accounts to dashboard", () => {
            expect(getHouseholdRedirect("login", true, "empty", 0)).toBe("welcome")
            expect(getHouseholdRedirect("dashboard", true, "empty", 0)).toBe("welcome")
            expect(getHouseholdRedirect("login", true, "has-households", 1)).toBe("dashboard")
            expect(getHouseholdRedirect("welcome", true, "has-households", 1)).toBe("dashboard")
        })

        it("does not convert household loading or failure into an empty state", () => {
            expect(getHouseholdRedirect("dashboard", true, "loading", 0)).toBeNull()
            expect(getHouseholdRedirect("welcome", true, "error", 0)).toBeNull()
        })

        it("permits onboarding only when there are no households", () => {
            expect(getHouseholdRedirect("create-household", true, "empty", 0)).toBeNull()
            expect(getHouseholdRedirect("join-household", true, "empty", 0)).toBeNull()
            expect(getHouseholdRedirect("create-household", true, "has-households", 2)).toBe("dashboard")
            expect(getHouseholdRedirect("join-household", true, "has-households", 2)).toBe("dashboard")
        })
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
