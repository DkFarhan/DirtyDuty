"use client"

import { ChevronRight, ShoppingCart } from "lucide-react"
import type { BoardShoppingSummary } from "@/lib/board/api"
import type { HomeBoardRow } from "@/lib/board/board-view"
import { shoppingSubtitle, showShoppingRow } from "@/lib/board/list-view"
import { TYPE_ICONS } from "./post-sheets"
import styles from "./home-board-section.module.css"

/**
 * Home's "Board" section, after every chore section: up to four rows (the next event, open
 * problems, heads-ups the viewer hasn't seen, and last the Shopping list while something is on it)
 * and "Open board". Hidden when there's nothing.
 */
export function HomeBoardSection({
  rows,
  unseenCount,
  theme,
  shopping = null,
  onOpenPost,
  onOpenBoard,
  onOpenShopping,
}: {
  rows: HomeBoardRow[]
  unseenCount: number
  theme: "light" | "dark"
  shopping?: BoardShoppingSummary | null
  onOpenPost: (postId: string) => void
  onOpenBoard: () => void
  onOpenShopping?: (listId: string | null) => void
}) {
  const shoppingRow = showShoppingRow(shopping) ? shopping : null
  // The Shopping row takes the fourth slot.
  const postRows = shoppingRow ? rows.slice(0, 3) : rows
  if (postRows.length === 0 && !shoppingRow) return null
  return (
    <section
      aria-labelledby="home-board-title"
      className={`${styles.section} ${theme === "light" ? styles.lightTheme : ""}`}
    >
      <div className={styles.heading}>
        <h2 id="home-board-title">Board</h2>
        {unseenCount > 0 && <span className={styles.newPill}>{unseenCount} NEW</span>}
      </div>
      <div className={styles.card}>
        <ul className={styles.rows}>
          {postRows.map(({ post, subtitle, unseen }) => (
            <li key={post.id}>
              <button className={styles.row} onClick={() => onOpenPost(post.id)} type="button">
                <span aria-hidden="true" className={styles.tile} data-type={post.type}>
                  {TYPE_ICONS[post.type](18)}
                </span>
                <span>
                  <span className={styles.title}>
                    <span>{post.title}</span>
                    {unseen && <span aria-label="New" className={styles.dot} role="img" />}
                  </span>
                  <span className={styles.subtitle}>{subtitle}</span>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            </li>
          ))}
          {shoppingRow && (
            <li>
              <button
                className={styles.row}
                onClick={() => onOpenShopping?.(shoppingRow.listId)}
                type="button"
              >
                <span aria-hidden="true" className={styles.tile} data-type="SHOPPING">
                  <ShoppingCart size={17} />
                </span>
                <span>
                  <span className={styles.title}>
                    <span>Shopping</span>
                  </span>
                  <span className={styles.subtitle}>{shoppingSubtitle(shoppingRow)}</span>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            </li>
          )}
        </ul>
      </div>
      <button className={styles.open} onClick={onOpenBoard} type="button">
        Open board
        <ChevronRight aria-hidden="true" size={16} />
      </button>
    </section>
  )
}
