"use client"

import { useChoreSync } from "@/lib/chore-sync/store"
import { useAuth } from "@/lib/auth/auth-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { ArrowRight, HousePlus, Link2, LogOut, ShieldCheck } from "lucide-react"
import { useState } from "react"
import styles from "./setup-screens.module.css"

export function WelcomeScreen() {
  const { navigate, clearAccountDeletion } = useChoreSync()
  const { logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    setLoggingOut(true)
    setError(null)
    try {
      await logout()
      clearAccountDeletion()
      navigate("login")
    } catch {
      setError("Unable to sign out. Please try again.")
      setLoggingOut(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topBar}>
          <span aria-hidden="true" />
          <button
            className={styles.signOutButton}
            disabled={loggingOut}
            onClick={handleLogout}
            type="button"
          >
            <LogOut aria-hidden="true" size={16} />
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </header>
        <section className={styles.welcomeContent}>
          <div className={styles.intro}>
            <ProductLogo className={styles.logo} />
            <p className={styles.eyebrow}>A better rhythm at home</p>
            <h1 className={styles.title}>Welcome!</h1>
            <p className={styles.description}>
              Let&apos;s set up your household. You can create a new one or join an existing one
              with an invite code.
            </p>
          </div>
          <div className={styles.choiceGrid}>
            <button
              className={`${styles.choiceCard} ${styles.featuredChoice}`}
              onClick={() => navigate("create-household")}
              type="button"
            >
              <span className={styles.choiceIcon}>
                <HousePlus aria-hidden="true" size={21} />
              </span>
              <span className={styles.choiceTitle}>
                Create a Household <ArrowRight aria-hidden="true" size={18} />
              </span>
              <span className={styles.choiceText}>Start fresh and invite your housemates.</span>
            </button>
            <button
              className={styles.choiceCard}
              onClick={() => navigate("join-household")}
              type="button"
            >
              <span className={styles.choiceIcon}>
                <Link2 aria-hidden="true" size={20} />
              </span>
              <span className={styles.choiceTitle}>
                Join a Household <ArrowRight aria-hidden="true" size={18} />
              </span>
              <span className={styles.choiceText}>Use an invite code from a housemate.</span>
            </button>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button
            className={styles.accountLink}
            onClick={() => navigate("privacy-security")}
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={19} />
            <span>Account &amp; Privacy</span>
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>
      </div>
    </main>
  )
}
