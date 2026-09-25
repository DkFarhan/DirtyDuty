import type { Screen } from "../chore-sync/types"

const protectedScreens = new Set<Screen>([
    "welcome",
    "create-household",
    "join-household",
    "dashboard",
    "my-chores",
    "household",
    "admin",
    "create-chore",
    "profile",
])

export function getAuthRedirect(screen: Screen, isAuthenticated: boolean, isLoading: boolean): Screen | null {
    if (isLoading) return null
    if (!isAuthenticated && protectedScreens.has(screen)) return "login"
    if (isAuthenticated && (screen === "login" || screen === "register")) return "welcome"
    return null
}
