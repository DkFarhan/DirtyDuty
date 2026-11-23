import { Plane } from "lucide-react"
import styles from "./away-note.module.css"

/** "Rubayet is away, so it skipped to Abubakar" on a card whose turn moved for Away mode. */
export function AwayNote({ note }: { note: string | null | undefined }) {
  if (!note) return null
  return (
    <p className={styles.note} data-testid="away-note">
      <Plane aria-hidden="true" size={12} />
      <span>{note}</span>
    </p>
  )
}
