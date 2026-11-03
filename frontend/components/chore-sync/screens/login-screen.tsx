"use client"

import { useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { PasswordInput } from "@/components/ui/password-input"
import { GoogleSignInButton } from "../google-sign-in-button"
import { AuthScreenLayout } from "./auth-screen-layout"
import styles from "./auth-screens.module.css"

export function LoginScreen() {
  const { navigate } = useChoreSync()
  const { login, authNotice, dismissAuthNotice, features, completeGoogleLink } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [googleLinkRequired, setGoogleLinkRequired] = useState(false)
  const [oauthMessage, setOauthMessage] = useState("")
  const [linkBusy, setLinkBusy] = useState(false)

  useEffect(() => {
    const prefillEmail = window.sessionStorage.getItem("auth-prefill-email")
    if (prefillEmail) {
      setEmail(prefillEmail)
      window.sessionStorage.removeItem("auth-prefill-email")
    }
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get("auth")
    if (authResult === "google-link-required") {
      setGoogleLinkRequired(true)
      setOauthMessage(
        "An account already exists for this Google email. Sign in with your password to link Google.",
      )
    } else if (authResult === "google-error") {
      setOauthMessage("Google sign-in was not completed. Please try again.")
    }
    if (authResult) {
      params.delete("auth")
      const query = params.toString()
      window.history.replaceState(
        {},
        "",
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      )
    }
  }, [])

  const linkGoogle = async () => {
    if (linkBusy) return
    setLinkBusy(true)
    setError("")
    try {
      await completeGoogleLink(password)
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 429
          ? "Too many sign-in attempts. Please wait and try again, or reset your password."
          : cause instanceof ApiError
            ? cause.message
            : "Unable to link Google. Please try again.",
      )
    } finally {
      setLinkBusy(false)
    }
  }

  const handleSubmit = async () => {
    if (isSubmitting) return
    setError("")
    setIsSubmitting(true)

    try {
      const authenticatedUser = await login(email, password)
      navigate(authenticatedUser.emailVerified ? "welcome" : "verify-email")
    } catch (cause) {
      if (cause instanceof ApiError) setError(cause.message)
      else setError("Unable to sign in. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthScreenLayout
      centeredBrand
      description="Sign in to pick up where your household left off."
      eyebrow="Welcome home"
      footer={
        <>
          Don&apos;t have an account?
          <button className={styles.textButton} onClick={() => navigate("register")} type="button">
            Sign up
          </button>
        </>
      }
      title="Welcome back"
    >
      {oauthMessage && (
        <p className={styles.warning} role="status">
          {oauthMessage}
        </p>
      )}
      {authNotice && (
        <div className={styles.notice} role="status">
          <div className="flex items-start justify-between gap-3">
            <span>{authNotice}</span>
            <button
              aria-label="Dismiss message"
              className={styles.dismissButton}
              onClick={dismissAuthNotice}
              type="button"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className={styles.formStack}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-email">
            Email
          </label>
          <input
            autoComplete="email"
            className={styles.input}
            id="login-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-password">
            Password
          </label>
          <PasswordInput
            autoComplete="current-password"
            className={styles.input}
            id="login-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            toggleClassName={styles.passwordToggle}
            value={password}
          />
        </div>
        {(features.passwordReset || features.emailVerification) && (
          <div className={styles.forgotLinkRow}>
            <button
              className={styles.textButton}
              onClick={() => navigate("forgot-password")}
              type="button"
            >
              Forgot password?
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actionSpace}>
        <button
          className={`${styles.primaryButton} auth-primary-button`}
          disabled={isSubmitting}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </div>

      {googleLinkRequired && (
        <div className={styles.inlinePanel}>
          <h2 className={styles.panelTitle}>Link your Google account</h2>
          <p className={styles.supportingText}>
            Confirm the password for your existing account before connecting Google.
          </p>
          <button
            className={`${styles.secondaryButton} mt-3`}
            disabled={linkBusy || !password}
            onClick={() => void linkGoogle()}
            type="button"
          >
            {linkBusy ? "Linking Google..." : "Sign in and link Google"}
          </button>
        </div>
      )}

      {features.google && (
        <>
          <div className={styles.divider}>or continue with</div>
          <GoogleSignInButton className={styles.googleButton} />
        </>
      )}
    </AuthScreenLayout>
  )
}
