import type { AssignmentDTO } from "@/lib/household/chores"

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
