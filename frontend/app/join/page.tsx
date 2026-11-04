import { AppShell } from "@/components/chore-sync/app-shell"
import { getRuntimeRedesignFeatureFlags } from "@/lib/redesign-features"

export default async function JoinPage() {
  return <AppShell initialScreen="register" {...await getRuntimeRedesignFeatureFlags()} />
}
