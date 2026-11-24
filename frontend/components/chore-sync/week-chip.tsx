import { RefreshCw } from "lucide-react"
import type { MyWeeksLine, WeekChipView } from "@/lib/household/week-by-week"
import styles from "./week-chip.module.css"

/** "Your week · until Sun, Dec 7" (accent) or "Rubayet's week · until …" with their initial. */
export function WeekChip({ chip }: { chip: WeekChipView | null | undefined }) {
  if (!chip) return null
  return (
    <p className={styles.chip} data-mine={chip.mine} data-testid="week-chip">
      {chip.mine ? (
        <RefreshCw aria-hidden="true" size={12} strokeWidth={2.4} />
      ) : (
        <span aria-hidden="true" className={styles.initial}>
          {chip.initial}
        </span>
      )}
      <span>{chip.text}</span>
    </p>
  )
}

/** Home's line about the viewer's Week by week chores this period. */
export function MyWeeksRow({
  line,
  className,
}: {
  line: MyWeeksLine | null | undefined
  className?: string
}) {
  if (!line) return null
  return (
    <section
      aria-label="Your weeks"
      className={[styles.row, className].filter(Boolean).join(" ")}
      data-testid="my-weeks"
    >
      <span aria-hidden="true" className={styles.rowTile}>
        <RefreshCw size={18} />
      </span>
      <span className={styles.rowCopy}>
        <strong>{line.title}</strong>
        <span>{line.detail}</span>
      </span>
    </section>
  )
}
