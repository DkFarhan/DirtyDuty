"use client"

import { useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ProductLogo } from "@/components/brand/product-logo"
import { PasswordInput } from "@/components/ui/password-input"
import { GoogleSignInButton } from "../google-sign-in-button"

const inputClass =
  "w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"

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
    } catch (error) {
      if (error instanceof ApiError) setError(error.message)
      else setError("Unable to sign in. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-white px-6 pt-16 pb-10">
      <div className="flex flex-col items-center mb-12">
        <ProductLogo className="mb-3 h-auto w-48 max-w-full" />
        <p className="text-slate-500 text-sm mt-1">Keep your home running smoothly</p>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        {oauthMessage && (
          <p
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="status"
          >
            {oauthMessage}
          </p>
        )}
        {authNotice && (
          <div
            className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-800"
            role="status"
          >
            <div className="flex items-start justify-between gap-3">
              <span>{authNotice}</span>
              <button
                aria-label="Dismiss message"
                className="font-bold"
                onClick={dismissAuthNotice}
                type="button"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <div>
          <label
            htmlFor="login-email"
            className="block text-sm font-semibold text-slate-700 mb-1.5"
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="login-password"
            className="block text-sm font-semibold text-slate-700 mb-1.5"
          >
            Password
          </label>
          <PasswordInput
            autoComplete="current-password"
            id="login-password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
        {(features.passwordReset || features.emailVerification) && (
          <button
            className="-mt-2 min-h-10 self-end text-right text-sm font-semibold text-teal-600"
            onClick={() => navigate("forgot-password")}
            type="button"
          >
            Forgot password?
          </button>
        )}
      </div>

      {error && (
        <p className="mb-4 text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="auth-primary-button w-full bg-teal-600 text-white font-bold text-[15px] py-4 rounded-xl shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Signing In..." : "Sign In"}
      </button>

      {googleLinkRequired && (
        <button
          className="mt-3 min-h-12 w-full rounded-xl bg-slate-900 font-bold text-white disabled:opacity-60"
          disabled={linkBusy || !password}
          onClick={() => void linkGoogle()}
          type="button"
        >
          {linkBusy ? "Linking Google..." : "Sign in and link Google"}
        </button>
      )}

      {features.google && (
        <>
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs font-medium text-slate-400">or continue with</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>
          <GoogleSignInButton />
        </>
      )}

      <p className="text-center text-sm text-slate-500 mt-auto pt-8">
        {"Don't have an account? "}
        <button
          onClick={() => navigate("register")}
          className="min-h-10 text-teal-600 font-bold"
          type="button"
        >
          Sign up
        </button>
      </p>
    </div>
  )
}
