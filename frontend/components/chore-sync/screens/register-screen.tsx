"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ChevronLeftIcon } from "../icons"

const inputClass =
  "w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"

const fields = [
  { key: "name", label: "Full name", placeholder: "Jahid Hossain", type: "text" },
  { key: "email", label: "Email", placeholder: "you@example.com", type: "email" },
  { key: "password", label: "Password", placeholder: "••••••••", type: "password" },
  { key: "confirm", label: "Confirm password", placeholder: "••••••••", type: "password" },
] as const

export function RegisterScreen() {
  const { navigate } = useChoreSync()
  const { register } = useAuth()
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" })
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (isSubmitting) return
    setError("")

    if (form.password !== form.confirm) {
      setError("Passwords do not match.")
      return
    }

    setIsSubmitting(true)
    try {
      await register({ displayName: form.name, email: form.email, password: form.password })
      navigate("login")
    } catch (error) {
      if (error instanceof ApiError) setError(error.message)
      else setError("Unable to create your account. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-white px-6 pt-12 pb-10">
      <button onClick={() => navigate("login")} className="flex items-center gap-1 text-slate-500 mb-8 -ml-1 w-fit">
        <ChevronLeftIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>

      <h1 className="text-3xl font-black text-slate-900 mb-1 font-display">Create account</h1>
      <p className="text-slate-500 text-sm mb-8">Join ChoreSync and sync your home life</p>

      <div className="flex flex-col gap-4 mb-6">
        {fields.map(({ key, label, placeholder, type }) => (
          <div key={key}>
            <label htmlFor={`register-${key}`} className="block text-sm font-semibold text-slate-700 mb-1.5">
              {label}
            </label>
            <input
              id={`register-${key}`}
              type={type}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className={inputClass}
            />
          </div>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600" role="alert">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full bg-teal-600 text-white font-bold text-[15px] py-4 rounded-xl shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Creating Account..." : "Create Account"}
      </button>

      <p className="text-center text-xs text-slate-400 mt-4">
        By signing up you agree to our <span className="text-teal-600 font-medium">Terms of Service</span>
      </p>
    </div>
  )
}
