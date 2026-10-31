import { describe, expect, it } from "vitest"
import { getRedesignFeatureFlags } from "./redesign-features"

describe("redesign feature flags", () => {
  it("defaults both screens off", () => {
    expect(getRedesignFeatureFlags("development", {})).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
    })
  })

  it("enables each flag independently in development only", () => {
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_HOME: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: true,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
    })
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_MY_CHORES: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: true,
      redesignedHouseholdEnabled: false,
    })
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_HOUSEHOLD: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: true,
    })
  })

  it("forces both screens off outside development even when configured", () => {
    const environment = {
      DIRTYDUTY_REDESIGNED_HOME: "true",
      DIRTYDUTY_REDESIGNED_MY_CHORES: "true",
      DIRTYDUTY_REDESIGNED_HOUSEHOLD: "true",
    }

    expect(getRedesignFeatureFlags("production", environment)).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
    })
  })

  it("requires the exact true value for the Household flag", () => {
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_HOUSEHOLD: "TRUE",
      }).redesignedHouseholdEnabled,
    ).toBe(false)
  })
})
