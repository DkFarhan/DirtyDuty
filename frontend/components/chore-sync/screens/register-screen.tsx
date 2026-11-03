"use client"

import { useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { getLegalDocumentUrl } from "@/lib/chore-sync/legal-navigation"
import { PasswordInput } from "@/components/ui/password-input"
import { GoogleSignInButton } from "../google-sign-in-button"
import { AuthScreenLayout } from "./auth-screen-layout"
import styles from "./auth-screens.module.css"

const fields = [
  {
    key: "name",
    label: "Full name",
    placeholder: "Your name",
    type: "text",
    autoComplete: "name",
  },
  {
    key: "email",
    label: "Email",
    placeholder: "you@example.com",
    type: "email",
    autoComplete: "email",
  },
  {
    key: "password",
    label: "Password",
    placeholder: "Create a password",
    type: "password",
    autoComplete: "new-password",
  },
  {
    key: "confirm",
    label: "Confirm password",
    placeholder: "Enter your password again",
    type: "password",
    autoComplete: "new-password",
  },
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
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message)
        setDuplicateRegistration(cause.status === 409)
      } else setError("Unable to create your account. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthScreenLayout
      centeredBrand
      description="A few details to get your household started on a smoother routine."
      eyebrow="Make room for easier days"
      onBack={() => navigate("login")}
      title="Create account"
      footer={
        <>
          Already have an account?
          <button className={styles.textButton} onClick={() => navigate("login")} type="button">
            Sign in
          </button>
        </>
      }
    >
      {features.google && (
        <>
          <GoogleSignInButton className={styles.googleButton} />
          <div className={styles.divider}>or sign up with email</div>
        </>
      )}

      <div className={styles.fields}>
        {fields.map(({ key, label, placeholder, type, autoComplete }) => (
          <div className={styles.field} key={key}>
            <label className={styles.label} htmlFor={`register-${key}`}>
              {label}
            </label>
            {type === "password" ? (
              <PasswordInput
                autoComplete={autoComplete}
                className={styles.input}
                id={`register-${key}`}
                name={key}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [key]: event.target.value }))
                }
                placeholder={placeholder}
                toggleClassName={styles.passwordToggle}
                value={form[key]}
              />
            ) : (
              <input
                autoComplete={autoComplete}
                className={styles.input}
                id={`register-${key}`}
                name={key}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [key]: event.target.value }))
                }
                placeholder={placeholder}
                type={type}
                value={form[key]}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className={`${styles.error} mt-4`} role="alert">
          <p>{error}</p>
          {duplicateRegistration && (
            <div className={styles.duplicateActions}>
              <button
                className={styles.textButton}
                onClick={() => {
                  window.sessionStorage.setItem("auth-prefill-email", form.email.trim())
                  navigate("login")
                }}
                type="button"
              >
                Sign In
              </button>
              <button
                className={styles.textButton}
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

      <div className={styles.consent}>
        <label className={styles.consentLabel}>
          <input
            aria-describedby={termsError ? "register-terms-error" : undefined}
            checked={termsAccepted}
            className={styles.checkbox}
            onChange={(event) => {
              setTermsAccepted(event.target.checked)
              if (event.target.checked) setTermsError("")
            }}
            type="checkbox"
          />
          <span>
            I agree to the{" "}
            <a
              aria-label="Terms of Service (opens in a new tab)"
              className={styles.legalLink}
              href={getLegalDocumentUrl("/terms", "register")}
              rel="noopener noreferrer"
              target="_blank"
            >
              Terms of Service
            </a>{" "}
            and acknowledge the{" "}
            <a
              aria-label="Privacy Policy (opens in a new tab)"
              className={styles.legalLink}
              href={getLegalDocumentUrl("/privacy", "register")}
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy Policy
            </a>
          </span>
        </label>
        {termsError && (
          <p className={`${styles.error} mt-3`} id="register-terms-error" role="alert">
            {termsError}
          </p>
        )}
      </div>
      <div className={styles.actionSpace}>
        <button
          className={`${styles.primaryButton} auth-primary-button`}
          disabled={isSubmitting}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? "Creating Account..." : "Create Account"}
        </button>
      </div>
    </AuthScreenLayout>
  )
}
