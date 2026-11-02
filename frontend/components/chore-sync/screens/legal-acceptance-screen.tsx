"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { getLegalDocumentUrl } from "@/lib/chore-sync/legal-navigation"
import { ArrowRight } from "lucide-react"
import styles from "./setup-screens.module.css"

export function LegalAcceptanceScreen() {
  const { completeLegalAcceptance, logout } = useAuth()
  const { navigate, resetUserData } = useChoreSync()
  const { refresh } = useHouseholds()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const continueToDirtyDuty = async () => {
    if (busy) return
    if (!accepted) {
      setError("Please accept the Terms of Service and acknowledge the Privacy Policy.")
      return
    }

    setBusy(true)
    setError("")
    try {
      await completeLegalAcceptance()
      await refresh()
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your acknowledgement. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await logout()
      resetUserData()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.formContent}>
          <div className={styles.formHeading}>
            <ProductLogo className={styles.logo} />
            <p className={styles.eyebrow}>Legal updates</p>
            <h1 className={styles.title}>Review our policies</h1>
            <p className={styles.description}>
              DirtyDuty&apos;s Terms of Service and Privacy Policy have been updated or need your
              acknowledgement. Please review both to continue using your account.
            </p>
          </div>
          <div className={styles.formCard}>
            <div className={styles.policyList}>
              <a
                className={styles.policyLink}
                href={getLegalDocumentUrl("/terms", "legal-acceptance")}
              >
                Terms of Service <span aria-hidden="true">↗</span>
              </a>
              <a
                className={styles.policyLink}
                href={getLegalDocumentUrl("/privacy", "legal-acceptance")}
              >
                Privacy Policy <span aria-hidden="true">↗</span>
              </a>
            </div>

            <label className={styles.consent}>
              <input
                aria-describedby={error ? "legal-acceptance-error" : undefined}
                checked={accepted}
                onChange={(event) => {
                  setAccepted(event.target.checked)
                  if (event.target.checked) setError("")
                }}
                type="checkbox"
              />
              <span>I agree to the Terms of Service and acknowledge the Privacy Policy.</span>
            </label>

            {error && (
              <p className={styles.error} id="legal-acceptance-error" role="alert">
                {error}
              </p>
            )}

            <div className={styles.personalizationActions}>
              <button
                className={styles.primaryButton}
                disabled={busy}
                onClick={() => void continueToDirtyDuty()}
                type="button"
              >
                {busy ? "Saving…" : "Continue"}
                <ArrowRight aria-hidden="true" size={17} />
              </button>
              <button
                className={styles.quietButton}
                disabled={busy}
                onClick={() => void signOut()}
                type="button"
              >
                Sign out
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
