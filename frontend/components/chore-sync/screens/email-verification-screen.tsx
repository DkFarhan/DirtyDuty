"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ProductLogo } from "@/components/brand/product-logo"

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

  return (
    <main className="flex min-h-screen flex-col bg-white px-6 pb-10 pt-12">
      <ProductLogo className="mb-8 h-auto w-44 max-w-full" />
      <h1 className="mb-2 text-2xl font-black text-slate-900">Verify your email</h1>
      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        Enter the six-digit code for{" "}
        <span className="font-semibold text-slate-800">
          {emailVerificationStatus?.email ?? user?.email ?? "your email address"}
        </span>
        .
      </p>

      {emailVerificationStatus?.deliveryState === "SENT" && (
        <p className="mb-5 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          A verification code was sent to {emailVerificationStatus.email}.
        </p>
      )}
      {emailVerificationStatus?.deliveryState === "FAILED" && (
        <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We couldn&apos;t deliver a verification code. You can try sending another one below.
        </p>
      )}
      {emailVerificationStatus?.deliveryState === "NONE" && (
        <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No verification code is available yet. Request one below to continue.
        </p>
      )}

      <label
        className="mb-2 block text-sm font-semibold text-slate-700"
        htmlFor="verification-code"
      >
        Six-digit code
      </label>
      <input
        autoComplete="one-time-code"
        autoFocus
        className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-4 text-center font-mono text-2xl tracking-[0.65em] text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"
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
        <p className="mb-4 text-xs text-slate-500" role="status">
          This code expires in {formatCountdown(codeExpiry)}.
        </p>
      )}

      {error && (
        <p className="mb-4 text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}
      {isCheckingStatus && (
        <p className="mb-4 text-sm text-slate-500" role="status">
          Checking verification status…
        </p>
      )}

      <button
        className="w-full rounded-xl bg-teal-600 py-4 text-[15px] font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={code.length !== 6 || isSubmitting}
        onClick={() => void handleVerify()}
        type="button"
      >
        {isSubmitting ? "Verifying…" : "Verify email"}
      </button>

      <div className="mt-6 text-center">
        <p className="text-sm text-slate-600">Didn&apos;t receive a code?</p>
        <button
          className="mt-1 min-h-10 font-semibold text-teal-700 disabled:cursor-not-allowed disabled:text-slate-400"
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

      <div className="mt-6 border-t border-slate-100 pt-5">
        <button
          className="min-h-10 text-sm font-semibold text-slate-600 underline underline-offset-2"
          onClick={() => {
            setIsChangingEmail((current) => !current)
            setError("")
          }}
          type="button"
        >
          {isChangingEmail ? "Cancel email change" : "Wrong email address?"}
        </button>
        {isChangingEmail && (
          <div className="mt-4 flex flex-col gap-3">
            <label
              className="text-sm font-semibold text-slate-700"
              htmlFor="verification-new-email"
            >
              Correct email
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[15px] text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"
              id="verification-new-email"
              onChange={(event) => setNewEmail(event.target.value)}
              type="email"
              value={newEmail}
            />
            <label className="text-sm font-semibold text-slate-700" htmlFor="verification-password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[15px] text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"
              id="verification-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
            <button
              className="w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 disabled:opacity-60"
              disabled={isCorrectingEmail || !newEmail.trim() || !password}
              onClick={() => void handleCorrectEmail()}
              type="button"
            >
              {isCorrectingEmail ? "Updating email…" : "Update email and sign in"}
            </button>
          </div>
        )}
      </div>

      <button
        className="mt-auto min-h-11 pt-8 text-sm font-semibold text-slate-500"
        disabled={isLoggingOut}
        onClick={() => void handleLogout()}
        type="button"
      >
        {isLoggingOut ? "Signing out…" : "Sign out"}
      </button>
    </main>
  )
}
