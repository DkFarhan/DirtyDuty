"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ProductLogo } from "@/components/brand/product-logo"
import { PasswordInput } from "@/components/ui/password-input"
import { ChevronLeftIcon } from "../icons"
import { GoogleSignInButton } from "../google-sign-in-button"

const inputClass =
  "w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"

const fields = [
  { key: "name", label: "Full name", placeholder: "John Doe", type: "text" },
  { key: "email", label: "Email", placeholder: "you@example.com", type: "email" },
  { key: "password", label: "Password", placeholder: "••••••••", type: "password" },
  { key: "confirm", label: "Confirm password", placeholder: "••••••••", type: "password" },
] as const

export function RegisterScreen() {
  const { navigate } = useChoreSync()
  const { register, features } = useAuth()
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" })
  const [error, setError] = useState("")
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsError, setTermsError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [duplicateRegistration, setDuplicateRegistration] = useState(false)

  const handleSubmit = async () => {
    if (isSubmitting) return
    setError("")
    setDuplicateRegistration(false)

    if (!termsAccepted) {
      setTermsError(
        "Please agree to the Terms of Service and acknowledge the Privacy Policy to create an account.",
      )
      return
    }
    setTermsError("")

    if (form.password !== form.confirm) {
      setError("Passwords do not match.")
      return
    }

    setIsSubmitting(true)
    try {
      const authenticatedUser = await register({
        displayName: form.name,
        email: form.email,
        password: form.password,
        termsAccepted: true,
        privacyPolicyAcknowledged: true,
      })
      navigate(authenticatedUser.emailVerified ? "welcome" : "verify-email")
    } catch (error) {
      if (error instanceof ApiError) {
        setError(error.message)
        setDuplicateRegistration(error.status === 409)
      } else setError("Unable to create your account. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-white px-6 pt-12 pb-10">
      <button
        onClick={() => navigate("login")}
        className="flex items-center gap-1 text-slate-500 mb-8 -ml-1 w-fit"
      >
        <ChevronLeftIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>

      <ProductLogo className="mb-6 h-auto w-44 max-w-full" />
      <h1 className="text-3xl font-black text-slate-900 mb-1 font-display">Create account</h1>
      <p className="text-slate-500 text-sm mb-8">Set up your account to get started</p>

      {features.google && (
        <>
          <GoogleSignInButton />
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs font-medium text-slate-400">or sign up with email</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>
        </>
      )}

      <div className="flex flex-col gap-4 mb-6">
        {fields.map(({ key, label, placeholder, type }) => (
          <div key={key}>
            <label
              htmlFor={`register-${key}`}
              className="block text-sm font-semibold text-slate-700 mb-1.5"
            >
              {label}
            </label>
            {type === "password" ? (
              <PasswordInput
                autoComplete="new-password"
                id={`register-${key}`}
                name={key}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className={inputClass}
              />
            ) : (
              <input
                id={`register-${key}`}
                type={type}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className={inputClass}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4" role="alert">
          <p className="text-sm text-rose-600">{error}</p>
          {duplicateRegistration && (
            <div className="mt-2 flex gap-4 text-sm font-semibold text-teal-700">
              <button
                onClick={() => {
                  window.sessionStorage.setItem("auth-prefill-email", form.email.trim())
                  navigate("login")
                }}
                type="button"
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  window.sessionStorage.setItem("auth-prefill-email", form.email.trim())
                  navigate("forgot-password")
                }}
                type="button"
              >
                Forgot Password
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
          <input
            aria-describedby={termsError ? "register-terms-error" : undefined}
            checked={termsAccepted}
            className="mt-1 h-4 w-4 shrink-0 accent-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            onChange={(event) => {
              setTermsAccepted(event.target.checked)
              if (event.target.checked) setTermsError("")
            }}
            type="checkbox"
          />
          <span>
            I agree to the{" "}
            <a
              className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300 dark:hover:text-teal-200"
              href="/terms"
              rel="noopener noreferrer"
              target="_blank"
            >
              Terms of Service
            </a>{" "}
            and acknowledge the{" "}
            <a
              className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300 dark:hover:text-teal-200"
              href="/privacy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy Policy
            </a>
          </span>
        </label>
        {termsError && (
          <p
            className="mt-1.5 text-xs font-medium text-rose-600"
            id="register-terms-error"
            role="alert"
          >
            {termsError}
          </p>
        )}
      </div>
      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full bg-teal-600 text-white font-bold text-[15px] py-4 rounded-xl shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Creating Account..." : "Create Account"}
      </button>
    </div>
  )
}
