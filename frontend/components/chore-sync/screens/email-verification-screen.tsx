"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ProductLogo } from "@/components/brand/product-logo"
import styles from "./setup-screens.module.css"

function timeRemaining(timestamp: string | null, now: number) {
  if (!timestamp) return 0
  const target = Date.parse(timestamp)
  return Number.isFinite(target) ? Math.max(0, target - now) : 0
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function EmailVerificationScreen() {
  const { navigate } = useChoreSync()
  const {
    user,
    emailVerificationStatus,
    refreshEmailVerificationStatus,
    verifyEmail,
    resendVerificationCode,
    correctVerificationEmail,
    logout,
    refreshUser,
  } = useAuth()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [isCheckingStatus, setIsCheckingStatus] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [isCorrectingEmail, setIsCorrectingEmail] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [password, setPassword] = useState("")
  const [now, setNow] = useState(Date.now())
  const verificationActions = useRef({ refreshEmailVerificationStatus, refreshUser })
  verificationActions.current = { refreshEmailVerificationStatus, refreshUser }

  useEffect(() => {
    let active = true

    const checkStatus = async () => {
      setIsCheckingStatus(true)
      setError("")
      try {
        const status = await verificationActions.current.refreshEmailVerificationStatus()
        if (!active || !status.emailVerified) return
        const currentUser = await verificationActions.current.refreshUser()
        if (active && currentUser?.emailVerified) navigate("welcome")
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Unable to check your verification status. Please try again.",
          )
        }
      } finally {
        if (active) setIsCheckingStatus(false)
      }
    }

    void checkStatus()
    window.addEventListener("focus", checkStatus)
    return () => {
      active = false
      window.removeEventListener("focus", checkStatus)
    }
  }, [navigate, user?.userId])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const resendDelay = timeRemaining(emailVerificationStatus?.resendAvailableAt ?? null, now)
  const codeExpiry = timeRemaining(emailVerificationStatus?.codeExpiresAt ?? null, now)

  const handleVerify = async () => {
    if (code.length !== 6 || isSubmitting) return
    setError("")
    setIsSubmitting(true)
    try {
      const verifiedUser = await verifyEmail(code)
      if (verifiedUser.emailVerified) {
        navigate("welcome")
      } else {
        setError("Your email is still awaiting verification. Please try again.")
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to verify your email. Please try again.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async () => {
    if (isResending || resendDelay > 0) return
    setError("")
    setIsResending(true)
    try {
      await resendVerificationCode()
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Unable to resend the code. Please try again.",
      )
    } finally {
      setIsResending(false)
    }
  }

  const handleCorrectEmail = async () => {
    if (isCorrectingEmail || !newEmail.trim() || !password) return
    setError("")
    setIsCorrectingEmail(true)
    try {
      await correctVerificationEmail(newEmail.trim(), password)
      navigate("login")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to update your email. Please try again.",
      )
    } finally {
      setIsCorrectingEmail(false)
    }
  }

  const handleLogout = async () => {
    if (isLoggingOut) return
    setError("")
    setIsLoggingOut(true)
    try {
      await logout()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setIsLoggingOut(false)
    }
  }

  const email = emailVerificationStatus?.email ?? user?.email ?? "your email address"

  return (
    <main className={`${styles.page} ${styles.emailPage}`}>
      <section className={styles.emailShell}>
        <header className={styles.emailHeader}>
          <div className={styles.emailBrand}>
            <ProductLogo className={styles.emailLogo} themeAware />
            <p className={styles.emailBrandPhrase}>Keep your home running smoothly</p>
          </div>
          <p className={styles.emailEyebrow}>Account security</p>
          <h1 className={styles.title}>Verify your email</h1>
          <p className={styles.emailDescription}>
            Enter the six-digit code for <span className={styles.emailAddress}>{email}</span>.
          </p>
        </header>

        <div className={styles.emailCard}>
          {emailVerificationStatus?.deliveryState === "SENT" && (
            <p className={`${styles.emailDelivery} ${styles.emailDeliverySent}`} role="status">
              A verification code was sent to {emailVerificationStatus.email}.
            </p>
          )}
          {emailVerificationStatus?.deliveryState === "FAILED" && (
            <p className={`${styles.emailDelivery} ${styles.emailDeliveryFailed}`} role="status">
              We couldn&apos;t deliver a verification code. You can try sending another one below.
            </p>
          )}
          {emailVerificationStatus?.deliveryState === "NONE" && (
            <p className={`${styles.emailDelivery} ${styles.emailDeliveryNone}`} role="status">
              No verification code is available yet. Request one below to continue.
            </p>
          )}
          {emailVerificationStatus?.deliveryState === "PENDING" && (
            <p className={`${styles.emailDelivery} ${styles.emailDeliveryPending}`} role="status">
              Your verification email is being prepared. You can request another code below when
              available.
            </p>
          )}

          <label className={styles.emailCodeLabel} htmlFor="verification-code">
            Six-digit code
          </label>
          <input
            autoComplete="one-time-code"
            autoFocus
            className={styles.emailCodeInput}
            disabled={isSubmitting}
            id="verification-code"
            inputMode="numeric"
            maxLength={6}
            name="one-time-code"
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              setError("")
            }}
            pattern="[0-9]{6}"
            type="text"
            value={code}
          />
          {emailVerificationStatus?.codeExpiresAt && codeExpiry > 0 && (
            <p className={styles.emailExpiry} role="status">
              This code expires in {formatCountdown(codeExpiry)}.
            </p>
          )}

          {error && (
            <p className={styles.emailError} role="alert">
              {error}
            </p>
          )}
          {isCheckingStatus && (
            <p className={styles.emailChecking} role="status">
              Checking verification status…
            </p>
          )}

          <button
            className={styles.emailPrimaryButton}
            disabled={code.length !== 6 || isSubmitting}
            onClick={() => void handleVerify()}
            type="button"
          >
            {isSubmitting ? "Verifying…" : "Verify email"}
          </button>

          <div className={styles.emailResend}>
            <p>Didn&apos;t receive a code?</p>
            <button
              className={styles.emailResendButton}
              disabled={isResending || resendDelay > 0}
              onClick={() => void handleResend()}
              type="button"
            >
              {isResending
                ? "Sending…"
                : resendDelay > 0
                  ? `Resend available in ${formatCountdown(resendDelay)}`
                  : "Resend code"}
            </button>
          </div>

          <div className={styles.emailCorrection}>
            <button
              className={styles.emailSecondaryButton}
              onClick={() => {
                setIsChangingEmail((current) => !current)
                setError("")
              }}
              type="button"
            >
              {isChangingEmail ? "Cancel email change" : "Wrong email address?"}
            </button>
            {isChangingEmail && (
              <div className={styles.emailCorrectionForm}>
                <label className={styles.emailFieldLabel} htmlFor="verification-new-email">
                  Correct email
                </label>
                <input
                  autoComplete="email"
                  className={styles.emailTextInput}
                  id="verification-new-email"
                  onChange={(event) => setNewEmail(event.target.value)}
                  type="email"
                  value={newEmail}
                />
                <label className={styles.emailFieldLabel} htmlFor="verification-password">
                  Password
                </label>
                <input
                  autoComplete="current-password"
                  className={styles.emailTextInput}
                  id="verification-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
                <button
                  className={styles.emailCorrectionButton}
                  disabled={isCorrectingEmail || !newEmail.trim() || !password}
                  onClick={() => void handleCorrectEmail()}
                  type="button"
                >
                  {isCorrectingEmail ? "Updating email…" : "Update email and sign in"}
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          className={styles.emailSignOut}
          disabled={isLoggingOut}
          onClick={() => void handleLogout()}
          type="button"
        >
          {isLoggingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </main>
  )
}
