"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"

const inputClass =
  "w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"

export function LoginScreen() {
  const { navigate } = useChoreSync()
  const { login, authNotice, dismissAuthNotice } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (isSubmitting) return
    setError("")
    setIsSubmitting(true)

    try {
      await login(email, password)
      navigate("welcome")
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
        <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-teal-200">
          <span className="text-3xl">🏠</span>
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight font-display">
          ChoreSync
        </h1>
        <p className="text-slate-500 text-sm mt-1">Keep your home running smoothly</p>
      </div>

      <div className="flex flex-col gap-4 mb-6">
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
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
        <button className="text-right text-sm text-teal-600 font-semibold -mt-2">
          Forgot password?
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full bg-teal-600 text-white font-bold text-[15px] py-4 rounded-xl shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Signing In..." : "Sign In"}
      </button>

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-xs text-slate-400 font-medium">or continue with</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      <button className="w-full border border-slate-200 text-slate-700 font-semibold text-[15px] py-3.5 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
        <span className="text-lg font-display font-bold">G</span>
        <span>Continue with Google</span>
      </button>

      <p className="text-center text-sm text-slate-500 mt-auto pt-8">
        {"Don't have an account? "}
        <button onClick={() => navigate("register")} className="text-teal-600 font-bold">
          Sign up
        </button>
      </p>
    </div>
  )
}
