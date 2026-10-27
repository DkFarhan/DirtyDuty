import type { Metadata } from "next"
import { HomeInSyncHero } from "@/components/landing/home-in-sync-hero"

export const metadata: Metadata = {
  title: "Home, In Sync — DirtyDuty",
  description: "Share chores, keep things fair, and make more time for what matters.",
  robots: { index: false, follow: false },
}

export default function LandingPage() {
  return <HomeInSyncHero />
}
