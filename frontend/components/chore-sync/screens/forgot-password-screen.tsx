"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ProductLogo } from "@/components/brand/product-logo"
import { PasswordInput } from "@/components/ui/password-input"
import { ChevronLeftIcon } from "../icons"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"

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
    setCooldownUntil(null)
    setCooldown(0)
    setError("")
  }

  const completeRecovery = async () => {
    if (recoveryInFlight.current || recoveryCode.length !== 6 || newPassword.length < 12) {
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

  return (
    <main className="flex min-h-screen flex-col bg-white px-6 pb-10 pt-12">
      <button
        type="button"
        onClick={() => navigate("login")}
        className="mb-8 flex min-h-11 w-fit items-center gap-1 text-slate-500"
      >
        <ChevronLeftIcon className="h-5 w-5" />
        <span className="text-sm font-medium">Back to sign in</span>
      </button>
      <ProductLogo className="mb-8 h-auto w-44 max-w-full" />
      {confirmationEmail ? (
        <section
          aria-labelledby="reset-email-confirmation-title"
          className="rounded-2xl border border-teal-100 bg-teal-50/70 p-5"
        >
          <h1 className="text-2xl font-black text-slate-900" id="reset-email-confirmation-title">
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-700" role="status">
            If your account is eligible for recovery, we&apos;ll send instructions to your email.
          </p>
          <p className="mt-2 break-all text-sm font-semibold text-slate-800">{confirmationEmail}</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Check your inbox and spam folder. Password reset links expire after 30 minutes; recovery
            codes expire after 10 minutes.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            If you no longer have access to this email or still need help, contact DirtyDuty
            support.
          </p>

          {!showRecoveryCodeForm ? (
            <button
              className="mt-4 min-h-10 text-sm font-semibold text-teal-700"
              onClick={() => setShowRecoveryCodeForm(true)}
              type="button"
            >
              Received a recovery code?
            </button>
          ) : (
            <div className="mt-5 flex flex-col gap-3 border-t border-teal-100 pt-4">
              <label className="text-sm font-semibold text-slate-700" htmlFor="recovery-code">
                Six-digit recovery code
              </label>
              <input
                autoComplete="one-time-code"
                className={inputClass}
                id="recovery-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                value={recoveryCode}
              />
              <label
                className="text-sm font-semibold text-slate-700"
                htmlFor="recovery-new-password"
              >
                New password
              </label>
              <PasswordInput
                autoComplete="new-password"
                className={inputClass}
                id="recovery-new-password"
                name="recovery-new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                value={newPassword}
              />
              <button
                className="min-h-11 w-full rounded-xl bg-teal-600 px-4 py-2 font-bold text-white disabled:opacity-60"
                disabled={recoveryBusy || recoveryCode.length !== 6 || newPassword.length < 12}
                onClick={() => void completeRecovery()}
                type="button"
              >
                {recoveryBusy ? "Recovering account..." : "Verify code and continue"}
              </button>
            </div>
          )}

          <div className="mt-6 border-t border-teal-100 pt-4">
            <p className="text-sm font-semibold text-slate-700">Didn&apos;t receive an email?</p>
            {cooldown > 0 ? (
              <p className="mt-1 text-sm text-slate-500" role="timer">
                Resend available in {cooldown} {cooldown === 1 ? "second" : "seconds"}.
              </p>
            ) : (
              <button
                className="mt-2 min-h-10 font-bold text-teal-700 disabled:opacity-60"
                disabled={busy}
                onClick={() => void sendResetRequest(true)}
                type="button"
              >
                {busy ? "Sending..." : "Resend email"}
              </button>
            )}
          </div>
          {error && (
            <p className="mt-3 text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}
          <button
            className="mt-5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700"
            disabled={busy || recoveryBusy}
            onClick={useDifferentEmail}
            type="button"
          >
            Use a different email
          </button>
        </section>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-black text-slate-900">Reset your password</h1>
          <p className="mb-6 text-sm text-slate-500">
            Enter your email and we&apos;ll send reset instructions if an account is registered.
          </p>
          <label
            htmlFor="reset-request-email"
            className="mb-1.5 text-sm font-semibold text-slate-700"
          >
            Email
          </label>
          <input
            autoComplete="email"
            className={inputClass}
            id="reset-request-email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          {error && (
            <p className="mt-4 text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}
          <button
            className="mt-6 min-h-12 w-full rounded-xl bg-teal-600 py-3 font-bold text-white disabled:opacity-60"
            disabled={busy || !email.trim()}
            onClick={() => void sendResetRequest(false)}
            type="button"
          >
            {busy ? "Sending..." : "Send reset instructions"}
          </button>
        </>
      )}
    </main>
  )
}
