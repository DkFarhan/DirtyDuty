"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { profileApi, type Profile } from "@/lib/profile/api"
import { Avatar } from "../primitives"
import { SubpageHeader } from "./subpage-header"

export function EditProfileScreen() {
  const { navigate, setCurrentUser, state } = useChoreSync()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError("")
    try {
      const result = await profileApi.get()
      setProfile(result)
      setDisplayName(result.displayName)
      setStatus("loaded")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to load your profile. Please try again.",
      )
      setStatus("error")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!profile || busy || !displayName.trim()) return
    setBusy(true)
    setError("")
    setSaved(false)
    try {
      const updated = await profileApi.update({ displayName: displayName.trim() })
      setProfile(updated)
      setDisplayName(updated.displayName)
      setCurrentUser({
        ...state.currentUser,
        name: updated.displayName,
        avatar: updated.displayName.trim().slice(0, 1).toUpperCase() || state.currentUser.avatar,
      })
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your profile. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader title="Edit Profile" back={() => navigate("profile")} />
      <main className="px-4 pt-4">
        {status === "loading" && (
          <div aria-label="Loading profile" className="h-52 animate-pulse rounded-2xl bg-white" />
        )}
        {status === "error" && (
          <div className="rounded-2xl bg-white p-5 text-center">
            <p role="alert" className="text-sm text-slate-600">
              {error}
            </p>
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold"
              onClick={() => void load()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {status === "loaded" && profile && (
          <section className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col items-center gap-2 py-2">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Profile avatar"
                  className="h-20 w-20 rounded-2xl object-cover"
                  src={profile.avatarUrl}
                />
              ) : (
                <Avatar
                  initial={displayName.trim().slice(0, 1).toUpperCase() || "?"}
                  className="h-20 w-20 rounded-2xl text-3xl"
                />
              )}
              <p className="text-xs text-slate-400">
                Avatar uploads are coming soon. A placeholder is shown until then.
              </p>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
              Display name
              <input
                aria-label="Display name"
                autoComplete="name"
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500"
                maxLength={100}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setSaved(false)
                }}
                value={displayName}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">
              Email address <span className="text-[10px] font-normal">Read only</span>
              <input
                aria-label="Email address"
                className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-500"
                readOnly
                value={profile.email}
              />
            </label>
            <button
              className="w-full rounded-xl bg-teal-600 py-3.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
              disabled={busy || !displayName.trim()}
              onClick={() => void save()}
              type="button"
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
            {saved && (
              <p role="status" className="text-center text-sm font-medium text-teal-700">
                Profile updated.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-rose-600">
                {error}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
