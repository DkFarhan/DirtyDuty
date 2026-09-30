"use client"

import type { ReactNode } from "react"
import { ChevronLeftIcon } from "../icons"

export function SubpageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string
  subtitle?: string
  back: () => void
  action?: ReactNode
}) {
  return (
    <header className="flex items-center gap-3 bg-white px-5 pb-5 pt-12">
      <button
        aria-label="Back"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"
        onClick={back}
        type="button"
      >
        <ChevronLeftIcon className="h-5 w-5 text-slate-500" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-black text-slate-900 font-display">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
