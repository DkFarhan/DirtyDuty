"use client"

import { BellRing, Check } from "lucide-react"
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

/** One "When needed" chore: whose turn, last done, next deadline, flag, Done and Needs doing. */
export function HouseholdJobCard({
  job,
  theme,
  completing = false,
  flagging = false,
  onComplete,
  onFlag,
  onOpenActions,
}: HouseholdJobCardProps) {
  const showMore = job.hasActions && Boolean(onOpenActions)
  const showComplete = job.completeLabel !== null && Boolean(onComplete)
  const showFlag = job.canFlag && Boolean(onFlag)
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
        <div className={styles.heading}>
          <p className={styles.turn}>{job.turnLabel}</p>
          <h3 className={styles.title}>{job.title}</h3>
        </div>
        {showMore && (
          <OccurrenceMoreButton
            className={styles.more}
            onClick={() => onOpenActions?.(job.id)}
            title={job.title}
          />
        )}
        <ul className={styles.meta}>
          <li>{job.lastDoneLabel}</li>
          {job.deadlineLabel && (
            <li className={job.overdue ? styles.overdue : undefined}>{job.deadlineLabel}</li>
          )}
          {job.flagLabel && (
            <li className={styles.flag}>
              <BellRing aria-hidden="true" size={14} />
              {job.flagLabel}
            </li>
          )}
        </ul>
        {(showComplete || showFlag) && (
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
                <Check aria-hidden="true" size={16} />
                {completing ? "Saving..." : job.completeLabel}
              </button>
            )}
            {showFlag && (
              <button
                aria-busy={flagging}
                aria-label={`Needs doing: ${job.title}`}
                className={styles.secondary}
                disabled={flagging}
                onClick={() => onFlag?.(job.id)}
                type="button"
              >
                <BellRing aria-hidden="true" size={16} />
                Needs doing
              </button>
            )}
          </div>
        )}
      </article>
      <CardFeedbackMessage feedback={job.feedback} theme={theme} />
    </>
  )
}
