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
  "display-name-personalization",
])

export function getAuthRedirect(
  screen: Screen,
  isAuthenticated: boolean,
  isLoading: boolean,
  emailVerified = true,
  displayNamePersonalizationPending = false,
): Screen | null {
  if (isLoading) return null
  if (!isAuthenticated && protectedScreens.has(screen)) return "login"
  if (!isAuthenticated && screen === "verify-email") return "login"
  if (isAuthenticated && !emailVerified && screen !== "verify-email") return "verify-email"
  if (isAuthenticated && emailVerified && screen === "verify-email") return "welcome"
  if (
    isAuthenticated &&
    emailVerified &&
    displayNamePersonalizationPending &&
    screen !== "display-name-personalization" &&
    screen !== "legal-acceptance" &&
    screen !== "privacy-security" &&
    screen !== "forgot-password" &&
    screen !== "reset-password"
  ) {
    return "display-name-personalization"
  }
  if (
    isAuthenticated &&
    emailVerified &&
    !displayNamePersonalizationPending &&
    screen === "display-name-personalization"
  ) {
    return "welcome"
  }
  if (isAuthenticated && (screen === "login" || screen === "register")) return "welcome"
  return null
}
