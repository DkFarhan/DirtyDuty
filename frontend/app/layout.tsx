import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { Inter, Nunito } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
})

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-nunito",
})

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
    icon: {
      url: "/brand/dirtyduty-mark.svg",
      type: "image/svg+xml",
    },
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

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`light ${inter.variable} ${nunito.variable}`}>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
