export type SafeDiagnostics = {
  route: string
  browser: string
  platform: string
  timestamp: string
}

export type ProblemReport = {
  summary: string
  details: string
  attemptedAction: string
}

export type FeedbackReport = {
  type: string
  message: string
  improvement: string
}

const supportEmailPattern =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const databaseIdPattern = /^(?:[0-9a-f]{32}|\d+)$/i

export function getSupportEmail(value = process.env.NEXT_PUBLIC_SUPPORT_EMAIL): string | null {
  const email = value?.trim() ?? ""
  return email && email.length <= 254 && supportEmailPattern.test(email) ? email : null
}

export function createSafeDiagnostics(input: {
  pathname: string
  userAgent: string
  platform: string
  timestamp: Date
}): SafeDiagnostics {
  const route = input.pathname
    .split("/")
    .map((segment) =>
      uuidPattern.test(segment) || databaseIdPattern.test(segment) ? ":id" : segment,
    )
    .join("/")
  const userAgent = input.userAgent
  const platform = input.platform

  return {
    route: route || "/",
    browser: userAgent.includes("Edg/")
      ? "Edge"
      : userAgent.includes("Firefox/")
        ? "Firefox"
        : userAgent.includes("Chrome/")
          ? "Chrome"
          : userAgent.includes("Safari/")
            ? "Safari"
            : "Other",
    platform: /iphone|ipad|ipod/i.test(userAgent)
      ? "iOS"
      : /android/i.test(userAgent)
        ? "Android"
        : /mac/i.test(platform)
          ? "macOS"
          : /win/i.test(platform)
            ? "Windows"
            : /linux/i.test(platform)
              ? "Linux"
              : "Unknown",
    timestamp: input.timestamp.toISOString(),
  }
}

export function getSafeDiagnostics(): SafeDiagnostics {
  return createSafeDiagnostics({
    pathname: window.location.pathname,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    timestamp: new Date(),
  })
}

export function formatProblemMessage(report: ProblemReport, diagnostics: SafeDiagnostics): string {
  return [
    "Hi DirtyDuty support,",
    "",
    `Summary: ${report.summary.trim()}`,
    "",
    "What happened:",
    report.details.trim(),
    ...(report.attemptedAction.trim()
      ? ["", "What I was trying to do:", report.attemptedAction.trim()]
      : []),
    "",
    "Safe diagnostics:",
    `Route: ${diagnostics.route}`,
    `Browser: ${diagnostics.browser}`,
    `Platform: ${diagnostics.platform}`,
    `Time (UTC): ${diagnostics.timestamp}`,
  ].join("\n")
}

export function formatFeedbackMessage(report: FeedbackReport): string {
  return [
    "Hi DirtyDuty team,",
    "",
    `Feedback type: ${report.type}`,
    "",
    "Feedback:",
    report.message.trim(),
    ...(report.improvement.trim()
      ? ["", "What would make DirtyDuty better:", report.improvement.trim()]
      : []),
  ].join("\n")
}

export function createMailtoHref(
  email: string | null,
  subject: string,
  body: string,
): string | null {
  if (!email) return null

  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
