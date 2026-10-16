import type { Metadata } from "next"

export const metadata: Metadata = {
  applicationName: "DirtyDuty",
  title: {
    default: "DirtyDuty — Keep your home running smoothly",
    template: "%s | DirtyDuty",
  },
  description:
    "DirtyDuty is a mobile-first household chore management app. Track chores, share your household, and keep everyone in sync.",
  generator: "v0.app",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/brand/dirtyduty-favicon.svg",
        type: "image/svg+xml",
      },
      {
        url: "/brand/dirtyduty-favicon.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/apple-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  openGraph: {
    type: "website",
    siteName: "DirtyDuty",
    title: "DirtyDuty — Keep your home running smoothly",
    description:
      "DirtyDuty is a mobile-first household chore management app. Track chores, share your household, and keep everyone in sync.",
  },
  twitter: {
    card: "summary",
    title: "DirtyDuty — Keep your home running smoothly",
    description:
      "DirtyDuty is a mobile-first household chore management app. Track chores, share your household, and keep everyone in sync.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DirtyDuty",
  },
}
