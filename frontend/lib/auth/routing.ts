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
  "appearance",
  "household-settings",
  "privacy-security",
  "legal-acceptance",
])

export function getAuthRedirect(
  screen: Screen,
  isAuthenticated: boolean,
  isLoading: boolean,
  emailVerified = true,
): Screen | null {
  if (isLoading) return null
  if (!isAuthenticated && protectedScreens.has(screen)) return "login"
  if (!isAuthenticated && screen === "verify-email") return "login"
  if (isAuthenticated && !emailVerified && screen !== "verify-email") return "verify-email"
  if (isAuthenticated && emailVerified && screen === "verify-email") return "welcome"
  if (isAuthenticated && (screen === "login" || screen === "register")) return "welcome"
  return null
}
