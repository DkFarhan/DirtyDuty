import type { ReminderMode } from "./chores"

/** A level the user can choose (E13). */
export type ReminderLevel = Exclude<ReminderMode, "CUSTOM">

export const DEFAULT_REMINDER_LEVEL: ReminderLevel = "STANDARD"

/** The five levels in order, with what each one sends (the server's notification_reminder_rules). */
export const REMINDER_LEVELS: readonly {
  mode: ReminderLevel
  label: string
  description: string
}[] = [
  {
    mode: "OFF",
    label: "Off",
    description:
      "No reminders. You still hear when it's assigned to you or someone says it needs doing.",
  },
  {
    mode: "FRIENDLY",
    label: "Light",
    description: "One at the due time, and once if it's still not done 12 hours later",
  },
  {
    mode: "STANDARD",
    label: "Standard",
    description: "A heads-up a few hours before, at the due time, and once if it's overdue",
  },
  {
    mode: "AGGRESSIVE",
    label: "Full",
    description:
      "A day before, a few hours and an hour before, at the due time, and twice if it's overdue",
  },
  {
    mode: "INTENSE",
    label: "Intense",
    description:
      "From two days before, more often as it gets close, at the due time, and four times if it's overdue",
  },
]

/** A chosen level, or the default for anything else (an older response, or CUSTOM). */
export function reminderLevel(mode: ReminderMode | null | undefined): ReminderLevel {
  return REMINDER_LEVELS.some((level) => level.mode === mode)
    ? (mode as ReminderLevel)
    : DEFAULT_REMINDER_LEVEL
}

/** "Standard", "Off", … */
export function reminderLevelLabel(mode: ReminderMode | null | undefined): string {
  if (mode === "CUSTOM") return "Custom"
  return REMINDER_LEVELS.find((level) => level.mode === reminderLevel(mode))?.label ?? "Standard"
}

/** The note for a When needed chore with no deadline: reminders need a due time. */
export const NO_DEADLINE_REMINDERS =
  "This chore has no deadline, so it sends no reminders. Turn on a deadline to use them."
