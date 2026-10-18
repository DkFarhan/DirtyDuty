"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { notificationApi } from "@/lib/notifications/api"
import { profileApi, type Profile } from "@/lib/profile/api"
import { BottomNav } from "../bottom-nav"
import { ChevronRightIcon } from "../icons"
import { Avatar } from "../primitives"

const accountItems = [
  { label: "Notifications", screen: "notifications" as const },
  { label: "Privacy & Security", screen: "privacy-security" as const },
  { label: "Appearance", screen: "appearance" as const },
]

export function ProfileScreen() {
  const { state, navigate, openNotifications } = useChoreSync()
  const { logout } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  const loadProfile = useCallback(async () => {
    setError("")
    try {
      const result = await profileApi.get()
      setProfile(result)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to load your profile. Please try again.",
      )
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])
  useEffect(() => {
    notificationApi
      .unreadCount()
      .then((result) => setUnreadCount(result.count))
      .catch(() => setUnreadCount(0))
  }, [])

  const handleLogout = async () => {
    if (isSubmitting) return
    setError("")
    setIsSubmitting(true)
    try {
      await logout()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const initials =
    profile?.displayName?.trim().slice(0, 1).toUpperCase() || state.currentUser.avatar
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 pb-20 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="bg-white px-5 pb-6 pt-12 dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {profile?.avatarUrl ? (
              // External avatar URLs are displayed only when provided by the profile API.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="h-14 w-14 shrink-0 rounded-2xl object-cover"
                src={profile.avatarUrl}
              />
            ) : (
              <Avatar initial={initials} className="h-14 w-14 shrink-0 rounded-2xl text-2xl" />
            )}
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-black text-slate-900 dark:text-slate-100">
                {profile?.displayName ?? "Loading profile…"}
              </h1>
              <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                {profile?.email ?? " "}
              </p>
              {profile?.householdName && (
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {profile.householdName}
                </p>
              )}
            </div>
          </div>
          <button
            className="flex min-h-11 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-300 dark:hover:bg-teal-950/50 dark:focus-visible:ring-teal-400"
            onClick={() => navigate("edit-profile")}
            type="button"
          >
            Edit
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-5 px-4 pt-5">
        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <p role="alert">{error}</p>
            <button className="mt-1 font-bold" onClick={() => void loadProfile()} type="button">
              Try again
            </button>
          </div>
        )}
        <section className="rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 p-5 text-white">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-violet-200">
                Coming Soon
              </p>
              <p className="mt-0.5 font-display text-xl font-black">Rewards &amp; Streaks</p>
            </div>
            <span aria-hidden="true" className="text-4xl">
              🏆
            </span>
          </div>
          <p className="text-sm leading-relaxed text-violet-200">
            Earn points, unlock badges, and compete on household leaderboards.
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="px-4 pb-3 pt-4">
            <h2 className="font-display text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Preferences
            </h2>
          </div>
          {accountItems.map((item) => (
            <button
              key={item.label}
              className="flex min-h-12 w-full items-center gap-4 border-t border-slate-100 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
              onClick={() => {
                if (item.screen === "notifications") {
                  openNotifications("profile")
                  return
                }
                navigate(item.screen)
              }}
              type="button"
            >
              <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                {item.label}
              </span>
              {item.screen === "notifications" && unreadCount > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200">
                  {unreadCount}
                </span>
              )}
              <ChevronRightIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            </button>
          ))}
        </section>

        <button
          className="flex min-h-12 w-full items-center rounded-xl border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => navigate("help-support")}
          type="button"
        >
          <span className="flex-1">Help &amp; Support</span>
          <ChevronRightIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
        </button>

        <button
          className="w-full rounded-xl border border-rose-300 bg-transparent py-3.5 font-bold text-rose-700 transition-colors hover:border-rose-600 hover:bg-rose-600 hover:text-white active:border-rose-700 active:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500 dark:text-rose-300 dark:hover:border-rose-700 dark:hover:bg-rose-700 dark:hover:text-white dark:active:border-rose-800 dark:active:bg-rose-800"
          disabled={isSubmitting}
          onClick={() => void handleLogout()}
          type="button"
        >
          {isSubmitting ? "Signing Out…" : "Sign Out"}
        </button>
        <footer className="pb-1 text-center text-xs leading-5 text-slate-400 dark:text-slate-500">
          <p>Developed by Farhan Habib</p>
          <p>© 2026 DirtyDuty</p>
        </footer>
      </main>
      <BottomNav active="profile" navigate={navigate} />
    </div>
  )
}
