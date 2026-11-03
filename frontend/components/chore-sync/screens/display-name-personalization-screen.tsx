"use client"

import { useEffect, useState } from "react"
import { ArrowRight, UserRound } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { profileApi } from "@/lib/profile/api"
import styles from "./setup-screens.module.css"

export function DisplayNamePersonalizationScreen() {
  const { user, completeDisplayNamePersonalization } = useAuth()
  const { navigate } = useChoreSync()
  const [displayName, setDisplayName] = useState(user?.displayName ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setDisplayName(user?.displayName ?? "")
    setError("")
  }, [user?.userId, user?.displayName])

  const continueWithName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const trimmedName = displayName.trim()
    if (!trimmedName || trimmedName.length > 100) {
      setError("Display name must be between 1 and 100 characters.")
      return
    }

    setBusy(true)
    setError("")
    try {
      const profile = await profileApi.update({ displayName: trimmedName })
      completeDisplayNamePersonalization(profile.displayName)
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your display name. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const keepExistingName = async () => {
    if (busy || !user) return

    setBusy(true)
    setError("")
    try {
      await profileApi.completeDisplayNamePersonalization()
      completeDisplayNamePersonalization(user.displayName)
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your preference. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.personalizationContent}>
          <div className={styles.personalizationCard}>
            <div className={styles.personalizationIcon}>
              <UserRound aria-hidden="true" size={27} strokeWidth={1.8} />
            </div>
            <p className={styles.eyebrow}>A little about you</p>
            <h1 className={styles.title}>What should your roommates call you?</h1>
            <p className={styles.description}>
              Choose the name your housemates will see when sharing chores and managing your
              household.
            </p>

            <form
              className={styles.personalizationActions}
              onSubmit={(event) => void continueWithName(event)}
            >
              <label className={styles.field} htmlFor="personalized-display-name">
                Display name
                <input
                  autoComplete="name"
                  className={styles.input}
                  disabled={busy}
                  id="personalized-display-name"
                  maxLength={100}
                  onChange={(event) => {
                    setDisplayName(event.target.value)
                    setError("")
                  }}
                  required
                  value={displayName}
                />
              </label>
              <p className={styles.helper}>You can change this later in your profile.</p>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button
                className={styles.primaryButton}
                disabled={busy || !displayName.trim() || displayName.trim().length > 100}
                type="submit"
              >
                {busy ? "Saving…" : "Continue"}
                <ArrowRight aria-hidden="true" size={17} />
              </button>
            </form>
            <button
              className={styles.quietButton}
              disabled={busy}
              onClick={() => void keepExistingName()}
              type="button"
            >
              {busy ? "Saving…" : "Use my existing name"}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
