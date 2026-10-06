import type { ReactNode } from "react"
import type { Priority } from "@/lib/chore-sync/types"
import { cn } from "@/lib/utils"

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-xs font-black text-slate-500 uppercase tracking-wider font-display">
        {title}
      </h2>
      {action}
    </div>
  )
}

const DOT_COLORS: Record<Priority, string> = {
  high: "bg-rose-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
}

export function PriorityDot({ priority }: { priority: Priority }) {
  return <span className={cn("w-2 h-2 rounded-full flex-shrink-0", DOT_COLORS[priority])} />
}

const BADGE_COLORS: Record<Priority, string> = {
  high: "bg-rose-100 text-rose-600",
  medium: "bg-amber-100 text-amber-600",
  low: "bg-emerald-100 text-emerald-600",
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full",
        BADGE_COLORS[priority],
      )}
    >
      {priority}
    </span>
  )
}

/** Solid rounded-square avatar used across member lists and headers. */
export function Avatar({
  initial,
  className,
  colorClass = "bg-teal-600",
}: {
  initial: string
  className?: string
  colorClass?: string
}) {
  return (
    <div
      className={cn(
        "rounded-xl flex items-center justify-center flex-shrink-0",
        colorClass,
        className,
      )}
    >
      <span className="text-white font-black font-display">{initial}</span>
    </div>
  )
}

export function ProgressBar({
  value,
  trackClass = "bg-slate-100",
  barClass = "bg-teal-600",
  className,
}: {
  value: number
  trackClass?: string
  barClass?: string
  className?: string
}) {
  return (
    <div className={cn("w-full rounded-full h-1.5 overflow-hidden", trackClass, className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", barClass)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
