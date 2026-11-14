import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { metadata } from "./metadata"

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-variable", className: "font-class" })
  return { Inter: font, Nunito: font, Libre_Baskerville: font }
})

const LIGHT_TOP = "#edf8f4"
const DARK_TOP = "#061923"

describe("iPhone full-screen viewport", () => {
  it("draws under the status bar and home indicator", async () => {
    const { viewport } = await import("./layout")

    expect(viewport.viewportFit).toBe("cover")
    expect(viewport.width).toBe("device-width")
    expect(viewport.initialScale).toBe(1)
  })

  it("keeps the opaque default status bar so its text stays readable in both themes", () => {
    // black-translucent forces white status-bar text, which is unreadable over the light screens.
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      statusBarStyle: "default",
    })
  })

  it("keeps theme-color aligned with the top of the screens in every place it is set", async () => {
    const { viewport } = await import("./layout")

    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: LIGHT_TOP },
      { media: "(prefers-color-scheme: dark)", color: DARK_TOP },
    ])
    // The pre-paint script in the layout and the runtime ThemeProvider rewrite the meta tags.
    const layoutSource = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8")
    expect(layoutSource).toContain(`var c=d?"${DARK_TOP}":"${LIGHT_TOP}"`)
    const providerSource = readFileSync(
      new URL("../components/theme/theme-provider.tsx", import.meta.url),
      "utf8",
    )
    expect(providerSource).toContain(`meta.content = dark ? "${DARK_TOP}" : "${LIGHT_TOP}"`)
  })
})
