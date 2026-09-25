"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
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
    register: (input: RegisterInput) => Promise<void>
    login: (email: string, password: string) => Promise<AuthUser>
    logout: () => Promise<void>
    refreshUser: () => Promise<AuthUser | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [authError, setAuthError] = useState<string | null>(null)

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
        return authenticatedUser
    }

    const logout = async () => {
        await api.post<void>("/api/auth/logout")
        setUser(null)
        clearCsrfToken()
    }

    const value = useMemo(
        () => ({
            user,
            isAuthenticated: user !== null,
            isLoading,
            authError,
            register,
            login,
            logout,
            refreshUser,
        }),
        [authError, isLoading, user],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) throw new Error("useAuth must be used within an AuthProvider")
    return context
}
