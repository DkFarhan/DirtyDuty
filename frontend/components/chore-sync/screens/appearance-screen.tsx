"use client"

import { ThemeSelector } from "@/components/theme/theme-selector"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ChevronLeftIcon } from "../icons"

export function AppearanceScreen() {
  const { navigate } = useChoreSync()

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-100 bg-white px-5 pb-5 pt-12 dark:border-slate-800 dark:bg-slate-900">
        <button
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={() => navigate("profile")}
          type="button"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="font-display text-xl font-black">Appearance</h1>
      </header>
      <main className="px-4 pt-5">
        <ThemeSelector />
      </main>
    </div>
  )
}
