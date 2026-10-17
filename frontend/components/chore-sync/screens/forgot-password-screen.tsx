"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"

export function ForgotPasswordScreen({ initialEmail = "" }: { initialEmail?: string }) {
  const { navigate } = useChoreSync()
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState(initialEmail)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await requestPasswordReset(email)
      setMessage("If an account exists for that email, password reset instructions will be sent.")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to request a password reset. Please try again.",
      )
    } finally {
      setBusy(false)
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
      <h1 className="mb-2 text-2xl font-black text-slate-900">Reset your password</h1>
      <p className="mb-6 text-sm text-slate-500">
        Enter your email and we&apos;ll send reset instructions if an account is registered.
      </p>
      <label htmlFor="reset-request-email" className="mb-1.5 text-sm font-semibold text-slate-700">
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
      {message && (
        <p className="mt-4 text-sm text-teal-700" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}
      <button
        className="mt-6 min-h-12 w-full rounded-xl bg-teal-600 py-3 font-bold text-white disabled:opacity-60"
        disabled={busy || !email.trim()}
        onClick={() => void submit()}
        type="button"
      >
        {busy ? "Sending..." : "Send reset instructions"}
      </button>
    </main>
  )
}
