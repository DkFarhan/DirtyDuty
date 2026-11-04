import type { Metadata } from "next"
import { AppShell } from "@/components/chore-sync/app-shell"
import { getRuntimeRedesignFeatureFlags } from "@/lib/redesign-features"

export const metadata: Metadata = {
  title: "Reset password | DirtyDuty",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function ResetPasswordPage() {
  return <AppShell initialScreen="reset-password" {...await getRuntimeRedesignFeatureFlags()} />
}
