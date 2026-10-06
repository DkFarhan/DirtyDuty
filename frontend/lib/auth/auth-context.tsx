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
}

type RegisterInput = {
  displayName: string
  email: string
  password: string
}

type AuthContextValue = {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  authNotice: string | null
  dismissAuthNotice: () => void
  register: (input: RegisterInput) => Promise<void>
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  deleteAccount: (password: string, confirmation: string) => Promise<void>
  refreshUser: () => Promise<AuthUser | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)

  const refreshUser = async () => {
    try {
      const currentUser = await api.get<AuthUser>("/api/auth/me")
      setUser(currentUser)
      setAuthError(null)
      return currentUser
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null)
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
      .finally(() => setIsLoading(false))
  }, [])

  const register = async (input: RegisterInput) => {
    await api.post("/api/auth/register", input)
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
    clearCsrfToken()
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await api.post<void>("/api/auth/change-password", { currentPassword, newPassword })
    setUser(null)
    clearCsrfToken()
    setAuthNotice("Password changed successfully. Please sign in again.")
  }

  const deleteAccount = async (password: string, email: string) => {
    await api.post<void>("/api/auth/delete-account", { password, email })
    setUser(null)
    clearCsrfToken()
    setAuthNotice("Your account has been permanently deleted.")
  }

  const dismissAuthNotice = () => setAuthNotice(null)

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      authError,
      authNotice,
      dismissAuthNotice,
      register,
      login,
      logout,
      changePassword,
      deleteAccount,
      refreshUser,
    }),
    [authError, authNotice, isLoading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
