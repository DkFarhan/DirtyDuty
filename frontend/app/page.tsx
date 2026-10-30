import { AppShell } from "@/components/chore-sync/app-shell"
import { getRedesignFeatureFlags } from "@/lib/redesign-features"

export default function Page() {
  return <AppShell {...getRedesignFeatureFlags()} />
}
