import { describe, expect, it } from "vitest"
import { getRedesignFeatureFlags } from "./redesign-features"

describe("redesign feature flags", () => {
  it("defaults all redesign screens off in production", () => {
    expect(getRedesignFeatureFlags("development", {})).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
      redesignedProfileEnabled: false,
    })
    expect(getRedesignFeatureFlags("production", {})).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
      redesignedProfileEnabled: false,
    })
  })

  it("enables each production screen independently", () => {
    expect(
      getRedesignFeatureFlags("production", {
        DIRTYDUTY_REDESIGNED_HOME: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: true,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
      redesignedProfileEnabled: false,
    })
    expect(
      getRedesignFeatureFlags("production", {
        DIRTYDUTY_REDESIGNED_MY_CHORES: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: true,
      redesignedHouseholdEnabled: false,
      redesignedProfileEnabled: false,
    })
    expect(
      getRedesignFeatureFlags("production", {
        DIRTYDUTY_REDESIGNED_HOUSEHOLD: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: true,
      redesignedProfileEnabled: false,
    })
    expect(
      getRedesignFeatureFlags("production", {
        DIRTYDUTY_REDESIGNED_PROFILE: "true",
      }),
    ).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
      redesignedProfileEnabled: true,
    })
  })

  it("enables all screens when all four production values are exactly true", () => {
    const environment = {
      DIRTYDUTY_REDESIGNED_HOME: "true",
      DIRTYDUTY_REDESIGNED_MY_CHORES: "true",
      DIRTYDUTY_REDESIGNED_HOUSEHOLD: "true",
      DIRTYDUTY_REDESIGNED_PROFILE: "true",
    }

    expect(getRedesignFeatureFlags("production", environment)).toEqual({
      redesignedHomeEnabled: true,
      redesignedMyChoresEnabled: true,
      redesignedHouseholdEnabled: true,
      redesignedProfileEnabled: true,
    })
  })

  it("keeps all screens off for missing or non-exact true production values", () => {
    expect(
      getRedesignFeatureFlags("production", {
        DIRTYDUTY_REDESIGNED_HOME: "TRUE",
        DIRTYDUTY_REDESIGNED_MY_CHORES: "1",
        DIRTYDUTY_REDESIGNED_HOUSEHOLD: " true",
        DIRTYDUTY_REDESIGNED_PROFILE: "false",
      }),
    ).toEqual({
      redesignedHomeEnabled: false,
      redesignedMyChoresEnabled: false,
      redesignedHouseholdEnabled: false,
      redesignedProfileEnabled: false,
    })
  })

  it("keeps the existing local development opt-in and disables flags in tests", () => {
    expect(
      getRedesignFeatureFlags("development", {
        DIRTYDUTY_REDESIGNED_HOME: "true",
      }).redesignedHomeEnabled,
    ).toBe(true)
    expect(
      getRedesignFeatureFlags("test", {
        DIRTYDUTY_REDESIGNED_HOME: "true",
      }).redesignedHomeEnabled,
    ).toBe(false)
  })
})
