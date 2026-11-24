"use client"

import { useEffect, useState } from "react"
import { ArrowLeftRight, Handshake, Plane, Sparkles, UsersRound } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import type { AssignmentDTO } from "@/lib/household/chores"
import {
  findSwapOption,
  handoffOptions,
  handoffSummary,
  requestApi,
  swapGroups,
  swapSummary,
  type ChoreRequestDTO,
  type RequestCandidates,
} from "@/lib/household/requests"
import { categoryIcon } from "@/lib/household/category-icons"
import styles from "./request-panels.module.css"

type PanelProps = {
  assignment: AssignmentDTO
  householdId: string
  householdTimezone: string
  onSent: (request: ChoreRequestDTO, message: string) => void
}

function useCandidates(householdId: string, assignmentId: string) {
  const [candidates, setCandidates] = useState<RequestCandidates | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    requestApi
      .candidates(householdId, assignmentId)
      .then((result) => {
        if (!cancelled) setCandidates(result)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : "Unable to load who you can ask.")
        }
      })
    return () => {
      cancelled = true
    }
  }, [assignmentId, householdId])
  return { candidates, error }
}

/** S2: "Who should take it?" Anyone (preselected) or one person; away members can't be asked. */
export function HandoffPanel({ assignment, householdId, householdTimezone, onSent }: PanelProps) {
  const { candidates, error: loadError } = useCandidates(householdId, assignment.id)
  const [choice, setChoice] = useState<string>("ANYONE")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passTurn = assignment.requests?.passTurn ?? false

  if (loadError) {
    return (
      <p className={styles.error} role="alert">
        {loadError}
      </p>
    )
  }
  if (!candidates) {
    return (
      <p className={styles.loading} role="status">
        Loading who you can ask…
      </p>
    )
  }
  const options = handoffOptions(candidates)
  const anyoneDisabled = !candidates.anyoneEligible
  const selected = choice === "ANYONE" && anyoneDisabled ? null : choice

  const send = async () => {
    if (!selected || sending) return
    setSending(true)
    setError(null)
    try {
      const target = selected === "ANYONE" ? null : selected
      const request = await requestApi.create(householdId, {
        type: "HANDOFF",
        occurrenceId: assignment.id,
        targetUserId: target,
        swapOccurrenceId: null,
      })
      const name = options.find((option) => option.userId === target)?.name
      onSent(request, name ? `Asked ${name}.` : "Asked everyone who can take it.")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to send the request.")
      setSending(false)
    }
  }

  return (
    <div className={styles.panel}>
      <div aria-label="Who should take it" className={styles.options} role="radiogroup">
        <button
          aria-checked={selected === "ANYONE"}
          className={`${styles.option} ${styles.anyone}`}
          data-panel-start
          disabled={anyoneDisabled}
          onClick={() => setChoice("ANYONE")}
          role="radio"
          type="button"
        >
          <span aria-hidden="true" className={styles.optionTile}>
            <UsersRound size={18} />
          </span>
          <span className={styles.optionCopy}>
            <span className={styles.optionTitle}>Anyone in the house</span>
            <span className={styles.optionHint}>
              {anyoneDisabled
                ? "Nobody else can take it that day."
                : "Everyone gets one notification. First to accept takes it."}
            </span>
          </span>
          <span aria-hidden="true" className={styles.radio} />
        </button>
        {options.length > 0 && <p className={styles.groupLabel}>Or ask one person</p>}
        {options.map((option) => (
          <button
            aria-checked={selected === option.userId}
            className={styles.option}
            disabled={option.disabled}
            key={option.userId}
            onClick={() => setChoice(option.userId)}
            role="radio"
            type="button"
          >
            <span aria-hidden="true" className={styles.avatar}>
              {option.initial}
            </span>
            <span className={styles.optionCopy}>
              <span className={styles.optionTitle}>{option.name}</span>
              <span className={styles.optionHint}>
                {option.away && <Plane aria-hidden="true" size={12} />}
                {option.hint}
              </span>
            </span>
            {!option.disabled && <span aria-hidden="true" className={styles.radio} />}
          </button>
        ))}
      </div>
      <p className={styles.summary}>
        <Sparkles aria-hidden="true" size={15} />
        <span>{handoffSummary(candidates, householdTimezone, passTurn)}</span>
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        aria-busy={sending}
        className={styles.send}
        disabled={!selected || sending}
        onClick={() => void send()}
        type="button"
      >
        <Handshake aria-hidden="true" size={18} />
        {sending ? "Sending..." : "Send request"}
      </button>
    </div>
  )
}

/** S3: "Swap for which chore?" Their chores in the next 14 days, grouped by person. */
export function SwapPanel({ assignment, householdId, householdTimezone, onSent }: PanelProps) {
  const { candidates, error: loadError } = useCandidates(householdId, assignment.id)
  const [choice, setChoice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loadError) {
    return (
      <p className={styles.error} role="alert">
        {loadError}
      </p>
    )
  }
  if (!candidates) {
    return (
      <p className={styles.loading} role="status">
        Loading their chores…
      </p>
    )
  }
  const groups = swapGroups(candidates, householdTimezone)
  const picked = findSwapOption(candidates, choice)

  const send = async () => {
    if (!picked || sending) return
    setSending(true)
    setError(null)
    try {
      const request = await requestApi.create(householdId, {
        type: "SWAP",
        occurrenceId: assignment.id,
        targetUserId: picked.person.userId,
        swapOccurrenceId: picked.occurrence.id,
      })
      onSent(request, `Asked ${picked.person.displayName} to swap.`)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to send the request.")
      setSending(false)
    }
  }

  if (groups.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Nobody has a chore you could swap for in the next 14 days.</p>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <div aria-label="Their chores" className={styles.groups} role="radiogroup">
        {groups.map((group, groupIndex) => (
          <div className={styles.group} key={group.userId}>
            <p className={styles.person}>
              <span aria-hidden="true" className={styles.smallAvatar}>
                {group.initial}
              </span>
              {group.name}
            </p>
            <div className={styles.choreList}>
              {group.options.map((option, index) => (
                <button
                  aria-checked={choice === option.id}
                  aria-label={`${option.title}, ${option.detail}, ${group.name}`}
                  className={styles.chore}
                  data-panel-start={groupIndex === 0 && index === 0 ? true : undefined}
                  key={option.id}
                  onClick={() => setChoice(option.id)}
                  role="radio"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.choreTile}>
                    {categoryIcon(option.categoryIcon)}
                  </span>
                  <span className={styles.optionCopy}>
                    <span className={styles.optionTitle}>{option.title}</span>
                    <span className={styles.optionHint}>{option.detail}</span>
                  </span>
                  <span aria-hidden="true" className={styles.radio} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {picked && (
        <p className={styles.summary}>
          <ArrowLeftRight aria-hidden="true" size={15} />
          <span>{swapSummary(assignment, picked.occurrence, picked.person.displayName)}</span>
        </p>
      )}
      <p className={styles.footnote}>Showing their chores in the next 14 days.</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        aria-busy={sending}
        className={styles.send}
        disabled={!picked || sending}
        onClick={() => void send()}
        type="button"
      >
        <ArrowLeftRight aria-hidden="true" size={18} />
        {sending
          ? "Sending..."
          : picked
            ? `Ask ${picked.person.displayName} to swap`
            : "Choose a chore to swap"}
      </button>
    </div>
  )
}
