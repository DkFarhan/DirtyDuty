"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import { ThemeProvider, useTheme } from "@/components/theme/theme-provider"
import type { Screen } from "@/lib/chore-sync/types"
import { AuthProvider, useAuth } from "@/lib/auth/auth-context"
import { getAuthRedirect } from "@/lib/auth/routing"
import { ChoreSyncProvider, useChoreSync } from "@/lib/chore-sync/store"
import { HouseholdProvider, useHouseholds } from "@/lib/household/household-context"
import { DataSyncProvider } from "@/lib/data-sync/data-sync-context"
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
import { HouseholdSettingsScreen } from "./screens/household-settings-screen"
import { NotificationsScreen } from "./screens/notifications-screen"
import { EditProfileScreen } from "./screens/edit-profile-screen"
import { PrivacySecurityScreen } from "./screens/privacy-security-screen"
import { HelpSupportScreen } from "./screens/help-support-screen"
import { ForgotPasswordScreen } from "./screens/forgot-password-screen"
import { ResetPasswordScreen } from "./screens/reset-password-screen"
import { LegalAcceptanceScreen } from "./screens/legal-acceptance-screen"
import { AppearanceScreen } from "./screens/appearance-screen"
import { EmailVerificationScreen } from "./screens/email-verification-screen"
import { AppLaunchGate } from "./launch-experience"
import { PushSubscriptionHealthProvider } from "@/lib/notifications/push-health"

const authenticationScreens = new Set<Screen>([
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "verify-email",
])

const screenTargets = new Map<string, Screen>([
  ["dashboard", "dashboard"],
  ["my-chores", "my-chores"],
  ["household", "household"],
  ["notifications", "notifications"],
  ["profile", "profile"],
  ["appearance", "appearance"],
  ["household-settings", "household-settings"],
  ["admin", "admin"],
  ["privacy-security", "privacy-security"],
  ["legal-acceptance", "legal-acceptance"],
])

function ScreenRouter() {
  const { screen, adminTab, navigate, setCurrentUser } = useChoreSync()
  const { user, isAuthenticated, isLoading, authError, refreshUser, features } = useAuth()
  const { setPresentationLight } = useTheme()
  const skipNextRouteGuard = useRef(false)
  const {
    households,
    status: householdStatus,
    error: householdError,
    refresh: refreshHouseholds,
  } = useHouseholds()
  const verificationEnabled = features.emailVerification !== false
  const emailVerified = !verificationEnabled || user?.emailVerified === true
  const requiresEmailVerification =
    isAuthenticated && verificationEnabled && user?.emailVerified === false

  useLayoutEffect(() => {
    setPresentationLight(
      authenticationScreens.has(screen) ||
        requiresEmailVerification ||
        (!isAuthenticated && !isLoading),
    )
  }, [isAuthenticated, isLoading, requiresEmailVerification, screen, setPresentationLight])

  useEffect(() => {
    if (isLoading) return

    const target = new URLSearchParams(window.location.search).get("screen")
    const screenTarget = target ? screenTargets.get(target) : undefined
    if (screenTarget) {
      skipNextRouteGuard.current = screenTarget !== screen
      navigate(screenTarget)
      const params = new URLSearchParams(window.location.search)
      params.delete("screen")
      params.delete("returnTo")
      const query = params.toString()
      window.history.replaceState(
        {},
        "",
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      )
    }
  }, [isLoading, navigate, screen])

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
    if (skipNextRouteGuard.current) {
      skipNextRouteGuard.current = false
      return
    }

    const authRedirect = getAuthRedirect(screen, isAuthenticated, isLoading, emailVerified)
    const redirect =
      authRedirect ??
      (isAuthenticated && emailVerified
        ? getHouseholdRedirect(screen, true, householdStatus, households.length)
        : null)
    if (redirect) navigate(redirect)
  }, [
    householdStatus,
    households.length,
    isAuthenticated,
    isLoading,
    navigate,
    screen,
    emailVerified,
  ])

  useEffect(() => {
    if (isAuthenticated && screen === "legal-acceptance" && !user?.legalAcceptanceRequired) {
      navigate("welcome")
    }
  }, [isAuthenticated, navigate, screen, user?.legalAcceptanceRequired])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-400">
        Loading...
      </div>
    )
  }

  if (isAuthenticated && user?.legalAcceptanceRequired) {
    if (!emailVerified) return <EmailVerificationScreen />
    return <LegalAcceptanceScreen />
  }

  if (isAuthenticated && user && !emailVerified) return <EmailVerificationScreen />

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-400">
        Loading...
      </div>
    )
  }

  if (isAuthenticated && householdStatus === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p role="alert" className="text-sm text-slate-600">
          {householdError}
        </p>
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
    case "verify-email":
      return isAuthenticated && !emailVerified ? <EmailVerificationScreen /> : <WelcomeScreen />
    case "forgot-password":
      return <ForgotPasswordScreen initialEmail={user?.email ?? ""} />
    case "reset-password":
      return <ResetPasswordScreen />
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
    case "appearance":
      return <AppearanceScreen />
    case "household-settings":
      return <HouseholdSettingsScreen />
    case "notifications":
      return <NotificationsScreen />
    case "edit-profile":
      return <EditProfileScreen />
    case "privacy-security":
      return <PrivacySecurityScreen />
    case "help-support":
      return <HelpSupportScreen />
    case "legal-acceptance":
      return <LegalAcceptanceScreen />
    default:
      return <LoginScreen />
  }
}

function HouseholdRefreshNotice() {
  const { error, refresh, status } = useHouseholds()
  if (!error || status === "loading" || status === "error") return null

  return (
    <div
      className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
      role="alert"
    >
      <p className="flex-1">{error}</p>
      <button
        className="shrink-0 font-bold underline underline-offset-2"
        onClick={() => void refresh().catch(() => undefined)}
        type="button"
      >
        Retry
      </button>
    </div>
  )
}

export function AppShell({ initialScreen = "login" }: { initialScreen?: Screen }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataSyncProvider>
          <HouseholdProvider>
            <ChoreSyncProvider initialScreen={initialScreen}>
              <PushSubscriptionHealthProvider>
                <div className="min-h-screen bg-slate-200 flex items-start justify-center">
                  <div className="w-full max-w-sm bg-white min-h-screen relative overflow-hidden shadow-2xl">
                    <AppLaunchGate>
                      <HouseholdRefreshNotice />
                      <ScreenRouter />
                    </AppLaunchGate>
                  </div>
                </div>
              </PushSubscriptionHealthProvider>
            </ChoreSyncProvider>
          </HouseholdProvider>
        </DataSyncProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
