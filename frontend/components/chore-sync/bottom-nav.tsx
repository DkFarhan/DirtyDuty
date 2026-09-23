"use client"

import type { ComponentType, SVGProps } from "react"
import type { Screen } from "@/lib/chore-sync/types"
import { cn } from "@/lib/utils"
import { HomeIcon, ListIcon, PersonIcon, UsersIcon } from "./icons"

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
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border-t border-slate-100 flex items-center h-16 px-2 z-50">
      {tabs.map(({ id, label, icon: Icon }) => {
        const isActive = id === active
        return (
          <button
            key={id}
            onClick={() => navigate(id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 py-1 transition-colors",
              isActive ? "text-teal-600" : "text-slate-400",
            )}
          >
            <Icon active={isActive} className="w-6 h-6" />
            <span className="text-[10px] font-display font-semibold">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
