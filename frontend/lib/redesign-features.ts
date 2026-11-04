import { connection } from "next/server"

export interface RedesignFeatureFlags {
  redesignedHomeEnabled: boolean
  redesignedMyChoresEnabled: boolean
  redesignedHouseholdEnabled: boolean
  redesignedProfileEnabled: boolean
}

export interface RedesignFeatureEnvironment {
  DIRTYDUTY_REDESIGNED_HOME?: string
  DIRTYDUTY_REDESIGNED_MY_CHORES?: string
  DIRTYDUTY_REDESIGNED_HOUSEHOLD?: string
  DIRTYDUTY_REDESIGNED_PROFILE?: string
}

export function getRedesignFeatureFlags(
  nodeEnvironment = process.env.NODE_ENV,
  environment: RedesignFeatureEnvironment = {
    DIRTYDUTY_REDESIGNED_HOME: process.env.DIRTYDUTY_REDESIGNED_HOME,
    DIRTYDUTY_REDESIGNED_MY_CHORES: process.env.DIRTYDUTY_REDESIGNED_MY_CHORES,
    DIRTYDUTY_REDESIGNED_HOUSEHOLD: process.env.DIRTYDUTY_REDESIGNED_HOUSEHOLD,
    DIRTYDUTY_REDESIGNED_PROFILE: process.env.DIRTYDUTY_REDESIGNED_PROFILE,
  },
): RedesignFeatureFlags {
  const enabledEnvironment = nodeEnvironment === "development" || nodeEnvironment === "production"
  return {
    redesignedHomeEnabled: enabledEnvironment && environment.DIRTYDUTY_REDESIGNED_HOME === "true",
    redesignedMyChoresEnabled:
      enabledEnvironment && environment.DIRTYDUTY_REDESIGNED_MY_CHORES === "true",
    redesignedHouseholdEnabled:
      enabledEnvironment && environment.DIRTYDUTY_REDESIGNED_HOUSEHOLD === "true",
    redesignedProfileEnabled:
      enabledEnvironment && environment.DIRTYDUTY_REDESIGNED_PROFILE === "true",
  }
}

export async function getRuntimeRedesignFeatureFlags(): Promise<RedesignFeatureFlags> {
  await connection()
  return getRedesignFeatureFlags(process.env.NODE_ENV, {
    DIRTYDUTY_REDESIGNED_HOME: process.env.DIRTYDUTY_REDESIGNED_HOME,
    DIRTYDUTY_REDESIGNED_MY_CHORES: process.env.DIRTYDUTY_REDESIGNED_MY_CHORES,
    DIRTYDUTY_REDESIGNED_HOUSEHOLD: process.env.DIRTYDUTY_REDESIGNED_HOUSEHOLD,
    DIRTYDUTY_REDESIGNED_PROFILE: process.env.DIRTYDUTY_REDESIGNED_PROFILE,
  })
}
