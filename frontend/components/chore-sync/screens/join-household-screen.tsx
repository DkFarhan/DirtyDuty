"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { cn } from "@/lib/utils"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"
import { Info, Link2 } from "lucide-react"
import styles from "./setup-screens.module.css"

export function JoinHouseholdScreen() {
  const { navigate } = useChoreSync()
  const { join } = useHouseholds()
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async () => {
    const inviteCode = code.trim()
    if (submitting || !inviteCode) return
    setSubmitting(true)
    setError(null)
    try {
      await join(inviteCode)
      setCode("")
      navigate("dashboard")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to join household. Please try again.",
      )
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topBar}>
          <button className={styles.backButton} onClick={() => navigate("welcome")} type="button">
            <ChevronLeftIcon className="h-5 w-5" />
            <span>Back</span>
          </button>
        </header>
        <section className={styles.formContent}>
          <div className={styles.formHeading}>
            <ProductLogo className={styles.logo} />
            <p className={styles.eyebrow}>Find your people</p>
            <h1 className={styles.title}>Join Household</h1>
            <p className={styles.description}>
              Enter the invite code your housemate shared with you to join their household.
            </p>
          </div>
          <div className={styles.formCard}>
            <label className={styles.field} htmlFor="invite-code">
              Invite Code
              <input
                autoComplete="off"
                className={cn(styles.input, styles.inviteInput)}
                id="invite-code"
                onChange={(event) => setCode(event.target.value)}
                placeholder="e.g. ABC123"
                value={code}
              />
            </label>
            <div className={styles.infoNote}>
              <Info aria-hidden="true" size={18} />
              <p>Ask a household owner or admin to share an active invite code with you.</p>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button
              className={styles.primaryButton}
              disabled={submitting || !code.trim()}
              onClick={() => void handleJoin()}
              type="button"
            >
              {submitting ? "Joining..." : "Join Household"}
              <Link2 aria-hidden="true" size={17} />
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
