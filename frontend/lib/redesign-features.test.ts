import { describe, expect, it } from "vitest"
import { getRedesignFeatureFlags } from "./redesign-features"

describe("redesign feature flags", () => {
  it("defaults both screens off", () => {
    expect(getRedesignFeatureFlags("development", {})).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
    })
  })

  it("enables each flag independently in development only", () => {
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_HOME: "true",
      }),
    ).toEqual({ redesignedHomeEnabled: true, redesignedMyChoresEnabled: false })
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_MY_CHORES: "true",
      }),
    ).toEqual({ redesignedHomeEnabled: false, redesignedMyChoresEnabled: true })
  })

  it("forces both screens off outside development even when configured", () => {
    const environment = {
      DIRTYDUTY_REDESIGNED_HOME: "true",
      DIRTYDUTY_REDESIGNED_MY_CHORES: "true",
    }

    expect(getRedesignFeatureFlags("production", environment)).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
    })
  })
})
