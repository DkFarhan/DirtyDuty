import { Check, Sparkles } from "lucide-react"
import { BASICS, basicsOften } from "@/lib/household/basics"
import { SUGGESTION_ICONS } from "./chore-form/suggestion-icons"
import styles from "./start-with-basics.module.css"

/**
 * "Start with the basics?" for a household with no chores yet. Owners and admins can add the four
 * basics in one go or make their own; members see what's suggested and who can add chores.
 */
export function StartWithBasics({
  canManage,
  adding = false,
  error = null,
  onAdd,
  onMakeOwn,
  className,
}: {
  className?: string
  canManage: boolean
  adding?: boolean
  error?: string | null
  onAdd?: () => void
  onMakeOwn?: () => void
}) {
  return (
    <section
      aria-labelledby="basics-title"
      className={[styles.card, className].filter(Boolean).join(" ")}
      data-testid="start-with-basics"
    >
      <div className={styles.header}>
        <span aria-hidden="true" className={styles.tile}>
          <Sparkles size={20} />
        </span>
        <div>
          <p className={styles.eyebrow}>NEW HOUSEHOLD</p>
          <h2 className={styles.title} id="basics-title">
            Start with the basics?
          </h2>
        </div>
      </div>
      <p className={styles.intro}>
        Most homes begin with these. Everyone takes turns, including people who join later.
      </p>
      <ul aria-label="Suggested chores" className={styles.list}>
        {BASICS.map((suggestion) => (
          <li className={styles.item} key={suggestion.title}>
            <span aria-hidden="true" className={styles.itemTile}>
              {SUGGESTION_ICONS[suggestion.icon](16)}
            </span>
            <span className={styles.itemTitle}>{suggestion.title}</span>
            <span className={styles.itemOften}>{basicsOften(suggestion)}</span>
          </li>
        ))}
      </ul>
      {canManage ? (
        <>
          <div className={styles.actions}>
            <button
              aria-busy={adding}
              className={styles.primary}
              disabled={adding}
              onClick={onAdd}
              type="button"
            >
              {!adding && <Check aria-hidden="true" size={18} strokeWidth={2.6} />}
              {adding ? "Adding…" : `Add these ${BASICS.length}`}
            </button>
            <button
              className={styles.secondary}
              disabled={adding}
              onClick={onMakeOwn}
              type="button"
            >
              I&apos;ll make my own
            </button>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <p className={styles.footnote}>You can change or remove any of them later.</p>
        </>
      ) : (
        <p className={styles.footnote}>Ask an admin to add chores.</p>
      )}
    </section>
  )
}
