import type { Screen } from "./types"

export type LegalReturnScreen = Extract<Screen, "privacy-security" | "legal-acceptance">

function isLegalReturnScreen(value: string): value is LegalReturnScreen {
  return value === "privacy-security" || value === "legal-acceptance"
}

export function getLegalReturnScreen(value: string | null): LegalReturnScreen | null {
  return value !== null && isLegalReturnScreen(value) ? value : null
}

export function getLegalDocumentUrl(path: "/terms" | "/privacy", returnTo: LegalReturnScreen) {
  return `${path}?returnTo=${returnTo}`
}

export function getLegalReturnUrl(value: string | null) {
  const target = getLegalReturnScreen(value)
  return target ? `/?screen=${target}` : "/"
}
