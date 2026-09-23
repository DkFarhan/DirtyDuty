"use client"

import { ChoreSyncProvider, useChoreSync } from "@/lib/chore-sync/store"
import { LoginScreen } from "./screens/login-screen"
import { RegisterScreen } from "./screens/register-screen"
import { WelcomeScreen } from "./screens/welcome-screen"
import { CreateHouseholdScreen } from "./screens/create-household-screen"
import { JoinHouseholdScreen } from "./screens/join-household-screen"
import { DashboardScreen } from "./screens/dashboard-screen"
import { MyChoresScreen } from "./screens/my-chores-screen"
import { HouseholdScreen } from "./screens/household-screen"
import { AdminScreen } from "./screens/admin-screen"
import { CreateChoreScreen } from "./screens/create-chore-screen"
import { ProfileScreen } from "./screens/profile-screen"

function ScreenRouter() {
  const { screen } = useChoreSync()

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
      return <AdminScreen />
    case "create-chore":
      return <CreateChoreScreen />
    case "profile":
      return <ProfileScreen />
    default:
      return <LoginScreen />
  }
}

export function AppShell() {
  return (
    <ChoreSyncProvider>
      <div className="min-h-screen bg-slate-200 flex items-start justify-center">
        <div className="w-full max-w-sm bg-white min-h-screen relative overflow-hidden shadow-2xl">
          <ScreenRouter />
        </div>
      </div>
    </ChoreSyncProvider>
  )
}
