import type { Chore } from "@/lib/chore-sync/types"
import { cn } from "@/lib/utils"
import { CheckIcon } from "./icons"
import { PriorityBadge, PriorityDot } from "./primitives"

/** Featured card for "Today" chores on the dashboard (solid CTA). */
export function TodayChoreCard({ chore, onComplete }: { chore: Chore; onComplete: (id: string) => void }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 bg-teal-50 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl">
          {chore.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <PriorityDot priority={chore.priority} />
            <h3 className="font-bold text-slate-900 text-[15px] truncate">{chore.name}</h3>
          </div>
          <p className="text-slate-400 text-xs mt-0.5">
            Assigned to {chore.assigneeName} · {chore.due}
          </p>
        </div>
      </div>
      <button
        onClick={() => onComplete(chore.id)}
        className="mt-3 w-full bg-teal-600 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-teal-700 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5"
      >
        Mark Complete <CheckIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

/** Compact card used in the horizontally-scrolling "This Week" rail. */
export function WeekChoreCard({ chore }: { chore: Chore }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex-shrink-0 w-36">
      <div className="text-2xl mb-2">{chore.icon}</div>
      <p className="font-bold text-slate-900 text-sm leading-tight mb-1">{chore.name}</p>
      <p className="text-slate-400 text-xs">{chore.dueDay}</p>
      <div className="flex items-center gap-1 mt-2">
        <div className="w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center">
          <span className="text-[9px] font-bold text-slate-600">{chore.assigneeName[0]}</span>
        </div>
        <span className="text-slate-500 text-xs truncate">{chore.assigneeName}</span>
      </div>
    </div>
  )
}

/** Full-width list card used on "My Chores" (upcoming + completed states). */
export function ListChoreCard({ chore, onComplete }: { chore: Chore; onComplete: (id: string) => void }) {
  const isCompleted = chore.status === "completed"
  return (
    <div className={cn("bg-white rounded-2xl p-4 border shadow-sm", isCompleted ? "border-emerald-100" : "border-slate-100")}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl",
            isCompleted ? "bg-emerald-50" : "bg-teal-50",
          )}
        >
          {chore.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn("font-bold text-[15px]", isCompleted ? "text-slate-400 line-through" : "text-slate-900")}>
              {chore.name}
            </h3>
            {!isCompleted && <PriorityBadge priority={chore.priority} />}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-slate-400 text-xs">{chore.due}</span>
            <span className="text-slate-200">·</span>
            <span className="text-slate-400 text-xs">{chore.frequency}</span>
          </div>
        </div>
      </div>

      {!isCompleted ? (
        <button
          onClick={() => onComplete(chore.id)}
          className="mt-3 w-full border border-teal-200 text-teal-600 text-sm font-bold py-2 rounded-xl hover:bg-teal-50 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5"
        >
          Mark Complete <CheckIcon className="w-4 h-4" />
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          <CheckIcon className="w-4 h-4 text-emerald-500" />
          <span className="text-emerald-600 text-xs font-semibold">Completed on {chore.due}</span>
        </div>
      )}
    </div>
  )
}
