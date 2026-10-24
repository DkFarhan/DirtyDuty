"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { notificationApi } from "@/lib/notifications/api"
import { removeBrowserPushSubscription } from "@/lib/notifications/push"
import { ApiError, api, clearCsrfToken, getCsrfToken } from "./api"

export type AuthUser = {
  userId: string
  displayName: string
  email: string
  emailVerified: boolean
  hasPassword: boolean
  authProviders: string[]
  legalAcceptanceRequired: boolean
}

export type AuthFeatures = {
  google: boolean
  passwordReset: boolean
  emailVerification?: boolean
}

type RegisterInput = {
  displayName: string
  email: string
  password: string
  termsAccepted: true
  privacyPolicyAcknowledged: true
}

export type EmailVerificationStatus = {
  email: string
  emailVerified: boolean
  codeExpiresAt: string | null
  resendAvailableAt: string | null
  deliveryState: "SENT" | "FAILED" | "NONE" | "PENDING"
}

type AuthContextValue = {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  authNotice: string | null
  emailVerificationStatus: EmailVerificationStatus | null
  features: AuthFeatures
  dismissAuthNotice: () => void
  register: (input: RegisterInput) => Promise<AuthUser>
  refreshEmailVerificationStatus: () => Promise<EmailVerificationStatus>
  verifyEmail: (code: string) => Promise<AuthUser>
  resendVerificationCode: () => Promise<EmailVerificationStatus>
  correctVerificationEmail: (email: string, password: string) => Promise<void>
  requestEmailVerificationRecovery: (email: string) => Promise<void>
  completeEmailVerificationRecovery: (input: {
    email: string
    code: string
    newPassword: string
    displayName: string
  }) => Promise<AuthUser>
  completeLegalAcceptance: () => Promise<void>
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  deleteAccount: (password: string, confirmation: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  confirmPasswordReset: (token: string, newPassword: string) => Promise<void>
  completeGoogleLink: (password: string) => Promise<void>
  refreshUser: () => Promise<AuthUser | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [emailVerificationStatus, setEmailVerificationStatus] =
    useState<EmailVerificationStatus | null>(null)
  const [features, setFeatures] = useState<AuthFeatures>({
    google: false,
    passwordReset: false,
  })

  const refreshUser = async () => {
    try {
      const currentUser = await api.get<AuthUser>("/api/auth/me")
      setUser(currentUser)
      if (currentUser.emailVerified) setEmailVerificationStatus(null)
      setAuthError(null)
      return currentUser
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null)
        setEmailVerificationStatus(null)
        setAuthError(null)
        return null
      }
      setAuthError("Unable to verify your session. Please try again.")
      throw error
    }
  }

  useEffect(() => {
    refreshUser()
      .catch(() => undefined)
      .finally(() => {
        setIsLoading(false)
        api
          .get<AuthFeatures>("/api/auth/providers")
          .then(setFeatures)
          .catch((cause: unknown) => {
            console.warn(
              "Unable to load optional authentication features; password sign-in remains available.",
              cause,
            )
            setFeatures({ google: false, passwordReset: false })
          })
      })
  }, [])

  const register = async (input: RegisterInput) => {
    await api.post<AuthUser>("/api/auth/register", input)
    clearCsrfToken()
    await getCsrfToken()
    const authenticatedUser = await refreshUser()
    if (!authenticatedUser) throw new Error("Unable to verify your session. Please try again.")
    setAuthNotice(null)
    return authenticatedUser
  }

  const refreshEmailVerificationStatus = async () => {
    const status = await api.get<EmailVerificationStatus>("/api/auth/email-verification/status")
    setEmailVerificationStatus(status)
    return status
  }

  const verifyEmail = async (code: string) => {
    await api.post<void>("/api/auth/email-verification/verify", { code })
    const authenticatedUser = await refreshUser()
    if (!authenticatedUser) throw new Error("Unable to verify your session. Please try again.")
    setEmailVerificationStatus(null)
    return authenticatedUser
  }

  const resendVerificationCode = async () => {
    const status = await api.post<EmailVerificationStatus>("/api/auth/email-verification/resend")
    setEmailVerificationStatus(status)
    return status
  }

  const correctVerificationEmail = async (email: string, password: string) => {
    await api.post<void>("/api/auth/email-verification/correct-email", { email, password })
    setUser(null)
    setEmailVerificationStatus(null)
    clearCsrfToken()
    setAuthNotice("Your email was updated. Sign in with your new email to continue.")
  }

  const requestEmailVerificationRecovery = async (email: string) => {
    await api.post<void>("/api/auth/email-verification/recovery/request", { email })
  }

  const completeEmailVerificationRecovery = async (input: {
    email: string
    code: string
    newPassword: string
    displayName: string
  }) => {
    const recoveredUser = await api.post<AuthUser>(
      "/api/auth/email-verification/recovery/complete",
      input,
    )
    clearCsrfToken()
    await getCsrfToken()
    setUser(recoveredUser)
    setEmailVerificationStatus(null)
    setAuthNotice(null)
    return recoveredUser
  }

  const completeLegalAcceptance = async () => {
    await api.post("/api/auth/legal-acceptance", {
      termsAccepted: true,
      privacyPolicyAcknowledged: true,
    })
    await refreshUser()
  }

  const login = async (email: string, password: string) => {
    await api.post<void>("/api/auth/login", { email, password })
    clearCsrfToken()
    await getCsrfToken()
    const authenticatedUser = await refreshUser()
    if (!authenticatedUser) throw new Error("Unable to verify your session. Please try again.")
    setAuthNotice(null)
    return authenticatedUser
  }

  const logout = async () => {
    try {
      if (typeof window !== "undefined") {
        const endpoint = await removeBrowserPushSubscription()
        if (endpoint) {
          try {
            await notificationApi.unsubscribePush(endpoint)
          } catch (error) {
            console.warn("Ignoring browser push cleanup failure during logout.", error)
          }
        }
      }
    } catch (error) {
      console.warn("Ignoring browser push cleanup failure during logout.", error)
    }

    await api.post<void>("/api/auth/logout")
    setUser(null)
    setEmailVerificationStatus(null)
    clearCsrfToken()
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await api.post<void>("/api/auth/change-password", { currentPassword, newPassword })
    setUser(null)
    setEmailVerificationStatus(null)
    clearCsrfToken()
    setAuthNotice("Password changed successfully. Please sign in again.")
  }

  const deleteAccount = async (password: string, email: string) => {
    await api.post<void>("/api/auth/delete-account", { password, email })
    setUser(null)
    setEmailVerificationStatus(null)
    clearCsrfToken()
    setAuthNotice("Your account has been permanently deleted.")
  }

  const requestPasswordReset = async (email: string) => {
    await api.post<void>("/api/auth/password-reset/request", { email })
  }

  const confirmPasswordReset = async (token: string, newPassword: string) => {
    await api.post<void>("/api/auth/password-reset/confirm", { token, newPassword })
  }

  const completeGoogleLink = async (password: string) => {
    await api.post<void>("/api/auth/google/link", { password })
    clearCsrfToken()
    await getCsrfToken()
    const authenticatedUser = await refreshUser()
    if (!authenticatedUser) throw new Error("Unable to verify your session. Please try again.")
  }

  const dismissAuthNotice = () => setAuthNotice(null)

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      authError,
      authNotice,
      emailVerificationStatus,
      features,
      dismissAuthNotice,
      register,
      refreshEmailVerificationStatus,
      verifyEmail,
      resendVerificationCode,
      correctVerificationEmail,
      requestEmailVerificationRecovery,
      completeEmailVerificationRecovery,
      completeLegalAcceptance,
      login,
      logout,
      changePassword,
      deleteAccount,
      requestPasswordReset,
      confirmPasswordReset,
      completeGoogleLink,
      refreshUser,
    }),
    [authError, authNotice, emailVerificationStatus, features, isLoading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
