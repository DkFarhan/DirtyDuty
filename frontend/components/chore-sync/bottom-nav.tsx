"use client"

import type { ComponentType, SVGProps } from "react"
import type { Screen } from "@/lib/chore-sync/types"
import { HomeIcon, ListIcon, PersonIcon, UsersIcon } from "./icons"
import styles from "./bottom-nav.module.css"

export type NavKey = "dashboard" | "my-chores" | "household" | "profile"

interface TabDef {
  id: NavKey
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement> & { active?: boolean }>
}

/**
 * Data-driven tab list. Add a future destination (e.g. "leaderboard") by
 * appending one entry here — nothing else in the shell needs to change.
 */
const tabs: TabDef[] = [
  { id: "dashboard", label: "Home", icon: HomeIcon },
  { id: "my-chores", label: "My Chores", icon: ListIcon },
  { id: "household", label: "Household", icon: UsersIcon },
  { id: "profile", label: "Profile", icon: PersonIcon },
]

export function BottomNav({ active, navigate }: { active: NavKey; navigate: (s: Screen) => void }) {
  return (
    <nav aria-label="Primary navigation" className={styles.navigation}>
      <div className={styles.capsule}>
        <span aria-hidden="true" className={styles.activeIsland} data-active={active} />
        <div className={styles.items}>
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = id === active
            return (
              <button
                key={id}
                onClick={() => navigate(id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
                className={styles.item}
                type="button"
              >
                <Icon active={isActive} className={styles.icon} />
                <span className={styles.label}>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
