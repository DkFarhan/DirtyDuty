import type { Screen } from "./types"

export type LegalReturnScreen = Extract<Screen, "privacy-security" | "legal-acceptance">
export type LegalReturnContext = LegalReturnScreen | "register"

function isLegalReturnScreen(value: string): value is LegalReturnScreen {
  return value === "privacy-security" || value === "legal-acceptance"
}

function isLegalReturnContext(value: string): value is LegalReturnContext {
  return value === "register" || isLegalReturnScreen(value)
}

export function getLegalReturnScreen(value: string | null): LegalReturnScreen | null {
  return value !== null && isLegalReturnScreen(value) ? value : null
}

export function getLegalReturnContext(value: string | null): LegalReturnContext | null {
  return value !== null && isLegalReturnContext(value) ? value : null
}

export function getLegalDocumentUrl(path: "/terms" | "/privacy", returnTo: LegalReturnContext) {
  return `${path}?returnTo=${returnTo}`
}

export function getLegalReturnUrl(value: string | null) {
  const target = getLegalReturnScreen(value)
  return target ? `/?screen=${target}` : "/"
}
