import { describe, expect, it } from "vitest"
import manifest from "./manifest"

describe("DirtyDuty web manifest", () => {
  it("uses the official product identity and generated app icons", () => {
    const result = manifest()

    expect(result.name).toBe("DirtyDuty")
    expect(result.short_name).toBe("DirtyDuty")
    expect(result.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icon-512.png", sizes: "512x512" }),
      ]),
    )
  })
})
