"use client"

import { ArrowLeftRight, Check, Handshake, X } from "lucide-react"
import { CardFeedbackMessage } from "../card-feedback"
import type { RequestItemView } from "@/lib/household/requests"
import styles from "./requests-card.module.css"

export type RequestsCardFeedback = {
  /** The request the message is about; null for a message about the card as a whole. */
  requestId: string | null
  tone: "success" | "error"
  message: string
}

/**
 * "Requests for you" at the top of Home and My Chores (E11): each open hand-off or swap the viewer
 * can answer, with Take it / Swap and Decline. Hidden when there is nothing to answer, unless a
 * confirmation is still showing.
 */
export function RequestsCard({
  items,
  theme,
  busyId,
  feedback,
  onAccept,
  onDecline,
  className,
}: {
  items: RequestItemView[]
  /** Where the page puts the card (its margins). */
  className?: string
  theme: "dark" | "light"
  busyId: string | null
  feedback: RequestsCardFeedback | null
  onAccept: (requestId: string) => void
  onDecline: (requestId: string) => void
}) {
  const cardFeedback = feedback && feedback.requestId === null ? feedback : null
  if (items.length === 0 && !cardFeedback) return null
  return (
    <section
      aria-labelledby="requests-for-you-title"
      className={`${styles.card} ${theme === "dark" ? styles.darkTheme : styles.lightTheme} ${className ?? ""}`}
      data-requests-card
      id="requests-for-you"
    >
      <div className={styles.heading}>
        <h2 id="requests-for-you-title">Requests for you</h2>
        {items.length > 0 && (
          <span aria-label={`${items.length} open`} className={styles.badge}>
            {items.length}
          </span>
        )}
      </div>
      {cardFeedback && (
        <CardFeedbackMessage
          className={styles.feedback}
          feedback={{ tone: cardFeedback.tone, message: cardFeedback.message }}
          theme={theme}
        />
      )}
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => {
            const busy = busyId === item.id
            const itemFeedback = feedback?.requestId === item.id ? feedback : null
            const DetailIcon = item.type === "SWAP" ? ArrowLeftRight : Handshake
            return (
              <li className={styles.item} data-request-id={item.id} key={item.id}>
                <div className={styles.summary}>
                  <span aria-hidden="true" className={styles.avatar}>
                    {item.initial}
                  </span>
                  <div className={styles.copy}>
                    <p className={styles.sentence}>
                      <strong>{item.name}</strong>
                      {item.sentence}
                    </p>
                    <p className={styles.detail}>
                      <DetailIcon aria-hidden="true" size={13} />
                      <span>{item.detail}</span>
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  <button
                    aria-busy={busy}
                    className={styles.accept}
                    disabled={busyId !== null}
                    onClick={() => onAccept(item.id)}
                    type="button"
                  >
                    <Check aria-hidden="true" size={17} strokeWidth={2.6} />
                    {item.acceptLabel}
                  </button>
                  <button
                    className={styles.decline}
                    disabled={busyId !== null}
                    onClick={() => onDecline(item.id)}
                    type="button"
                  >
                    <X aria-hidden="true" size={17} strokeWidth={2.6} />
                    Decline
                  </button>
                </div>
                {itemFeedback && (
                  <CardFeedbackMessage
                    className={styles.feedback}
                    feedback={{ tone: itemFeedback.tone, message: itemFeedback.message }}
                    theme={theme}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
