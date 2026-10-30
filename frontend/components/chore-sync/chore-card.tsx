import type { Chore } from "@/lib/chore-sync/types"
import { cn } from "@/lib/utils"
import { CheckIcon } from "./icons"
import { PriorityBadge, PriorityDot } from "./primitives"
import { categoryIcon, type AssignmentDTO } from "@/lib/household/chores"

export function assignmentDate(assignment: AssignmentDTO, householdTimezone: string) {
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

export function assignmentTime(assignment: AssignmentDTO, householdTimezone: string) {
  if (!assignment.dueAt) return null
  const dueDate = new Date(assignment.dueAt)
  if (Number.isNaN(dueDate.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: householdTimezone,
  }).format(dueDate)
}

export function assignmentAssigneeNames(assignment: AssignmentDTO, currentUserId: string) {
  if (!assignment.assignees.length) return "No assignee"
  const assignees = [
    ...assignment.assignees.filter(({ userId }) => userId === currentUserId),
    ...assignment.assignees.filter(({ userId }) => userId !== currentUserId),
  ]
  const names = assignees.map(({ userId, displayName }) =>
    userId === currentUserId ? "You" : displayName,
  )
  return names.join(", ")
}

function assigneeLabel(assignment: AssignmentDTO, currentUserId: string) {
  return `Assigned to ${assignmentAssigneeNames(assignment, currentUserId)}`
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
        "rounded-2xl border bg-white p-4 shadow-sm transition-shadow",
        completed
          ? "border-slate-100"
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
                  "break-words font-display text-base font-extrabold leading-snug",
                  completed
                    ? "text-slate-600 dark:text-slate-400"
                    : "text-slate-900 dark:text-slate-100",
                )}
              >
                {assignment.title}
              </h3>
            </div>
            {assignment.overdue && !completed && (
              <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                Overdue
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed">
            {assignment.categoryName && (
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {assignment.categoryName}
              </span>
            )}
            <span className="text-slate-600 dark:text-slate-400">
              {assignmentDate(assignment, householdTimezone)}
            </span>
            {assignment.estimatedMinutes && (
              <span className="text-slate-600 dark:text-slate-400">
                About {assignment.estimatedMinutes} min
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            {assigneeLabel(assignment, currentUserId)}
          </p>
          {completed && assignment.completedByDisplayName && (
            <p className="mt-2 inline-flex rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
              Completed by {assignment.completedByDisplayName}
            </p>
          )}
        </div>
      </div>
      {!completed && assignment.canComplete && onComplete && (
        <button
          aria-label={`Mark ${assignment.title} complete`}
          aria-busy={completing}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-teal-200 bg-white py-2.5 text-sm font-bold text-teal-800 transition hover:bg-teal-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-300 dark:hover:bg-teal-950/40"
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
    <article className="w-40 shrink-0 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-xl">
        {categoryIcon(assignment.categoryIcon)}
      </div>
      <p className="mb-1 break-words font-display text-sm font-extrabold leading-tight text-slate-900">
        {assignment.title}
      </p>
      <p className="text-xs font-medium text-slate-500">
        {assignment.categoryName ?? assignmentDate(assignment, householdTimezone)}
      </p>
      {assignment.categoryName && (
        <p className="mt-0.5 text-xs text-slate-400">
          {assignmentDate(assignment, householdTimezone)}
        </p>
      )}
      <p className="mt-2 line-clamp-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
        {assigneeLabel(assignment, currentUserId)}
      </p>
      {assignment.overdue && assignment.status !== "COMPLETED" && (
        <p className="mt-1 text-[10px] font-bold text-rose-600">Overdue</p>
      )}
    </article>
  )
}

export function ServerUpcomingAssignmentRow({
  assignment,
  currentUserId,
  householdTimezone,
}: {
  assignment: AssignmentDTO
  currentUserId: string
  householdTimezone: string
}) {
  const time = assignmentTime(assignment, householdTimezone)
  return (
    <article className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-800">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-xl dark:bg-slate-800">
        {categoryIcon(assignment.categoryIcon)}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-sm font-bold text-slate-800 dark:text-slate-100">
          {assignment.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">
          {assignment.categoryName ?? assigneeLabel(assignment, currentUserId)}
        </p>
      </div>
      {time && (
        <p className="shrink-0 text-right text-xs font-medium text-slate-600 dark:text-slate-400">
          {time}
        </p>
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
                "font-display text-base font-extrabold leading-snug",
                isCompleted ? "text-slate-500 line-through" : "text-slate-900",
              )}
            >
              {chore.name}
            </h3>
            {!isCompleted && <PriorityBadge priority={chore.priority} />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-medium text-slate-600">{chore.due}</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-slate-500">{chore.frequency}</span>
          </div>
        </div>
      </div>

      {!isCompleted ? (
        <button
          onClick={() => onComplete(chore.id)}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-teal-200 py-2 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-50 active:scale-[0.98]"
        >
          Mark Complete <CheckIcon className="w-4 h-4" />
        </button>
      ) : (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5">
          <CheckIcon className="w-4 h-4 text-emerald-500" />
          <span className="text-emerald-600 text-xs font-semibold">Completed on {chore.due}</span>
        </div>
      )}
    </div>
  )
}
