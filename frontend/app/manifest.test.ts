import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import manifest from "./manifest"
import { metadata } from "./metadata"

function pngSize(path: string) {
  const data = readFileSync(new URL(path, import.meta.url))
  return [data.readUInt32BE(16), data.readUInt32BE(20)]
}

describe("DirtyDuty web manifest", () => {
  it("uses the official product identity and generated app icons", () => {
    const result = manifest()

    expect(result.name).toBe("DirtyDuty")
    expect(result.short_name).toBe("DirtyDuty")
    expect(result.icons).toEqual([
      expect.objectContaining({
        src: "/icon-192.png",
        sizes: "192x192",
        purpose: "any",
      }),
      expect.objectContaining({
        src: "/icon-512.png",
        sizes: "512x512",
        purpose: "any",
      }),
    ])
    expect(pngSize("../public/icon-192.png")).toEqual([192, 192])
    expect(pngSize("../public/icon-512.png")).toEqual([512, 512])
    expect(pngSize("./apple-icon.png")).toEqual([180, 180])
  })

  it("uses the dedicated light-background browser favicon and app artwork for Apple", () => {
    expect(metadata.icons).toMatchObject({
      icon: [
        { url: "/brand/dirtyduty-favicon.svg", type: "image/svg+xml" },
        { url: "/brand/dirtyduty-favicon.png", type: "image/png" },
      ],
      apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
    })
    expect(metadata.title).toEqual({
      default: "DirtyDuty — Keep your home running smoothly",
      template: "%s | DirtyDuty",
    })
    expect(metadata.description).toContain("DirtyDuty")
  })
})
