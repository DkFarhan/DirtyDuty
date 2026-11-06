"use client"

import { ThemeSelector } from "@/components/theme/theme-selector"
import { useChoreSync } from "@/lib/chore-sync/store"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileDestinationHeader, ProfileDestinationView } from "./profile-screen-view"
import styles from "./profile-screen-view.module.css"

export function AppearanceScreen({ theme = "light" }: { theme?: Exclude<Theme, "system"> }) {
  const { navigate } = useChoreSync()

  return (
    <ProfileDestinationView destination="appearance" theme={theme}>
      {
        <ProfileDestinationHeader
          eyebrow="DISPLAY PREFERENCES"
          title="Appearance"
          back={() => navigate("profile")}
          theme={theme}
        />
      }
      <main className={styles.appearanceMain}>
        {
          <div className={styles.appearanceIntro}>
            <h2>Make it yours.</h2>
            <p>Choose how DirtyDuty looks on this device.</p>
          </div>
        }
        <ThemeSelector />
      </main>
    </ProfileDestinationView>
  )
}
