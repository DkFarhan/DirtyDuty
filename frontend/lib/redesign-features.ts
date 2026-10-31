export interface RedesignFeatureFlags {
  redesignedHomeEnabled: boolean
  redesignedMyChoresEnabled: boolean
  redesignedHouseholdEnabled: boolean
}

export interface RedesignFeatureEnvironment {
  DIRTYDUTY_REDESIGNED_HOME?: string
  DIRTYDUTY_REDESIGNED_MY_CHORES?: string
  DIRTYDUTY_REDESIGNED_HOUSEHOLD?: string
}

export function getRedesignFeatureFlags(
  nodeEnvironment = process.env.NODE_ENV,
  environment: RedesignFeatureEnvironment = {
    DIRTYDUTY_REDESIGNED_HOME: process.env.DIRTYDUTY_REDESIGNED_HOME,
    DIRTYDUTY_REDESIGNED_MY_CHORES: process.env.DIRTYDUTY_REDESIGNED_MY_CHORES,
    DIRTYDUTY_REDESIGNED_HOUSEHOLD: process.env.DIRTYDUTY_REDESIGNED_HOUSEHOLD,
  },
): RedesignFeatureFlags {
  const development = nodeEnvironment === "development"
  return {
    redesignedHomeEnabled: development && environment.DIRTYDUTY_REDESIGNED_HOME === "true",
    redesignedMyChoresEnabled: development && environment.DIRTYDUTY_REDESIGNED_MY_CHORES === "true",
    redesignedHouseholdEnabled:
      development && environment.DIRTYDUTY_REDESIGNED_HOUSEHOLD === "true",
  }
}
