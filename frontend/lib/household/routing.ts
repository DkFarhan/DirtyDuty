import type { Screen } from "@/lib/chore-sync/types"
import type { HouseholdStatus } from "./household-context"

const onboardingScreens = new Set<Screen>(["welcome", "create-household", "join-household"])
const authenticatedScreens = new Set<Screen>([
  "welcome",
  "create-household",
  "join-household",
  "dashboard",
  "my-chores",
  "household",
  "admin",
  "create-chore",
  "profile",
  "household-settings",
  "notifications",
  "edit-profile",
  "privacy-security",
  "help-support",
])

export function getHouseholdRedirect(
  screen: Screen,
  isAuthenticated: boolean,
  status: HouseholdStatus,
  householdsCount: number,
): Screen | null {
  if (!isAuthenticated || status === "loading" || status === "error") return null
  if (screen === "login" || screen === "register") {
    return householdsCount > 0 ? "dashboard" : "welcome"
  }
  if (!authenticatedScreens.has(screen)) return null
  if (householdsCount > 0 && onboardingScreens.has(screen)) return "dashboard"
  if (householdsCount === 0 && !onboardingScreens.has(screen)) return "welcome"
  return null
}
