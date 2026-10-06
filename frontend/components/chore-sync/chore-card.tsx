import type { Chore } from "@/lib/chore-sync/types"
import { cn } from "@/lib/utils"
import { CheckIcon } from "./icons"
import { PriorityBadge, PriorityDot } from "./primitives"
import { categoryIcon, type AssignmentDTO } from "@/lib/household/chores"

function assignmentDate(assignment: AssignmentDTO, householdTimezone: string) {
  const scheduledDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(assignment.scheduledFor)
  const dateLabel = scheduledDate
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(
        new Date(
          Date.UTC(
            Number(scheduledDate[1]),
            Number(scheduledDate[2]) - 1,
            Number(scheduledDate[3]),
            12,
          ),
        ),
      )
    : assignment.scheduledFor
  if (!assignment.dueAt) return dateLabel
  const dueDate = new Date(assignment.dueAt)
  if (Number.isNaN(dueDate.getTime())) return dateLabel
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: householdTimezone,
  }).format(dueDate)
  return `${dateLabel} · ${timeLabel}`
}

function assigneeLabel(assignment: AssignmentDTO, currentUserId: string) {
  if (!assignment.assignees.length) return "No assignee"
  const names = assignment.assignees.map(({ userId, displayName }) =>
    userId === currentUserId ? "You" : displayName,
  )
  return `Assigned to ${names.join(", ")}`
}

function assignmentPriority(priority: AssignmentDTO["priority"]) {
  return priority === "LOW"
    ? "low"
    : priority === "HIGH" || priority === "URGENT"
      ? "high"
      : "medium"
}

export function ServerAssignmentCard({
  assignment,
  currentUserId,
  householdTimezone,
  onComplete,
  completing = false,
}: {
  assignment: AssignmentDTO
  currentUserId: string
  householdTimezone: string
  onComplete?: (id: string) => void
  completing?: boolean
}) {
  const completed = assignment.status === "COMPLETED"
  return (
    <article
      className={cn(
        "rounded-2xl border bg-white p-4 shadow-sm",
        completed
          ? "border-emerald-100"
          : assignment.overdue
            ? "border-rose-200"
            : "border-slate-100",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl",
            completed ? "bg-emerald-50" : "bg-teal-50",
          )}
        >
          {categoryIcon(assignment.categoryIcon)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {!completed && <PriorityDot priority={assignmentPriority(assignment.priority)} />}
              <h3
                className={cn(
                  "break-words font-bold text-[15px]",
                  completed ? "text-slate-500" : "text-slate-900",
                )}
              >
                {assignment.title}
              </h3>
            </div>
            {assignment.overdue && !completed && (
              <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600">
                Overdue
              </span>
            )}
          </div>
          {assignment.categoryName && (
            <p className="mt-0.5 text-xs text-slate-400">{assignment.categoryName}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">{assigneeLabel(assignment, currentUserId)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {assignmentDate(assignment, householdTimezone)}
          </p>
          {completed && assignment.completedByDisplayName && (
            <p className="mt-1 text-xs font-medium text-emerald-600">
              Completed by {assignment.completedByDisplayName}
            </p>
          )}
          {assignment.estimatedMinutes && (
            <p className="mt-1 text-xs text-slate-400">About {assignment.estimatedMinutes} min</p>
          )}
        </div>
      </div>
      {!completed && assignment.canComplete && onComplete && (
        <button
          aria-label={`Mark ${assignment.title} complete`}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-teal-200 py-2.5 text-sm font-bold text-teal-700 transition hover:bg-teal-50 disabled:opacity-60"
          disabled={completing}
          onClick={() => onComplete(assignment.id)}
          type="button"
        >
          {completing ? "Completing..." : "Mark Complete"} <CheckIcon className="h-4 w-4" />
        </button>
      )}
    </article>
  )
}

export function ServerWeekAssignmentCard({
  assignment,
  currentUserId,
  householdTimezone,
}: {
  assignment: AssignmentDTO
  currentUserId: string
  householdTimezone: string
}) {
  return (
    <article className="w-40 shrink-0 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-2 text-2xl">{categoryIcon(assignment.categoryIcon)}</div>
      <p className="mb-1 break-words text-sm font-bold leading-tight text-slate-900">
        {assignment.title}
      </p>
      <p className="text-xs text-slate-400">{assignmentDate(assignment, householdTimezone)}</p>
      <p className="mt-2 line-clamp-2 text-xs text-slate-500">
        {assigneeLabel(assignment, currentUserId)}
      </p>
      {assignment.overdue && assignment.status !== "COMPLETED" && (
        <p className="mt-1 text-[10px] font-bold text-rose-600">Overdue</p>
      )}
    </article>
  )
}

/** Featured card for "Today" chores on the dashboard (solid CTA). */
export function TodayChoreCard({
  chore,
  onComplete,
}: {
  chore: Chore
  onComplete: (id: string) => void
}) {
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
export function ListChoreCard({
  chore,
  onComplete,
}: {
  chore: Chore
  onComplete: (id: string) => void
}) {
  const isCompleted = chore.status === "completed"
  return (
    <div
      className={cn(
        "bg-white rounded-2xl p-4 border shadow-sm",
        isCompleted ? "border-emerald-100" : "border-slate-100",
      )}
    >
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
            <h3
              className={cn(
                "font-bold text-[15px]",
                isCompleted ? "text-slate-400 line-through" : "text-slate-900",
              )}
            >
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
