"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { PasswordInput } from "@/components/ui/password-input"
import { AuthScreenLayout } from "./auth-screen-layout"
import styles from "./auth-screens.module.css"

export function ResetPasswordScreen() {
  const { navigate } = useChoreSync()
  const { confirmPasswordReset } = useAuth()

  const tokenInitialized = useRef(false)

  const [token, setToken] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    if (tokenInitialized.current) return

    tokenInitialized.current = true

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash

    const resetToken = new URLSearchParams(hash).get("token") ?? ""

    if (!resetToken) {
      setError("This reset link is invalid or expired. Request a new one.")
      return
    }

    setToken(resetToken)
    setError("")

    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`)
  }, [])

  const submit = async () => {
    if (busy) return

    setError("")

    if (!token) {
      setError("This reset link is invalid or expired. Request a new one.")
      return
    }

    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }

    if (password.length < 12 || password.length > 128) {
      setError("Password must be between 12 and 128 characters.")
      return
    }

    setBusy(true)

    try {
      await confirmPasswordReset(token, password)

      setToken("")
      setPassword("")
      setConfirm("")
      setComplete(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to reset your password. Please request a new link.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScreenLayout
      centeredBrand
      description={
        complete
          ? "Your account is secure with its new password."
          : "Choose a strong password you have not used for this account before."
      }
      eyebrow={complete ? "Account secured" : "Account security"}
      onBack={() => navigate("login")}
      title={complete ? "Password updated" : "Choose a new password"}
    >
      {complete ? (
        <>
          <div className={styles.successMark} aria-hidden="true">
            ✓
          </div>
          <p className={styles.supportingText} role="status">
            Your password has been changed. You can now sign in with it.
          </p>
          <div className={styles.actionSpace}>
            <button
              className={styles.primaryButton}
              onClick={() => navigate("login")}
              type="button"
            >
              Sign in
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reset-new-password">
                New password
              </label>
              <PasswordInput
                autoComplete="new-password"
                className={styles.input}
                id="reset-new-password"
                name="newPassword"
                onChange={(event) => setPassword(event.target.value)}
                toggleClassName={styles.passwordToggle}
                value={password}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reset-confirm-password">
                Confirm new password
              </label>
              <PasswordInput
                autoComplete="new-password"
                className={styles.input}
                id="reset-confirm-password"
                name="confirmPassword"
                onChange={(event) => setConfirm(event.target.value)}
                toggleClassName={styles.passwordToggle}
                value={confirm}
              />
            </div>
          </div>

          {error && (
            <p className={`${styles.error} mt-4`} role="alert">
              {error}
            </p>
          )}

          <div className={styles.actionSpace}>
            <button
              className={styles.primaryButton}
              disabled={busy || !token || !password || !confirm}
              onClick={() => void submit()}
              type="button"
            >
              {busy ? "Updating..." : "Update password"}
            </button>
          </div>
        </>
      )}
    </AuthScreenLayout>
  )
}
