"use client"

import { AwayNote } from "./away-note"
import { RequestNote, WaitingChip } from "./requests/request-card-status"
import { useEffect, useId, useState } from "react"
import { Bell, BellCheck, Calendar, Check, CircleAlert, Clock } from "lucide-react"
import type { HouseholdJobViewModel } from "@/lib/household/household-jobs"
import { CardFeedbackMessage } from "./card-feedback"
import { OccurrenceMoreButton } from "./occurrence-action-sheet"
import styles from "./household-job-card.module.css"

export type HouseholdJobCardProps = {
  job: HouseholdJobViewModel
  theme: "light" | "dark"
  completing?: boolean
  flagging?: boolean
  onComplete?: (id: string) => void
  onFlag?: (id: string) => void
  onOpenActions?: (id: string) => void
}

/**
 * "Reminder sent" until the repeat window ends, then "Remind again". One timeout per card moves
 * it on; the view model is otherwise only recomputed when the screen re-renders.
 */
function useReminderState(reminder: HouseholdJobViewModel["reminder"]) {
  const until = reminder?.state === "reminder-sent" ? reminder.remindAgainAt : null
  const [endedAt, setEndedAt] = useState<number | null>(null)
  useEffect(() => {
    if (until === null) return
    const timer = window.setTimeout(() => setEndedAt(until), Math.max(0, until - Date.now()))
    return () => window.clearTimeout(timer)
  }, [until])
  if (until !== null && endedAt === until) return { state: "remind-again" as const }
  return reminder
}

/** One "When needed" chore: whose turn, last done, deadline, flag, I did it and Needs doing. */
export function HouseholdJobCard({
  job,
  theme,
  completing = false,
  flagging = false,
  onComplete,
  onFlag,
  onOpenActions,
}: HouseholdJobCardProps) {
  const hintId = useId()
  const reminder = useReminderState(job.reminder)
  const showMore = job.hasActions && Boolean(onOpenActions)
  const showComplete = job.completeLabel !== null && Boolean(onComplete)
  const showReminder = reminder !== null && Boolean(onFlag)
  const waiting = showReminder && reminder.state === "reminder-sent"
  const flagText = reminder?.state === "remind-again" ? "Remind again" : "Needs doing"
  return (
    <>
      <article
        aria-label={job.title}
        className={`${styles.card} ${theme === "dark" ? styles.darkTheme : styles.lightTheme}`}
        data-flagged={job.flagged || undefined}
        data-household-job={job.id}
        data-overdue={job.overdue || undefined}
        data-your-turn={job.yourTurn || undefined}
        id={`assignment-${job.id}`}
      >
        <div className={styles.top}>
          <p className={styles.turn}>
            {job.turnInitial && (
              <span aria-hidden="true" className={styles.avatar}>
                {job.turnInitial}
              </span>
            )}
            <span className={job.yourTurn ? styles.turnPill : styles.turnText}>
              {job.turnLabel}
            </span>
          </p>
          {showMore && (
            <OccurrenceMoreButton
              className={styles.more}
              onClick={() => onOpenActions?.(job.id)}
              title={job.title}
            />
          )}
        </div>
        <AwayNote note={job.awayNote} />
        <RequestNote kind={job.request?.noteKind} label={job.request?.noteLabel} />
        <WaitingChip label={job.request?.waitingLabel} />
        <h3 className={styles.title}>{job.title}</h3>
        <ul className={styles.meta}>
          <li>
            <Clock aria-hidden="true" size={13} strokeWidth={2.2} />
            {job.lastDoneLabel}
          </li>
          {job.deadlineLabel && (
            <li className={job.overdue ? styles.overdue : undefined}>
              {job.overdue ? (
                <CircleAlert aria-hidden="true" size={13} strokeWidth={2.2} />
              ) : (
                <Calendar aria-hidden="true" size={13} strokeWidth={2.2} />
              )}
              {job.deadlineLabel}
            </li>
          )}
        </ul>
        {job.flagLabel && (
          <p className={styles.flag}>
            <Bell aria-hidden="true" size={14} strokeWidth={2.2} />
            {job.flagLabel}
          </p>
        )}
        {(showComplete || showReminder) && (
          <div className={styles.actions}>
            {showComplete && (
              <button
                aria-busy={completing}
                aria-label={`${completing ? "Saving" : job.completeLabel} ${job.title}`}
                className={styles.primary}
                disabled={completing}
                onClick={() => onComplete?.(job.id)}
                type="button"
              >
                <span className={styles.buttonContent}>
                  <Check aria-hidden="true" size={17} strokeWidth={2.4} />
                  {completing ? "Saving..." : job.completeLabel}
                </span>
              </button>
            )}
            {showReminder &&
              (waiting ? (
                <button
                  aria-describedby={hintId}
                  aria-disabled="true"
                  aria-label={`Reminder sent: ${job.title}`}
                  className={styles.sent}
                  type="button"
                >
                  <span className={styles.buttonContent}>
                    <BellCheck aria-hidden="true" size={17} strokeWidth={2.2} />
                    Reminder sent
                  </span>
                </button>
              ) : (
                <button
                  aria-busy={flagging}
                  aria-label={`${flagText}: ${job.title}`}
                  className={styles.secondary}
                  disabled={flagging}
                  onClick={() => onFlag?.(job.id)}
                  type="button"
                >
                  <span className={styles.buttonContent}>
                    <Bell aria-hidden="true" size={17} strokeWidth={2.2} />
                    {flagText}
                  </span>
                </button>
              ))}
          </div>
        )}
        {waiting && reminder.state === "reminder-sent" && (
          <p className={styles.hint} id={hintId}>
            {reminder.remindAgainLabel}
          </p>
        )}
      </article>
      <CardFeedbackMessage feedback={job.feedback} theme={theme} />
    </>
  )
}
