import { ArrowLeftRight, Clock3, Handshake, X } from "lucide-react"
import styles from "./request-card-status.module.css"

/** "Waiting for Rubayet" on the requester's card while their request is open (E11). */
export function WaitingChip({ label }: { label: string | null | undefined }) {
  if (!label) return null
  return (
    <p className={styles.chip} data-testid="request-waiting">
      <Clock3 aria-hidden="true" size={13} strokeWidth={2.4} />
      <span>{label}</span>
    </p>
  )
}

/** "Taken over from Farhan" / "Swapped with Rubayet" after an accepted request (E11). */
export function RequestNote({
  label,
  kind,
}: {
  label: string | null | undefined
  kind: "TAKEN_OVER" | "SWAPPED" | null | undefined
}) {
  if (!label) return null
  const Icon = kind === "SWAPPED" ? ArrowLeftRight : Handshake
  return (
    <p className={styles.note} data-testid="request-note">
      <Icon aria-hidden="true" size={13} />
      <span>{label}</span>
    </p>
  )
}

/** Replaces the card's secondary action while the viewer's own request is open. */
export function CancelRequestButton({
  title,
  busy,
  className,
  onCancel,
}: {
  title: string
  busy?: boolean
  className?: string
  onCancel: () => void
}) {
  return (
    <button
      aria-busy={busy}
      aria-label={`Cancel request for ${title}`}
      className={`${styles.cancel} ${className ?? ""}`}
      disabled={busy}
      onClick={onCancel}
      type="button"
    >
      <X aria-hidden="true" size={16} strokeWidth={2.6} />
      {busy ? "Cancelling..." : "Cancel request"}
    </button>
  )
}
