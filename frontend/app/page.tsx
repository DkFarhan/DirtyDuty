import { AppShell } from "@/components/chore-sync/app-shell"
import { getRuntimeRedesignFeatureFlags } from "@/lib/redesign-features"

export default async function Page() {
  return <AppShell {...await getRuntimeRedesignFeatureFlags()} />
}
