import { AppShell } from "@/components/chore-sync/app-shell"
import { getRedesignFeatureFlags } from "@/lib/redesign-features"

export default function JoinPage() {
  return <AppShell initialScreen="register" {...getRedesignFeatureFlags()} />
}
