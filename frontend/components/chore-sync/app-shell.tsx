"use client"

import { useEffect } from "react"
import { AuthProvider, useAuth } from "@/lib/auth/auth-context"
import { getAuthRedirect } from "@/lib/auth/routing"
import { ChoreSyncProvider, useChoreSync } from "@/lib/chore-sync/store"
import { HouseholdProvider, useHouseholds } from "@/lib/household/household-context"
import { getHouseholdRedirect } from "@/lib/household/routing"
import { LoginScreen } from "./screens/login-screen"
import { RegisterScreen } from "./screens/register-screen"
import { WelcomeScreen } from "./screens/welcome-screen"
import { CreateHouseholdScreen } from "./screens/create-household-screen"
import { JoinHouseholdScreen } from "./screens/join-household-screen"
import { DashboardScreen } from "./screens/dashboard-screen"
import { MyChoresScreen } from "./screens/my-chores-screen"
import { HouseholdScreen } from "./screens/household-screen"
import { AdminScreen } from "./screens/admin-screen"
import { ChoreFormScreen } from "./screens/chore-form-screen"
import { ProfileScreen } from "./screens/profile-screen"

function ScreenRouter() {
  const { screen, adminTab, navigate, setCurrentUser } = useChoreSync()
  const { user, isAuthenticated, isLoading, authError, refreshUser } = useAuth()
  const { households, status: householdStatus, error: householdError, refresh: refreshHouseholds } = useHouseholds()

  useEffect(() => {
    if (user) {
      setCurrentUser({
        id: user.userId,
        name: user.displayName,
        avatar: user.displayName.slice(0, 1).toUpperCase(),
        isAdmin: false,
      })
    }
  }, [setCurrentUser, user])

  useEffect(() => {
    const redirect = isAuthenticated
      ? getHouseholdRedirect(screen, true, householdStatus, households.length)
      : getAuthRedirect(screen, false, isLoading)
    if (redirect) navigate(redirect)
  }, [householdStatus, households.length, isAuthenticated, isLoading, navigate, screen])

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-400">Loading...</div>
  }

  if (authError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-sm text-slate-600">{authError}</p>
        <button
          onClick={() => refreshUser().catch(() => undefined)}
          className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (isAuthenticated && householdStatus === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-400">Loading...</div>
  }

  if (isAuthenticated && householdStatus === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p role="alert" className="text-sm text-slate-600">{householdError}</p>
        <button
          onClick={() => refreshHouseholds().catch(() => undefined)}
          className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white"
        >
          Try Again
        </button>
      </div>
    )
  }

  switch (screen) {
    case "login":
      return <LoginScreen />
    case "register":
      return <RegisterScreen />
    case "welcome":
      return <WelcomeScreen />
    case "create-household":
      return <CreateHouseholdScreen />
    case "join-household":
      return <JoinHouseholdScreen />
    case "dashboard":
      return <DashboardScreen />
    case "my-chores":
      return <MyChoresScreen />
    case "household":
      return <HouseholdScreen />
    case "admin":
      return <AdminScreen initialTab={adminTab} />
    case "create-chore":
      return <ChoreFormScreen />
    case "edit-chore":
      return <ChoreFormScreen />
    case "profile":
      return <ProfileScreen />
    default:
      return <LoginScreen />
  }
}

export function AppShell() {
  return (
    <AuthProvider>
      <HouseholdProvider>
        <ChoreSyncProvider>
          <div className="min-h-screen bg-slate-200 flex items-start justify-center">
            <div className="w-full max-w-sm bg-white min-h-screen relative overflow-hidden shadow-2xl">
              <ScreenRouter />
            </div>
          </div>
        </ChoreSyncProvider>
      </HouseholdProvider>
    </AuthProvider>
  )
}
