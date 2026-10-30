export interface RedesignFeatureFlags {
  redesignedHomeEnabled: boolean
  redesignedMyChoresEnabled: boolean
}

export interface RedesignFeatureEnvironment {
  DIRTYDUTY_REDESIGNED_HOME?: string
  DIRTYDUTY_REDESIGNED_MY_CHORES?: string
}

export function getRedesignFeatureFlags(
  nodeEnvironment = process.env.NODE_ENV,
  environment: RedesignFeatureEnvironment = {
    DIRTYDUTY_REDESIGNED_HOME: process.env.DIRTYDUTY_REDESIGNED_HOME,
    DIRTYDUTY_REDESIGNED_MY_CHORES: process.env.DIRTYDUTY_REDESIGNED_MY_CHORES,
  },
): RedesignFeatureFlags {
  const development = nodeEnvironment === "development"
  return {
    redesignedHomeEnabled: development && environment.DIRTYDUTY_REDESIGNED_HOME === "true",
    redesignedMyChoresEnabled: development && environment.DIRTYDUTY_REDESIGNED_MY_CHORES === "true",
  }
}
