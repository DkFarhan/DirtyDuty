import type { Metadata } from "next"
import { AppShell } from "@/components/chore-sync/app-shell"
import { getRedesignFeatureFlags } from "@/lib/redesign-features"

export const metadata: Metadata = {
  title: "Reset password | DirtyDuty",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default function ResetPasswordPage() {
  return <AppShell initialScreen="reset-password" {...getRedesignFeatureFlags()} />
}
