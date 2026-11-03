"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { PasswordInput } from "@/components/ui/password-input"
import { AuthScreenLayout } from "./auth-screen-layout"
import styles from "./auth-screens.module.css"

export function ForgotPasswordScreen({ initialEmail = "" }: { initialEmail?: string }) {
  const { navigate } = useChoreSync()
  const { requestPasswordReset, completeEmailVerificationRecovery } = useAuth()
  const [email, setEmail] = useState(() => {
    if (initialEmail) return initialEmail
    return typeof window === "undefined"
      ? ""
      : (window.sessionStorage.getItem("auth-prefill-email") ?? "")
  })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmationEmail, setConfirmationEmail] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [showRecoveryCodeForm, setShowRecoveryCodeForm] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const inFlight = useRef(false)
  const recoveryInFlight = useRef(false)

  useEffect(() => {
    window.sessionStorage.removeItem("auth-prefill-email")
  }, [])

  useEffect(() => {
    if (cooldownUntil === null) {
      setCooldown(0)
      return
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldown(remaining)
      if (remaining === 0) setCooldownUntil(null)
    }
    updateCountdown()
    const interval = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(interval)
  }, [cooldownUntil])

  const sendResetRequest = async (resend: boolean) => {
    if (inFlight.current || !email.trim()) return
    inFlight.current = true
    setBusy(true)
    setError("")
    if (resend) setCooldownUntil(Date.now() + 60_000)
    try {
      await requestPasswordReset(email)
      setConfirmationEmail(email.trim())
      setCooldownUntil(Date.now() + 60_000)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to request a password reset. Please try again.",
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const useDifferentEmail = () => {
    setConfirmationEmail("")
    setEmail("")
    setShowRecoveryCodeForm(false)
    setRecoveryCode("")
    setNewPassword("")
    setConfirmNewPassword("")
    setCooldownUntil(null)
    setCooldown(0)
    setError("")
  }

  const completeRecovery = async () => {
    if (recoveryInFlight.current || recoveryCode.length !== 6) return
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError("Password must be between 12 and 128 characters.")
      return
    }
    if (confirmNewPassword.length < 12 || confirmNewPassword.length > 128) {
      setError("Password must be between 12 and 128 characters.")
      return
    }
    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match.")
      return
    }
    recoveryInFlight.current = true
    setRecoveryBusy(true)
    setError("")
    try {
      await completeEmailVerificationRecovery({
        email: confirmationEmail,
        code: recoveryCode,
        newPassword,
      })
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to recover this account. Please check the code and try again.",
      )
    } finally {
      recoveryInFlight.current = false
      setRecoveryBusy(false)
    }
  }

  const confirmationState = Boolean(confirmationEmail)

  return (
    <AuthScreenLayout
      backLabel="Back to sign in"
      centeredBrand
      description={
        confirmationState
          ? "Recovery guidance for your account."
          : "Enter your email and we’ll send reset instructions if an account is registered."
      }
      eyebrow={confirmationState ? "Account recovery" : "Account security"}
      onBack={() => navigate("login")}
      title={confirmationState ? "Check your email" : "Reset your password"}
    >
      {confirmationState ? (
        <>
          <div className={styles.success} role="status">
            If your account is eligible for recovery, we&apos;ll send instructions to your email.
          </div>
          <p className={styles.confirmationEmail}>{confirmationEmail}</p>
          <p className={styles.supportingText}>
            Check your inbox and spam folder. Password reset links expire after 30 minutes; recovery
            codes expire after 10 minutes.
          </p>
          <p className={`${styles.supportingText} mt-2`}>
            If you no longer have access to this email or still need help, contact DirtyDuty
            support.
          </p>

          {!showRecoveryCodeForm ? (
            <button
              className={styles.recoveryToggle}
              onClick={() => setShowRecoveryCodeForm(true)}
              type="button"
            >
              Received a recovery code?
            </button>
          ) : (
            <div className={styles.recoveryFields}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recovery-code">
                  Six-digit recovery code
                </label>
                <input
                  autoComplete="one-time-code"
                  className={styles.input}
                  id="recovery-code"
                  inputMode="numeric"
                  maxLength={6}
                  name="recovery-code"
                  onChange={(event) =>
                    setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  value={recoveryCode}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recovery-new-password">
                  New password
                </label>
                <PasswordInput
                  autoComplete="new-password"
                  className={styles.input}
                  id="recovery-new-password"
                  maxLength={128}
                  name="recovery-new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  toggleClassName={styles.passwordToggle}
                  value={newPassword}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="recovery-confirm-password">
                  Confirm new password
                </label>
                <PasswordInput
                  autoComplete="new-password"
                  className={styles.input}
                  id="recovery-confirm-password"
                  maxLength={128}
                  name="recovery-confirm-password"
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  toggleClassName={styles.passwordToggle}
                  value={confirmNewPassword}
                />
              </div>
              <button
                className={styles.primaryButton}
                disabled={
                  recoveryBusy || recoveryCode.length !== 6 || !newPassword || !confirmNewPassword
                }
                onClick={() => void completeRecovery()}
                type="button"
              >
                {recoveryBusy ? "Recovering account..." : "Verify code and continue"}
              </button>
            </div>
          )}

          <div className={styles.inlinePanel}>
            <p className={styles.panelTitle}>Didn&apos;t receive an email?</p>
            {cooldown > 0 ? (
              <p className={styles.timer} role="timer">
                Resend available in {cooldown} {cooldown === 1 ? "second" : "seconds"}.
              </p>
            ) : (
              <button
                className={styles.textButton}
                disabled={busy}
                onClick={() => void sendResetRequest(true)}
                type="button"
              >
                {busy ? "Sending..." : "Resend email"}
              </button>
            )}
          </div>
          {error && (
            <p className={`${styles.error} mt-4`} role="alert">
              {error}
            </p>
          )}
          <button
            className={`${styles.secondaryButton} mt-4`}
            disabled={busy || recoveryBusy}
            onClick={useDifferentEmail}
            type="button"
          >
            Use a different email
          </button>
        </>
      ) : (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-request-email">
              Email
            </label>
            <input
              autoComplete="email"
              className={styles.input}
              id="reset-request-email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          {error && (
            <p className={`${styles.error} mt-4`} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actionSpace}>
            <button
              className={styles.primaryButton}
              disabled={busy || !email.trim()}
              onClick={() => void sendResetRequest(false)}
              type="button"
            >
              {busy ? "Sending..." : "Send reset instructions"}
            </button>
          </div>
        </>
      )}
    </AuthScreenLayout>
  )
}
