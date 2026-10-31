import { Analytics } from "@vercel/analytics/next"
import type { Viewport } from "next"
import { Inter, Libre_Baskerville, Nunito } from "next/font/google"
import "./globals.css"
import { metadata } from "./metadata"

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "800"],
  variable: "--font-inter",
})

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-nunito",
})

const householdSerif = Libre_Baskerville({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-household-serif",
})

export { metadata }

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0d9488" },
    { media: "(prefers-color-scheme: dark)", color: "#181a20" },
  ],
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
    <html
      lang="en"
      className={`${inter.variable} ${nunito.variable} ${householdSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem("dirtyduty-theme")}catch{}var d=t==="dark"||(t!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";var c=d?"#181a20":"#0d9488";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c})})()`,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
