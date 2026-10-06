"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { notificationApi } from "@/lib/notifications/api"
import { profileApi, type Profile } from "@/lib/profile/api"
import { BottomNav } from "../bottom-nav"
import { BellIcon, ChevronRightIcon } from "../icons"
import { Avatar } from "../primitives"

const accountItems = [
  { icon: "👤", label: "Edit Profile", screen: "edit-profile" as const },
  { icon: "🔔", label: "Notifications", screen: "notifications" as const },
  { icon: "🔒", label: "Privacy & Security", screen: "privacy-security" as const },
  { icon: "❓", label: "Help & Support", screen: "help-support" as const },
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
  const statTiles = [
    { value: profile?.assigned ?? "—", label: "Assigned" },
    { value: profile?.completed ?? "—", label: "Completed" },
    { value: profile ? `${profile.completionRate}%` : "—", label: "Rate" },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 pb-20">
      <header className="bg-white px-5 pb-6 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            {profile?.avatarUrl ? (
              // External avatar URLs are displayed only when provided by the profile API.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="h-16 w-16 rounded-2xl object-cover shadow-lg shadow-teal-100"
                src={profile.avatarUrl}
              />
            ) : (
              <Avatar
                initial={initials}
                className="h-16 w-16 rounded-2xl text-3xl shadow-lg shadow-teal-100"
              />
            )}
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-black text-slate-900">
                {profile?.displayName ?? "Loading profile…"}
              </h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="truncate text-sm text-slate-400">
                  {profile?.householdName ?? state.household.name}
                </span>
                {state.currentUser.isAdmin && (
                  <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-700">
                    Admin
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-600 hover:bg-teal-50 hover:text-teal-700"
            onClick={() => openNotifications("profile")}
            type="button"
          >
            <BellIcon className="h-5 w-5" />
            {unreadCount > 0 && (
              <span
                aria-label={`${unreadCount} unread`}
                className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-4 px-4 pt-4">
        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <p role="alert">{error}</p>
            <button className="mt-1 font-bold" onClick={() => void loadProfile()} type="button">
              Try again
            </button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          {statTiles.map((stat) => (
            <div
              className="rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm"
              key={stat.label}
            >
              <p className="font-display text-2xl font-black text-slate-900">{stat.value}</p>
              <p className="mt-0.5 text-xs text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>

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

        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <p className="px-4 pb-2 pt-4 font-display text-xs font-black uppercase tracking-wider text-slate-500">
            Account
          </p>
          {accountItems.map((item) => (
            <button
              key={item.label}
              className="flex w-full items-center gap-4 border-t border-slate-50 px-4 py-3.5 transition-colors hover:bg-slate-50"
              onClick={() => {
                if (item.screen === "notifications") {
                  openNotifications("profile")
                  return
                }
                navigate(item.screen)
              }}
              type="button"
            >
              <span aria-hidden="true" className="w-7 text-center text-lg">
                {item.icon}
              </span>
              <span className="flex-1 text-left text-sm font-medium text-slate-800">
                {item.label}
              </span>
              {item.screen === "notifications" && unreadCount > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  {unreadCount}
                </span>
              )}
              <ChevronRightIcon className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </section>

        <button
          className="w-full rounded-xl border border-rose-200 py-3.5 font-bold text-rose-500 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => void handleLogout()}
          type="button"
        >
          {isSubmitting ? "Signing Out…" : "Sign Out"}
        </button>
      </main>
      <BottomNav active="profile" navigate={navigate} />
    </div>
  )
}
