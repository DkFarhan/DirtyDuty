"use client"

import { useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { PasswordInput } from "@/components/ui/password-input"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500"

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

      <h1 className="mb-2 text-2xl font-black text-slate-900">
        {complete ? "Password updated" : "Choose a new password"}
      </h1>

      {complete ? (
        <>
          <p className="text-sm text-slate-600" role="status">
            Your password has been changed. You can now sign in with it.
          </p>

          <button
            className="mt-6 min-h-12 w-full rounded-xl bg-teal-600 font-bold text-white"
            onClick={() => navigate("login")}
            type="button"
          >
            Sign in
          </button>
        </>
      ) : (
        <>
          <p className="mb-6 text-sm text-slate-500">Choose a new password for your account.</p>

          <label
            htmlFor="reset-new-password"
            className="mb-1.5 text-sm font-semibold text-slate-700"
          >
            New password
          </label>

          <PasswordInput
            autoComplete="new-password"
            className={inputClass}
            id="reset-new-password"
            name="newPassword"
            onChange={(event) => setPassword(event.target.value)}
            value={password}
          />

          <label
            htmlFor="reset-confirm-password"
            className="mb-1.5 mt-4 text-sm font-semibold text-slate-700"
          >
            Confirm new password
          </label>

          <PasswordInput
            autoComplete="new-password"
            className={inputClass}
            id="reset-confirm-password"
            name="confirmPassword"
            onChange={(event) => setConfirm(event.target.value)}
            value={confirm}
          />

          {error && (
            <p className="mt-4 text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}

          <button
            className="mt-6 min-h-12 w-full rounded-xl bg-teal-600 font-bold text-white disabled:opacity-60"
            disabled={busy || !token || !password || !confirm}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "Updating..." : "Update password"}
          </button>
        </>
      )}
    </main>
  )
}
