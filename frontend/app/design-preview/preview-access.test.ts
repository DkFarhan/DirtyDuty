import { describe, expect, it } from "vitest"
import { isDesignPreviewEnabled } from "./preview-access"

describe("design preview access", () => {
  it("allows local development only", () => {
    expect(isDesignPreviewEnabled("development")).toBe(true)
    expect(isDesignPreviewEnabled("production")).toBe(false)
    expect(isDesignPreviewEnabled("test")).toBe(false)
    expect(isDesignPreviewEnabled(undefined)).toBe(false)
  })
})
